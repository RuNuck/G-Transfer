/**
 * Positive fixture harness: each hard gate under test must pass (>=1 expect-pass).
 * Expects validate on fixtures/pass to exit 0 with zero hard-fails.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const validate = resolve(projectRoot, "tools/validate/run.mjs");
const passDir = resolve(here, "pass");

const REQUIRED = ["meters_bounds", "pbr_textures_resolve", "pivot_weapon_or_rigged"];

const r = spawnSync(process.execPath, [validate, passDir, "--json"], {
  cwd: projectRoot,
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});

const code = r.status ?? 1;
let doc = null;
try {
  doc = JSON.parse(r.stdout || "{}");
} catch {
  const m = (r.stdout || "").match(/\{[\s\S]*\}\s*$/);
  if (m) {
    try { doc = JSON.parse(m[0]); } catch { /* ignore */ }
  }
}

const results = doc?.results ?? [];
const failed = doc?.counts?.failed ?? 0;

if (code !== 0 || failed > 0 || !doc?.ok) {
  console.error("FAIL: expect-pass fixtures must all pass (exit 0)");
  console.error(r.stdout || r.stderr);
  process.exit(1);
}

if (!results.length) {
  console.error("FAIL: no pass fixtures found under fixtures/pass");
  process.exit(1);
}

const gatePassFiles = Object.fromEntries(REQUIRED.map((k) => [k, []]));
for (const res of results) {
  for (const g of res.gates || []) {
    if (REQUIRED.includes(g.id) && g.severity === "hard" && g.ok) {
      gatePassFiles[g.id].push(res.file);
    }
  }
}

const shortfalls = [];
for (const id of REQUIRED) {
  if (!(gatePassFiles[id]?.length > 0)) shortfalls.push(id + ": need >=1 hard pass");
}

if (shortfalls.length) {
  console.error("FAIL: positive fixture bar shortfalls:\n  " + shortfalls.join("\n  "));
  console.error(JSON.stringify(gatePassFiles, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  expect: "validate exit 0 + >=1 hard pass per gate",
  validateExit: code,
  counts: doc?.counts,
  gatePassFiles,
  files: results.map((x) => ({ file: x.file, ok: x.ok, hardFails: x.hardFails })),
}, null, 2));
process.exit(0);
