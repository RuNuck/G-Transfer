/**
 * End-to-end DCC smoke: emit lantern (or --kind) script -> Blender headless build

 * (+ optional bake) -> validate -> Godot import check.

 *
 *   npm run dcc:smoke

 *   node tools/dcc-smoke.mjs [--kind lantern] [--bake] [--no-godot]
 *
 * Requires ANVIL_BLENDER or blender on PATH. Godot via ANVIL_GODOT / PATH.

 * PATH note: ensure ~/.local/bin is on PATH, or set ANVIL_* absolute paths
 * (see docs/DCC-SETUP.md).

 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBlender, findGodot } from "./forge-run/find-dcc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

function parseArgs(argv) {
  const args = { kind: "lantern", engine: "godot", bake: false, godot: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kind") args.kind = argv[++i];
    else if (a.startsWith("--kind=")) args.kind = a.slice(7);
    else if (a === "--engine") args.engine = argv[++i];
    else if (a === "--bake") args.bake = true;
    else if (a === "--no-bake") args.bake = false;
    else if (a === "--no-godot") args.godot = false;
    else if (a === "--help" || a === "-h") {
      console.log("usage: node tools/dcc-smoke.mjs [--kind lantern] [--bake] [--no-godot]");
      process.exit(0);
    }
  }
  return args;
}

function run(label, cmd, cmdArgs, opts = {}) {
  console.log("\n== " + label + " ==");
  console.log("$", cmd, cmdArgs.join(" "));
  const r = spawnSync(cmd, cmdArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...opts.env },
    timeout: opts.timeout ?? 600000,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r;
}

function writeReport(report) {
  const dir = join(projectRoot, "exports/forge-smoke");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "dcc-smoke-report.json");
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log("wrote", path);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const blender = findBlender();
  const godot = findGodot();
  const report = {
    at: new Date().toISOString(),
    kind: args.kind,
    engine: args.engine,
    bake: args.bake,
    blender: blender,
    godot: godot,
    steps: [],
  };

  if (!blender.available) {
    console.error("FAIL: Blender not found. Set ANVIL_BLENDER or put blender on PATH.");
    console.error('See docs/DCC-SETUP.md — export PATH="$HOME/.local/bin:$PATH"');
    process.exit(2);
  }

  const forgeArgs = [
    "tools/forge-run/run-asset.mjs",
    "--kind",
    args.kind,
    "--engine",
    args.engine,
    "--out-dir",
    "exports/forge-smoke",
    "--json",
  ];
  if (args.bake) forgeArgs.push("--bake");

  const forge = run("forge:run --kind", process.execPath, forgeArgs);
  report.steps.push({ step: "forge_kind", exitCode: forge.status ?? 1 });
  let job = null;
  try {
    const raw = (forge.stdout || "").trim();
    const start = raw.indexOf("{");
    job = start >= 0 ? JSON.parse(raw.slice(start)) : null;
  } catch {
    /* ignore */
  }
  report.job = job;
  if ((forge.status ?? 1) !== 0) {
    writeReport(report);
    process.exit(1);
  }

  const glbRel = job?.paths?.mesh || job?.mesh;
  const glb = glbRel ? resolve(projectRoot, glbRel) : null;
  report.glb = glbRel;

  if (args.godot && glb && existsSync(glb)) {
    if (!godot.available) {
      console.error("FAIL: Godot not found. Set ANVIL_GODOT or put godot on PATH (no SKIP in prod smoke).");
      report.steps.push({ step: "godot_import", exitCode: 1, skipped: false, hardFail: "godot_absent" });
      writeReport(report);
      process.exit(1);
    } else {
      const g = run(
        "godot-check",
        process.execPath,
        ["tools/godot-check/check-import.mjs", glb],
        { env: { ANVIL_GODOT: godot.path } },
      );
      let gdoc = null;
      try {
        gdoc = JSON.parse((g.stdout || "").trim());
      } catch {
        /* ignore */
      }
      report.steps.push({
        step: "godot_import",
        exitCode: g.status ?? 1,
        ok: gdoc?.ok,
        problems: gdoc?.problems ?? [],
        godotVersion: gdoc?.godot,
      });
      report.godotReport = gdoc;
    }
  }

  writeReport(report);
  const failed = report.steps.some((s) => s.exitCode && s.exitCode !== 0);
  console.log("\n== dcc-smoke summary ==");
  console.log(JSON.stringify({ok: !failed, glb: report.glb, blender: blender.path, steps: report.steps }, null, 2));
  process.exit(failed ? 1 : 0);
}

main();
