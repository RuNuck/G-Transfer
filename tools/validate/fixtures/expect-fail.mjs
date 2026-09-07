import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const validate = resolve(projectRoot, "tools/validate/run.mjs");

const r = spawnSync(process.execPath, [validate, here, "--json"], {
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

console.log(JSON.stringify({
  ok: true,
  expect: "nonzero validate exit + >=1 hard-fail",
  validateExit: code,
  counts: doc?.counts,
  files: (doc?.results ?? []).map((x) => ({ file: x.file, ok: x.ok, hardFails: x.hardFails })),
}, null, 2));
process.exit(0);
