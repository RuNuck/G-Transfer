/**
 * Sage gate: --file/--mesh must refuse paths outside exports/.
 * Smoke: node tools/forge-run/smoke-mesh-jail.mjs
 */
import { spawnSync } from "node:child_process";
import { symlinkSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const runner = resolve(here, "run-asset.mjs");
const trapDir = resolve(projectRoot, "exports", "_jail-smoke");
const trapLink = join(trapDir, "escape.glb");

mkdirSync(trapDir, { recursive: true });
try {
  unlinkSync(trapLink);
} catch {
  /* ok */
}
symlinkSync("/etc/passwd", trapLink);

const probes = [
  { label: "package.json", argv: ["--file", "package.json"] },
  { label: "../package.json", argv: ["--file", "../package.json"] },
  { label: "absolute outside exports", argv: ["--file", "/etc/passwd"] },
  { label: "symlink escape under exports", argv: ["--file", "exports/_jail-smoke/escape.glb"] },
];

const results = [];
let failed = false;

for (const probe of probes) {
  const r = spawnSync(process.execPath, [runner, ...probe.argv, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  const code = r.status ?? 1;
  const ok = code !== 0;
  if (!ok) failed = true;
  results.push({
    probe: probe.label,
    exitCode: code,
    rejectOk: ok,
    stderrTail: (r.stderr || "").trim().split("\n").slice(-2).join(" | "),
  });
}

try {
  unlinkSync(trapLink);
} catch {
  /* ok */
}

const doc = {
  ok: !failed,
  expect: "nonzero exit for paths outside exports/ (incl. symlink realpath)",
  results,
};
console.log(JSON.stringify(doc, null, 2));
process.exit(failed ? 1 : 0);
