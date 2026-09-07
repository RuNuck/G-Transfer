/**
 * Phase 4 forge_scene runner (scaffold).
 *
 *   node tools/scene-compose/run-scene.mjs --spec <SceneSpec.json> [--json]
 *   node tools/scene-compose/run-scene.mjs --brief "jungle clearing…" [--json]
 *
 * Creates a type=scene job, runs compose scaffold, marks published.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { createJob, advanceStage, failJob, projectRoot, saveJob } from "../forge-run/job-store.mjs";
import { findGodot } from "../forge-run/find-dcc.mjs";
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


function runGodotSceneOpen(absTscn) {
  const godot = findGodot();
  if (!godot.available) {
    return {
      ran: false,
      available: false,
      ok: null,
      status: "godot_absent",
      problems: [],
      note: "Godot not available — scene open skipped (caller may still publish after kits_resolve)",
      source: godot.source,
      path: godot.path,
    };
  }
  const checker = resolve(projectRoot, "tools/godot-check/check-scene.mjs");
  if (!existsSync(checker)) {
    return {
      ran: false,
      available: true,
      ok: false,
      status: "blocked",
      problems: ["check-scene.mjs missing"],
      note: "check-scene.mjs missing",
      source: godot.source,
      path: godot.path,
    };
  }
  const env = { ...process.env, ANVIL_GODOT: godot.path };
  const r = spawnSync(process.execPath, [checker, absTscn], {
    cwd: projectRoot,
    encoding: "utf8",
    env,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 600000,
  });
  let doc = null;
  try {
    doc = JSON.parse((r.stdout || "").trim());
  } catch {
    const m = (r.stdout || "").match(/\{[\s\S]*\}\s*$/);
    if (m) {
      try { doc = JSON.parse(m[0]); } catch { /* ignore */ }
    }
  }
  const ok = Boolean(doc?.ok) && (r.status ?? 1) === 0;
  return {
    ran: true,
    available: true,
    ok,
    status: ok ? "ready" : "blocked",
    exitCode: r.status ?? 1,
    problems: doc?.problems ?? (ok ? [] : ["scene open failed"]),
    note: doc?.note || (ok ? "Godot headless scene open ok" : "Godot scene open failed"),
    source: godot.source,
    path: godot.path,
    godotVersion: doc?.godot || null,
  };
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
    const kitsResolve = !(report.kitNotes || []).some((k) => k.status === "missing");
    const hardFails = kitsResolve ? [] : ["kits_resolve"];
    job.validation = {
      ok: kitsResolve,
      hardFails,
      counts: report.instanceCounts,
      report: {
        status: kitsResolve ? report.status : "scaffold",
        contentHash: report.contentHash,
        kitMissing: (report.kitNotes || []).filter((k) => k.status === "missing").length,
        kits_resolve: kitsResolve,
      },
    };
    saveJob(job);

    // Honesty: never mark published/ok when kits unresolved — scaffold/failed only.
    if (!kitsResolve) {
      failJob(job, "kits_resolve false — scene remains scaffold (kit GLBs missing); not published");
      if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
      else {
        console.log(
          JSON.stringify(
            {
              ok: false,
              jobId: job.id,
              status: job.status,
              type: job.type,
              sceneId: report.sceneId,
              shipStatus: "scaffold",
              paths: job.paths,
              kitMissing: job.validation.report.kitMissing,
              error: "kits_resolve false",
            },
            null,
            2,
          ),
        );
      }
      process.exit(1);
    }

    // When Godot is present, refuse published/ok until scene.tscn opens headlessly.
    const absTscn = resolve(projectRoot, report.paths.sceneTscn);
    advanceStage(job, "validating", "Godot headless open scene.tscn (when available)");
    const sceneOpen = runGodotSceneOpen(absTscn);
    job.godotScene = sceneOpen;
    job.shipGate = sceneOpen.available ? sceneOpen.status : "kits_resolved_godot_absent";
    saveJob(job);

    if (sceneOpen.available && sceneOpen.ok === false) {
      job.validation.ok = false;
      job.validation.hardFails = [...new Set([...(job.validation.hardFails || []), "godot_scene_open"])];
      failJob(job, "Godot scene open failed: " + ((sceneOpen.problems || []).join("; ") || sceneOpen.note));
      if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
      else {
        console.log(
          JSON.stringify(
            {
              ok: false,
              jobId: job.id,
              status: job.status,
              type: job.type,
              sceneId: report.sceneId,
              shipGate: job.shipGate,
              godotScene: sceneOpen,
              paths: job.paths,
              error: "godot_scene_open",
            },
            null,
            2,
          ),
        );
      }
      process.exit(1);
    }

    const publishNote = sceneOpen.available
      ? "scene kits resolved + Godot opened scene.tscn; written to " + report.paths.dir
      : "scene kits resolved (Godot absent — open skipped); written to " + report.paths.dir;
    advanceStage(job, "published", publishNote);

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
            shipGate: job.shipGate,
            godotScene: {
              ok: sceneOpen.ok,
              available: sceneOpen.available,
              note: sceneOpen.note,
            },
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
