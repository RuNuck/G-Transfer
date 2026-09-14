/**
 * Durable enqueue for forge_weapon / CLI.
 *
 *   node tools/forge-run/enqueue-weapon.mjs --preset m4_carbine [--bake] [--engine godot] [--json] [--kick-worker]
 *   node tools/forge-run/enqueue-weapon.mjs --graph docs/schemas/examples/m4-carbine.weapon.json [--json]
 *   node tools/forge-run/enqueue-weapon.mjs --graph-json '{"schemaVersion":1,...}' [--overrides-json '{...}']
 */
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createJob, projectRoot } from "./job-store.mjs";
import { findBlender, defaultKitDir } from "./find-dcc.mjs";
import { resolveWeaponGraphInput, PRESET_FILES } from "./resolve-weapon-graph.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    preset: null,
    graph: null,
    graphJson: null,
    overridesJson: null,
    engine: "godot",
    bake: true,
    jsonOnly: false,
    kickWorker: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.jsonOnly = true;
    else if (a === "--kick-worker") args.kickWorker = true;
    else if (a === "--bake") args.bake = true;
    else if (a === "--no-bake") args.bake = false;
    else if (a === "--preset") args.preset = argv[++i];
    else if (a.startsWith("--preset=")) args.preset = a.slice(9);
    else if (a === "--graph" || a === "--weapon-graph") args.graph = argv[++i];
    else if (a.startsWith("--graph=")) args.graph = a.slice(8);
    else if (a.startsWith("--weapon-graph=")) args.graph = a.slice(15);
    else if (a === "--graph-json" || a === "--weapon-graph-json") args.graphJson = argv[++i];
    else if (a.startsWith("--graph-json=")) args.graphJson = a.slice(13);
    else if (a === "--overrides-json") args.overridesJson = argv[++i];
    else if (a.startsWith("--overrides-json=")) args.overridesJson = a.slice(17);
    else if (a === "--engine") args.engine = argv[++i];
    else if (a.startsWith("--engine=")) args.engine = a.slice(9);
    else if (a === "--help" || a === "-h") {
      console.log(`usage:
  node tools/forge-run/enqueue-weapon.mjs --preset m4_carbine [--bake|--no-bake] [--engine godot] [--json] [--kick-worker]
  node tools/forge-run/enqueue-weapon.mjs --graph <WeaponGraph.json> [--overrides-json '{…}'] [--json] [--kick-worker]
  node tools/forge-run/enqueue-weapon.mjs --graph-json '<json>' [--json]
presets: ${Object.keys(PRESET_FILES).join(", ")}`);
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
  let overrides = null;
  if (args.overridesJson) {
    try {
      overrides = JSON.parse(args.overridesJson);
    } catch (e) {
      const err = { ok: false, error: "overrides-json parse failed: " + e.message };
      console.log(JSON.stringify(err, null, 2));
      process.exit(2);
    }
  }

  let resolved;
  try {
    resolved = resolveWeaponGraphInput({
      preset: args.preset,
      graphPath: args.graph,
      graphJson: args.graphJson,
      overrides,
    });
  } catch (e) {
    const err = { ok: false, error: String(e.message || e), check: e.check || null };
    if (args.jsonOnly) console.log(JSON.stringify(err, null, 2));
    else console.error(err.error);
    process.exit(2);
  }

  const blender = findBlender();
  const kitDir = defaultKitDir(projectRoot);

  // Persist graph snapshot under .anvil for the job input reference.
  const snapDir = join(projectRoot, ".anvil", "weapon-graphs");
  mkdirSync(snapDir, { recursive: true });
  const snapName = `enq_${Date.now()}.weapon.json`;
  const snapAbs = join(snapDir, snapName);
  writeFileSync(snapAbs, JSON.stringify(resolved.graph, null, 2) + "\n");
  const snapRel = relative(projectRoot, snapAbs).split("\\").join("/");

  const job = createJob({
    type: "weapon",
    status: "queued",
    inputs: {
      mode: "weapon-graph",
      preset: resolved.graph.preset || args.preset || null,
      engine: args.engine || resolved.graph.engine || "godot",
      bake: Boolean(args.bake),
      graph: resolved.graph,
      graphPath: snapRel,
      source: resolved.source,
      overrides: overrides || null,
    },
    paths: {
      weaponGraph: snapRel,
    },
    blender: {
      available: blender.available,
      path: blender.path,
      source: blender.source,
      kitDir,
      note: "queued weapon forge (rifle kit + ANVIL_RIG)",
    },
    notes: [
      `weapon enqueue source=${resolved.source} preset=${resolved.graph.preset || "?"} lengthM=${resolved.graph.overallLengthM ?? "?"}`,
    ],
  });

  let workerPid = null;
  if (args.kickWorker) workerPid = kickWorkerOnce();

  const payload = {
    ok: true,
    enqueued: true,
    jobId: job.id,
    status: job.status,
    type: job.type,
    preset: job.inputs.preset,
    paths: job.paths,
    workerKicked: Boolean(workerPid),
    workerPid,
    poll: `node tools/forge-run/status.mjs ${job.id} --json`,
  };
  if (args.jsonOnly) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`${job.id}  queued  type=weapon  preset=${job.inputs.preset || "?"}`);
    if (workerPid) console.log(`worker kicked pid ${workerPid}`);
  }
}

main();
