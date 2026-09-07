/**
 * Negative fixture harness: every hard gate under test must hard-fail ≥3 times.
 * Expects validate on fixtures/fail to exit nonzero.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const validate = resolve(projectRoot, "tools/validate/run.mjs");
const failDir = resolve(here, "fail");

const REQUIRED = {
  meters_bounds: 3,
  pbr_textures_resolve: 3,
  pivot_weapon_or_rigged: 3,
};

const r = spawnSync(process.execPath, [validate, failDir, "--json"], {
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

const failed = doc?.counts?.failed ?? 0;
const assets = doc?.counts?.assets ?? 0;
const results = doc?.results ?? [];

if (code === 0) {
  console.error("FAIL: validate exited 0 on intentional broken fixtures (expected nonzero)");
  console.error(r.stdout);
  process.exit(1);
}

if (assets < 1 || failed < 1) {
  console.error("FAIL: expected >=1 failing fixture asset; got assets=" + assets + " failed=" + failed);
  console.error(r.stdout || r.stderr);
  process.exit(1);
}

const gateHits = Object.fromEntries(Object.keys(REQUIRED).map((k) => [k, []]));
for (const res of results) {
  for (const id of res.hardFails || []) {
    if (gateHits[id]) gateHits[id].push(res.file);
  }
}

const shortfalls = [];
for (const [id, need] of Object.entries(REQUIRED)) {
  const got = gateHits[id]?.length ?? 0;
  if (got < need) shortfalls.push(id + ": need >=" + need + " hard-fails, got " + got);
}

if (shortfalls.length) {
  console.error("FAIL: fixture bar shortfalls:\n  " + shortfalls.join("\n  "));
  console.error(JSON.stringify(gateHits, null, 2));
  process.exit(1);
}

const mandatory = results.find((x) => /weapon-missing-pivot\.glb$/i.test(x.file || ""));
if (!mandatory || !(mandatory.hardFails || []).includes("pivot_weapon_or_rigged")) {
  console.error("FAIL: weapon-missing-pivot.glb must hard-fail pivot_weapon_or_rigged");
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  expect: "nonzero validate exit + >=3 hard-fails per gate + weapon-missing-pivot",
  validateExit: code,
  counts: doc?.counts,
  gateHits,
  files: results.map((x) => ({ file: x.file, ok: x.ok, hardFails: x.hardFails })),
}, null, 2));
process.exit(0);
