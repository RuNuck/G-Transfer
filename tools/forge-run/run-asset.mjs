/**
 * Phase 1 forge runner.
 *
 * Existing GLB:
 *   node tools/forge-run/run-asset.mjs --file|--mesh <path-to-glb> [--json]
 *
 * Real headless Blender build (when blender available):
 *   node tools/forge-run/run-asset.mjs --kind lantern [--engine godot] [--bake] [--out-dir exports/forge-smoke] [--json]
 *   node tools/forge-run/run-asset.mjs --script path/to/build.py [--bake-script path/to/bake.py] [--out exports/forge-smoke/foo.glb]
 *
 * Prefers ANVIL_BLENDER, then `which blender`. Falls back to simulated build/bake
 * stages when Blender is missing and only --file is given.
 */
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJob, advanceStage, failJob, projectRoot, saveJob } from "./job-store.mjs";
import { defaultKitDir, findBlender } from "./find-dcc.mjs";
import { emitKind } from "./emit-script.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const HEADLESS = resolve(here, "headless-run.py");

function parseArgs(argv) {
  const args = {
    file: null,
    kind: null,
    engine: "godot",
    script: null,
    bakeScript: null,
    bake: false,
    outDir: "exports/forge-smoke",
    out: null,
    jsonOnly: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.jsonOnly = true;
    else if (a === "--force") args.force = true;
    else if (a === "--bake") args.bake = true;
    else if (a === "--no-bake") args.bake = false;
    else if (a === "--file" || a === "--mesh") args.file = argv[++i];
    else if (a.startsWith("--file=")) args.file = a.slice(7);
    else if (a.startsWith("--mesh=")) args.file = a.slice(7);
    else if (a === "--kind") args.kind = argv[++i];
    else if (a.startsWith("--kind=")) args.kind = a.slice(7);
    else if (a === "--engine") args.engine = argv[++i];
    else if (a.startsWith("--engine=")) args.engine = a.slice(9);
    else if (a === "--script") args.script = argv[++i];
    else if (a.startsWith("--script=")) args.script = a.slice(9);
    else if (a === "--bake-script") args.bakeScript = argv[++i];
    else if (a.startsWith("--bake-script=")) args.bakeScript = a.slice(14);
    else if (a === "--out-dir") args.outDir = argv[++i];
    else if (a.startsWith("--out-dir=")) args.outDir = a.slice(10);
    else if (a === "--out") args.out = argv[++i];
    else if (a.startsWith("--out=")) args.out = a.slice(6);
    else if (a === "--help" || a === "-h") {
      console.log(`usage:
  node tools/forge-run/run-asset.mjs --file|--mesh <glb> [--json]
  node tools/forge-run/run-asset.mjs --kind <kind> [--engine godot] [--bake] [--out-dir exports/forge-smoke] [--json]
  node tools/forge-run/run-asset.mjs --script <build.py> [--bake-script <bake.py>] [--out <glb>] [--json]`);
      process.exit(0);
    } else if (!a.startsWith("-") && !args.file && !args.kind && !args.script) args.file = a;
  }
  return args;
}

