/**
 * Phase 1 forge runner (sync CLI — still valid for smokes / --force sync).
 * Prefer durable path for agent jobs:
 *   node tools/forge-run/enqueue.mjs ... [--kick-worker]
 *   node tools/forge-run/worker.mjs --once|--loop
 *
 * Existing GLB:
 *   node tools/forge-run/run-asset.mjs --file|--mesh <path-to-glb> [--json]
 *
 * Real headless Blender build (when blender available):
 *   node tools/forge-run/run-asset.mjs --kind lantern [--engine godot] [--bake] [--out-dir exports/forge-smoke] [--json]
 *
 * Prefers ANVIL_BLENDER, then `which blender`. Refuses publish when Blender is missing
 * (no simulated build/bake path to published).
 */
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJob, projectRoot } from "./job-store.mjs";
import { defaultKitDir, findBlender } from "./find-dcc.mjs";
import { executeAssetJob, resolveMesh } from "./execute-asset.mjs";

const here = dirname(fileURLToPath(import.meta.url));

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
    brief: null,
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
    else if (a === "--brief") args.brief = argv[++i];
    else if (a.startsWith("--brief=")) args.brief = a.slice(8);
    else if (a === "--out") args.out = argv[++i];
    else if (a.startsWith("--out=")) args.out = a.slice(6);
    else if (a === "--help" || a === "-h") {
      console.log(`usage:
  node tools/forge-run/run-asset.mjs --file|--mesh <glb> [--json]
  node tools/forge-run/run-asset.mjs --kind <kind> [--engine godot] [--bake] [--out-dir exports/forge-smoke] [--json]
  node tools/forge-run/run-asset.mjs --script <build.py> [--bake-script <bake.py>] [--out <glb>] [--json]
  (durable) node tools/forge-run/enqueue.mjs --kind <kind> --kick-worker --json`);
      process.exit(0);
    } else if (!a.startsWith("-") && !args.file && !args.kind && !args.script) args.file = a;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const blender = findBlender();
  const kitDir = defaultKitDir(projectRoot);

  if (args.kind || args.script) {
    if (!blender.available) {
      console.error(
        "Blender not found (set ANVIL_BLENDER or install blender on PATH). Cannot run --kind/--script forge.",
      );
      process.exit(2);
    }

    let scriptRel = null;
    if (args.script) {
      scriptRel = relative(projectRoot, resolve(projectRoot, args.script)).split("\\").join("/");
    }
    let bakeRel = null;
    if (args.bakeScript) {
      bakeRel = relative(projectRoot, resolve(projectRoot, args.bakeScript)).split("\\").join("/");
    }

    const job = createJob({
      type: "asset",
      status: "queued",
      inputs: {
        mode: args.kind ? "kind-build" : "script-build",
        kind: args.kind,
        engine: args.engine,
        script: scriptRel,
        bakeScript: bakeRel,
        brief: args.brief || null,
        bake: Boolean(args.bake || args.bakeScript),
        outDir: args.outDir || null,
        out: args.out || null,
      },
      paths: {
        artifactDir: args.outDir
          ? args.outDir
          : undefined,
      },
      blender: {
        available: true,
        path: blender.path,
        source: blender.source,
        kitDir,
        note: "sync run-asset (prefer enqueue+worker for kill-mid durability)",
      },
    });

    // Sync path: claim immediately by advancing via execute (starts from queued).
    const result = executeAssetJob(job);
    if (args.jsonOnly) console.log(JSON.stringify(result.job, null, 2));
    else {
      console.log(
        JSON.stringify(
          {
            ok: result.ok,
            jobId: result.job.id,
            status: result.job.status,
            shipGate: result.job.shipGate,
            mesh: result.job.paths?.mesh,
            paths: result.job.paths,
            validation: result.job.validation,
          },
          null,
          2,
        ),
      );
    }
    process.exit(result.ok ? 0 : 1);
  }

  const abs = resolveMesh(args.file);
  if (!abs) {
    console.error(
      "missing --file/--mesh pointing at an existing .glb under exports/, or use --kind / --script for a real Blender build",
    );
    process.exit(2);
  }

  if (!blender.available) {
    console.error(
      "Blender not found (set ANVIL_BLENDER or install blender on PATH). Refusing existing-GLB publish via simulated build/bake.",
    );
    process.exit(1);
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
      note: "sync run-asset existing-GLB",
    },
  });

  const result = executeAssetJob(job);
  if (args.jsonOnly) console.log(JSON.stringify(result.job, null, 2));
  else {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          jobId: result.job.id,
          status: result.job.status,
          shipGate: result.job.shipGate,
          mesh: result.job.paths?.mesh,
          paths: result.job.paths,
        },
        null,
        2,
      ),
    );
  }
  process.exit(result.ok ? 0 : 1);
}

main();
