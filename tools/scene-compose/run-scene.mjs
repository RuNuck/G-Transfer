/**
 * Phase 4 forge_scene runner (scaffold).
 *
 *   node tools/scene-compose/run-scene.mjs --spec <SceneSpec.json> [--json]
 *   node tools/scene-compose/run-scene.mjs --brief "jungle clearing…" [--json]
 *
 * Creates a type=scene job, runs compose scaffold, marks published.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createJob, advanceStage, failJob, projectRoot, saveJob } from "../forge-run/job-store.mjs";
import { composeScene } from "./compose.mjs";

const DEFAULT_SPEC = "docs/schemas/examples/jungle-clearing.scene.json";

function parseArgs(argv) {
  const args = { spec: null, brief: null, sceneSpecJson: null, jsonOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.jsonOnly = true;
    else if (a === "--spec") args.spec = argv[++i];
    else if (a.startsWith("--spec=")) args.spec = a.slice(7);
    else if (a === "--brief") args.brief = argv[++i];
    else if (a.startsWith("--brief=")) args.brief = a.slice(8);
    else if (a === "--scene-spec-json") args.sceneSpecJson = argv[++i];
    else if (a.startsWith("--scene-spec-json=")) args.sceneSpecJson = a.slice(18);
    else if (a === "--help" || a === "-h") {
      console.log("usage: node tools/scene-compose/run-scene.mjs --spec <json> | --brief <text> | --scene-spec-json <json-string> [--json]");
      process.exit(0);
    }
  }
  return args;
}

function resolveSpecPath(args, jobId) {
  if (args.sceneSpecJson) {
    const dir = join(projectRoot, ".anvil", "scene-specs");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `${jobId || "tmp"}.scene.json`);
    const parsed = typeof args.sceneSpecJson === "string" ? JSON.parse(args.sceneSpecJson) : args.sceneSpecJson;
    writeFileSync(p, JSON.stringify(parsed, null, 2) + "\n");
    return p;
  }
  if (args.spec) {
    const abs = resolve(projectRoot, args.spec);
    if (!existsSync(abs)) throw new Error("spec not found: " + args.spec);
    return abs;
  }
  // Brief-only scaffold: use jungle clearing example
  const fallback = resolve(projectRoot, DEFAULT_SPEC);
  if (!existsSync(fallback)) throw new Error("default SceneSpec missing: " + DEFAULT_SPEC);
  return fallback;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.spec && !args.brief && !args.sceneSpecJson) {
    console.error("need --spec, --brief, or --scene-spec-json");
    process.exit(2);
  }

  const job = createJob({
    type: "scene",
    status: "queued",
    inputs: {
      brief: args.brief || null,
      spec: args.spec || null,
      mode: args.sceneSpecJson ? "sceneSpec-object" : args.spec ? "spec-path" : "brief-default-example",
    },
    blender: { available: false, note: "scene scaffold does not invoke Blender" },
  });

  try {
    const specPath = resolveSpecPath(args, job.id);
    const relSpec = relative(projectRoot, specPath).split("\\").join("/");
    job.inputs.specResolved = relSpec;
    if (args.brief) job.notes.push("brief: " + args.brief);
    saveJob(job);

    advanceStage(job, "building", "scene-compose scaffold layout");
    advanceStage(job, "baking", "skipped (scene scaffold — no bake)");
    advanceStage(job, "validating", "compose + write report/manifest");

    const report = composeScene(specPath);
    job.paths = {
      ...job.paths,
      scene: report.paths.sceneTscn,
      report: report.paths.report,
      manifest: report.paths.manifest,
      dir: report.paths.dir,
    };
    job.validation = {
      ok: true,
      hardFails: [],
      counts: report.instanceCounts,
      report: {
        status: report.status,
        contentHash: report.contentHash,
        kitMissing: (report.kitNotes || []).filter((k) => k.status === "missing").length,
      },
    };
    saveJob(job);

    advanceStage(job, "published", "scene scaffold written to " + report.paths.dir);

    if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
    else {
      console.log(
        JSON.stringify(
          {
            ok: true,
            jobId: job.id,
            status: job.status,
            type: job.type,
            sceneId: report.sceneId,
            paths: job.paths,
            seed: report.seed,
            instanceTotal: report.instanceTotal,
          },
          null,
          2,
        ),
      );
    }
    process.exit(0);
  } catch (e) {
    failJob(job, e.message || String(e));
    if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
    else console.error(JSON.stringify({ ok: false, jobId: job.id, error: e.message || String(e) }, null, 2));
    process.exit(1);
  }
}

main();
