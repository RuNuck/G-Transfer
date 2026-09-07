// Geometry/GLB test: for several prototypes, download the GLB from the studio and check node names,
// material names, collision node, and that each LOD's world bounds equal the spec dimensions and pivot.
// The page is cleared to a fresh session, so it uses the default engine; the spec is fetched for the
// same default so both sides agree on naming. test-engine-sync covers the other engines' naming.
import { chromium } from "file:///C:/Users/RuNuc/Desktop/Workspace/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:8080/";
const MCP = new URL("/api/mcp", BASE).toString();
const KINDS = [
  ["Supply crate", "sci_crate"], ["Hover bike", "hoverbike"], ["Hero mannequin", "mannequin"], ["Infantry rifle", "rifle"],
  ["Closed helm", "helmet"], ["Dagger", "dagger"], ["Longsword", "sword"], ["Potion flask", "potion"], ["Wall module", "wall"],
  ["Stair module", "stairs"], ["Oil barrel", "barrel"], ["Pipe junction", "pipe"],
];

async function specFor(kind) {
  const res = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "forge_create_asset", arguments: { brief: "x", kind } } }) });
  return JSON.parse((await res.json()).result.content[0].text);
}

function parseGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  return gltf;
}

// World bounds of a node subtree: nodes carry either a column-major `matrix` or TRS.
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0], s = n.scale ?? [1, 1, 1], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
  return [r[0] * s[0], r[1] * s[0], r[2] * s[0], 0, r[3] * s[1], r[4] * s[1], r[5] * s[1], 0, r[6] * s[2], r[7] * s[2], r[8] * s[2], 0, t[0], t[1], t[2], 1];
}
function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
function nodeBounds(gltf, index, parents = []) {
  const node = gltf.nodes[index];
  const chain = [...parents, nodeMatrix(node)];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const grow = (p) => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); } };
  if (node.mesh !== undefined) {
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const acc = gltf.accessors[prim.attributes.POSITION];
      for (const cx of [acc.min[0], acc.max[0]]) for (const cy of [acc.min[1], acc.max[1]]) for (const cz of [acc.min[2], acc.max[2]]) {
        let p = [cx, cy, cz];
        for (let k = chain.length - 1; k >= 0; k--) p = apply(chain[k], p);
        grow(p);
      }
    }
  }
  for (const child of node.children ?? []) {
    const b = nodeBounds(gltf, child, chain);
    grow(b.lo); grow(b.hi);
  }
  return { lo, hi };
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });

const results = {};
for (const [label, kind] of KINDS) {
  const spec = await specFor(kind);
  await page.click(`li button:has-text('${label}')`);
  await page.waitForTimeout(700);
  const lodText = (await page.evaluate(() => document.body.innerText)).match(/LOD0 · ([\d,…]+) \/ (\d+)/);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("button:has-text('Download GLB')")]);
  const gltf = parseGlb(readFileSync(await download.path()));
  const rootNodes = gltf.scenes[gltf.scene ?? 0].nodes;
  const byName = Object.fromEntries(rootNodes.map((i) => [gltf.nodes[i].name, i]));
  const wantNodes = [spec.mesh, `${spec.mesh}_LOD1`, `${spec.mesh}_LOD2`, spec.collision];
  const problems = [];
  for (const n of wantNodes) if (!(n in byName)) problems.push(`missing node ${n}`);
  const dims = [spec.spec.dimensions.x, spec.spec.dimensions.y, spec.spec.dimensions.z];
  const measured = {};
  for (const n of wantNodes.slice(0, 3)) {
    if (!(n in byName)) continue;
    const b = nodeBounds(gltf, byName[n]);
    const size = b.hi.map((v, i) => v - b.lo[i]);
    measured[n] = { size: size.map((v) => +v.toFixed(3)), minY: +b.lo[1].toFixed(3), centerY: +((b.lo[1] + b.hi[1]) / 2).toFixed(3) };
    size.forEach((v, i) => { if (Math.abs(v - dims[i]) > Math.max(0.02 * dims[i], 0.004)) problems.push(`${n} axis ${i}: ${v.toFixed(3)} vs ${dims[i]}`); });
    if (spec.spec.pivot === "bottom" && Math.abs(b.lo[1]) > 0.004) problems.push(`${n} min y ${b.lo[1].toFixed(3)} (bottom pivot)`);
    if (spec.spec.pivot === "center" && Math.abs((b.lo[1] + b.hi[1]) / 2) > 0.004) problems.push(`${n} centre y ${((b.lo[1] + b.hi[1]) / 2).toFixed(3)} (centre pivot)`);
  }
  if (spec.collision in byName) {
    const cb = nodeBounds(gltf, byName[spec.collision]);
    const mb = nodeBounds(gltf, byName[spec.mesh]);
    for (let i = 0; i < 3; i++) if (cb.lo[i] > mb.lo[i] + 0.003 || cb.hi[i] < mb.hi[i] - 0.003) problems.push(`collision does not enclose mesh on axis ${i}`);
  }
  const matNames = (gltf.materials ?? []).map((m) => m.name);
  const wantMats = spec.spec.materials.map((m) => m.name);
  if (!matNames.some((n) => /^(MI_|M_|mat_|MAT_)/.test(n))) problems.push(`materials lack engine names: ${matNames.join(", ")}`);
  if (!lodText || lodText[1] === "…") problems.push(`inspector LOD count not shown: ${lodText?.[0]}`);
  results[kind] = { ok: problems.length === 0, problems, dims, pivot: spec.spec.pivot, collision: spec.collision, measured, materials: matNames, inspector: lodText?.[0], file: download.suggestedFilename() };
  void wantMats;
}
await browser.close();
const failed = Object.entries(results).filter(([, r]) => !r.ok);
console.log(JSON.stringify({ ok: failed.length === 0 && pageErrors.length === 0, passed: Object.keys(results).length - failed.length, total: Object.keys(results).length, pageErrors, results }, null, 1));
process.exit(failed.length || pageErrors.length ? 1 : 0);
