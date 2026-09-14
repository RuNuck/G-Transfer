/**
 * Durable enqueue: create job JSON as queued and return jobId immediately.
 *
 *   node tools/forge-run/enqueue.mjs --kind lantern [--bake] [--engine godot] [--json]
 *   node tools/forge-run/enqueue.mjs --file|--mesh <glb> [--json]
 *   node tools/forge-run/enqueue.mjs --fake-long [--sleep-ms 30000] [--json]
 *   node tools/forge-run/enqueue.mjs --kick-worker   # also spawn worker --once detached
 */
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJob, projectRoot } from "./job-store.mjs";
import { resolveMesh } from "./execute-asset.mjs";
import { findBlender, defaultKitDir } from "./find-dcc.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    file: null,
    kind: null,
    engine: "godot",
    bake: false,
    brief: null,
    fakeLong: false,
    sleepMs: 30000,
    jsonOnly: false,
    kickWorker: false,
    outDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.jsonOnly = true;
    else if (a === "--bake") args.bake = true;
    else if (a === "--fake-long") args.fakeLong = true;
    else if (a === "--kick-worker") args.kickWorker = true;
    else if (a === "--file" || a === "--mesh") args.file = argv[++i];
    else if (a.startsWith("--file=")) args.file = a.slice(7);
    else if (a.startsWith("--mesh=")) args.file = a.slice(7);
    else if (a === "--kind") args.kind = argv[++i];
    else if (a.startsWith("--kind=")) args.kind = a.slice(7);
    else if (a === "--engine") args.engine = argv[++i];
    else if (a.startsWith("--engine=")) args.engine = a.slice(9);
    else if (a === "--brief") args.brief = argv[++i];
    else if (a.startsWith("--brief=")) args.brief = a.slice(8);
    else if (a === "--sleep-ms") args.sleepMs = Number(argv[++i]) || 30000;
    else if (a.startsWith("--sleep-ms=")) args.sleepMs = Number(a.slice(11)) || 30000;
    else if (a === "--out-dir") args.outDir = argv[++i];
    else if (a.startsWith("--out-dir=")) args.outDir = a.slice(10);
    else if (a === "--help" || a === "-h") {
      console.log(`usage:
  node tools/forge-run/enqueue.mjs --kind <kind> [--bake] [--engine godot] [--json] [--kick-worker]
  node tools/forge-run/enqueue.mjs --file|--mesh <glb> [--json] [--kick-worker]
  node tools/forge-run/enqueue.mjs --fake-long [--sleep-ms 30000] [--json] [--kick-worker]`);
      process.exit(0);
    }
  }
  return args;
}

function kickWorkerOnce() {
  const worker = join(here, "worker.mjs");
  const child = spawn(process.execPath, [worker, "--once"], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return child.pid;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const blender = findBlender();
  const kitDir = defaultKitDir(projectRoot);

  let job;
  if (args.fakeLong) {
    job = createJob({
      type: "asset",
      status: "queued",
      inputs: {
        mode: "fake-long",
        sleepMs: args.sleepMs,
      },
      blender: { available: blender.available, path: blender.path, note: "fake-long enqueue" },
    });
  } else if (args.kind) {
    job = createJob({
      type: "asset",
      status: "queued",
      inputs: {
        mode: "kind-build",
        kind: args.kind,
        engine: args.engine,
        bake: Boolean(args.bake),
        brief: args.brief || null,
        outDir: args.outDir || null,
      },
      blender: {
        available: blender.available,
        path: blender.path,
        source: blender.source,
        kitDir,
        note: "queued for durable worker",
      },
    });
  } else if (args.file) {
    const abs = resolveMesh(args.file);
    if (!abs) {
      const err = { ok: false, error: "missing --file/--mesh pointing at an existing .glb under exports/" };
      if (args.jsonOnly) console.log(JSON.stringify(err, null, 2));
      else console.error(err.error);
      process.exit(2);
    }
    const rel = relative(projectRoot, abs).split("\\").join("/");
    job = createJob({
      type: "asset",
      status: "queued",
      inputs: { mode: "existing-glb", file: rel },
      paths: { mesh: rel },
      blender: {
        available: blender.available,
        path: blender.path,
        source: blender.source,
        kitDir,
        note: "queued validate-only existing GLB",
      },
    });
  } else {
    console.error("enqueue requires --kind, --file/--mesh, or --fake-long");
    process.exit(2);
  }

  let workerPid = null;
  if (args.kickWorker) {
    workerPid = kickWorkerOnce();
  }

  const payload = {
    ok: true,
    enqueued: true,
    jobId: job.id,
    status: job.status,
    paths: job.paths,
    workerKicked: Boolean(workerPid),
    workerPid,
    poll: `node tools/forge-run/status.mjs ${job.id} --json`,
  };
  if (args.jsonOnly) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`${job.id}  queued`);
    if (workerPid) console.log(`worker kicked pid ${workerPid}`);
  }
}

main();
