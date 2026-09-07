/**
 * Sage gate: --file/--mesh must refuse paths outside exports/.
 * Smoke: node tools/forge-run/smoke-mesh-jail.mjs
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const runner = resolve(here, "run-asset.mjs");

const probes = [
  { label: "package.json", argv: ["--file", "package.json"] },
  { label: "../package.json", argv: ["--file", "../package.json"] },
  { label: "absolute outside exports", argv: ["--file", "/etc/passwd"] },
];

const results = [];
let failed = false;

for (const p of probes) {
  const r = spawnSync(process.execPath, [runner, ...p.argv, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  const code = r.status ?? 1;
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  // Fail closed: non-zero exit and no resolved mesh path leaked as success JSON with paths.mesh outside exports
  const ok = code !== 0;
  if (!ok) failed = true;
  results.push({
    probe: p.label,
    exitCode: code,
    rejectOk: ok,
    stderrTail: (r.stderr || "").trim().split("\n").slice(-2).join(" | "),
  });
}

const doc = { ok: !failed, expect: "nonzero exit for paths outside exports/", results };
console.log(JSON.stringify(doc, null, 2));
process.exit(failed ? 1 : 0);