function resolveMesh(input) {
  if (!input) return null;
  const candidates = [];
  if (isAbsolute(input)) candidates.push(input);
  candidates.push(resolve(projectRoot, input));
  candidates.push(resolve(projectRoot, "exports", input));
  candidates.push(resolve(projectRoot, "exports/forge", input));
  if (!input.toLowerCase().endsWith(".glb")) {
    candidates.push(resolve(projectRoot, "exports/forge", input + ".glb"));
    candidates.push(resolve(projectRoot, "exports", input + ".glb"));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function runValidate(absGlb) {
  const validate = resolve(projectRoot, "tools/validate/run.mjs");
  const r = spawnSync(process.execPath, [validate, absGlb, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  let doc = null;
  try {
    doc = JSON.parse(r.stdout || "{}");
  } catch {
    const m = (r.stdout || "").match(/\{[\s\S]*\}\s*$/);
    if (m) {
      try {
        doc = JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
  }
  return { exitCode: r.status ?? 1, doc, stderr: r.stderr, stdout: r.stdout };
}

function rebuildIndex() {
  const build = resolve(projectRoot, "tools/forge-index/build.mjs");
  const r = spawnSync(process.execPath, [build], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

function runHeadlessBlender({ blenderPath, buildScript, bakeScript, exportPath, kitDir }) {
  mkdirSync(dirname(exportPath), { recursive: true });
  const texDir = join(dirname(exportPath), "textures");
  mkdirSync(texDir, { recursive: true });
  const env = {
    ...process.env,
    ANVIL_EXPORT_PATH: exportPath,
    ANVIL_TEXTURE_DIR: texDir,
  };
  if (kitDir) env.ANVIL_KIT_DIR = kitDir;
  const pyArgs = [HEADLESS, "--", buildScript];
  if (bakeScript) pyArgs.push(bakeScript);
  const args = ["--background", "--python", ...pyArgs];
  const r = spawnSync(blenderPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 600000,
  });
  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    exportPath,
    texDir,
    signal: r.signal,
  };
}

function finishPublished(job, abs, args, blenderInfo) {
  const rel = relative(projectRoot, abs).split("\\").join("/");
  advanceStage(job, "validating", "running tools/validate godot_prod");
  const v = runValidate(abs);
  job.validation = {
    ok: Boolean(v.doc?.ok) && v.exitCode === 0,
    exitCode: v.exitCode,
    counts: v.doc?.counts ?? null,
    hardFails: v.doc?.results?.[0]?.hardFails ?? [],
    report: v.doc?.results?.[0] ?? null,
  };
  job.blender = { ...job.blender, ...blenderInfo };
  saveJob(job);

  if (!job.validation.ok) {
    failJob(job, "validate failed: " + (job.validation.hardFails.join(", ") || "exit " + v.exitCode));
    if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
    else
      console.error(
        JSON.stringify({ ok: false, jobId: job.id, status: job.status, validation: job.validation }, null, 2),
      );
    process.exit(1);
  }

  const idx = rebuildIndex();
  job.paths.index = "exports/index.json";
  if (idx.exitCode !== 0) {
    failJob(job, "index rebuild failed: " + (idx.stderr || idx.stdout || "exit " + idx.exitCode));
    if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
    process.exit(1);
  }

  advanceStage(job, "published", "validated + index rebuilt");
  if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
  else {
    console.log(
      JSON.stringify(
        { ok: true, jobId: job.id, status: job.status, mesh: rel, blender: job.blender, paths: job.paths },
        null,
        2,
      ),
    );
  }
  process.exit(0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const blender = findBlender();
  const kitDir = defaultKitDir(projectRoot);

  // --- Real build from kind or script ---
  if (args.kind || args.script) {
    if (!blender.available) {
      console.error(
        "Blender not found (set ANVIL_BLENDER or install blender on PATH). Cannot run --kind/--script forge.",
      );
      process.exit(2);
    }
    if (!existsSync(HEADLESS)) {
      console.error("missing headless runner:", HEADLESS);
      process.exit(2);
    }

    let buildScript = args.script ? resolve(projectRoot, args.script) : null;
    let bakeScript = args.bakeScript ? resolve(projectRoot, args.bakeScript) : null;
    let meshName = null;
    let emitted = null;

    if (args.kind) {
      emitted = emitKind({
        kind: args.kind,
        engine: args.engine,
        outDir: join(projectRoot, "tools/blender-check/out/gen"),
        bake: true,
      });
      buildScript = emitted.buildPath;
      meshName = emitted.mesh;
      if (args.bake) bakeScript = emitted.bakePath;
    }

    if (!buildScript || !existsSync(buildScript)) {
      console.error("build script missing:", buildScript);
      process.exit(2);
    }

    const outDir = resolve(projectRoot, args.outDir || "exports/forge-smoke");
    mkdirSync(outDir, { recursive: true });
    const exportName = args.out
      ? resolve(projectRoot, args.out)
      : join(outDir, `${meshName || basename(buildScript, ".py")}.glb`);

    const job = createJob({
      type: "asset",
      status: "queued",
      inputs: {
        mode: args.kind ? "kind-build" : "script-build",
        kind: args.kind,
        engine: args.engine,
        script: relative(projectRoot, buildScript).split("\\").join("/"),
        bake: Boolean(bakeScript),
      },
      paths: {},
      blender: {
        available: true,
        path: blender.path,
        source: blender.source,
        kitDir: kitDir,
        note: "headless Blender build via tools/forge-run/headless-run.py",
      },
    });

    try {
      advanceStage(job, "building", `Blender headless build: ${blender.path}`);
      if (bakeScript) advanceStage(job, "baking", `Blender bake: ${bakeScript}`);
      else advanceStage(job, "baking", "bake skipped (--bake not set); materials are untextured Principled BSDF");

      const run = runHeadlessBlender({
        blenderPath: blender.path,
        buildScript,
        bakeScript,
        exportPath: exportName,
        kitDir,
      });
      job.blender.logTail = (run.stdout + "\n" + run.stderr).slice(-4000);
      job.blender.exitCode = run.exitCode;
      const kitUsed = /part kit/i.test(run.stdout) || /USING_KIT|Anvil kit/i.test(run.stdout);
      const sourceMatch = run.stdout.match(/built \((part kit|blockout)\)/i);
      job.blender.buildSource = sourceMatch ? sourceMatch[1].toLowerCase() : kitUsed ? "kit?" : "unknown";
      saveJob(job);

      if (run.exitCode !== 0 || !existsSync(exportName)) {
        failJob(
          job,
          `Blender headless failed (exit ${run.exitCode}): ` +
            (run.stderr || run.stdout || "").split("\n").slice(-20).join(" | "),
        );
        if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
        else console.error(JSON.stringify({ ok: false, jobId: job.id, blender: job.blender }, null, 2));
        process.exit(1);
      }

      job.paths.mesh = relative(projectRoot, exportName).split("\\").join("/");
      job.paths.textures = relative(projectRoot, run.texDir).split("\\").join("/");
      if (emitted) {
        job.paths.buildScript = relative(projectRoot, emitted.buildPath).split("\\").join("/");
        if (bakeScript) job.paths.bakeScript = relative(projectRoot, bakeScript).split("\\").join("/");
      }
      saveJob(job);
      finishPublished(job, exportName, args, job.blender);
    } catch (e) {
      failJob(job, e.message || String(e));
      if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
      else console.error(e);
      process.exit(1);
    }
    return;
  }

  // --- Existing GLB path (validate + index; Blender stages simulated if no binary) ---
  const abs = resolveMesh(args.file);
  if (!abs) {
    console.error("missing --file/--mesh pointing at an existing .glb under exports/, or use --kind / --script for a real Blender build");
    process.exit(2);
  }

  const rel = relative(projectRoot, abs).split("\\").join("/");
  const job = createJob({
    type: "asset",
    status: "queued",
    inputs: { file: rel, mode: "existing-glb" },
    paths: { mesh: rel },
    blender: {
      available: blender.available,
      path: blender.path,
      source: blender.source,
      kitDir,
      note: blender.available
        ? "Blender present; existing-GLB mode does not rebuild — use --kind/--script for a real headless forge"
        : "blender binary not found (ANVIL_BLENDER / which blender); build/bake stages simulated",
    },
  });

  try {
    advanceStage(
      job,
      "building",
      blender.available
        ? "existing GLB — skip Blender rebuild (pass --kind to forge new)"
        : "simulated build (no blender); reusing existing GLB",
    );
    advanceStage(
      job,
      "baking",
      blender.available
        ? "existing GLB — skip Blender bake"
        : "simulated bake (no blender); textures assumed already in GLB",
    );
    finishPublished(job, abs, args, job.blender);
  } catch (e) {
    failJob(job, e.message || String(e));
    if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
    else console.error(e);
    process.exit(1);
  }
}

main();
