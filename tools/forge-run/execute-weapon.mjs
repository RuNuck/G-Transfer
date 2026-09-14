/**
 * Execute type=weapon jobs: WeaponGraph → rifle kit Blender forge → validate + weapon gates → ship.
 * Fail closed. Never published+ok without Godot import when Godot present.
 * Mesh is a real kit carbine (not part-accurate M4 CAD) sized to overallLengthM.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { advanceStage, failJob, failJobHard, projectRoot, saveJob } from "./job-store.mjs";
import { defaultKitDir, findBlender } from "./find-dcc.mjs";
import { finishPublished, runHeadlessBlender } from "./execute-asset.mjs";
import { ensureGripPivotInGlb } from "./ensure-grip-pivot.mjs";
import { readGlb, summarizeGlb } from "../validate/glb-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function loadAnvil() {
  const require = createRequire(import.meta.url);
  const jitiFactory = require("jiti");
  const load = jitiFactory(import.meta.url, { esmResolve: true });
  return {
    specFromKind: load(join(projectRoot, "src/lib/assets/spec.ts")).specFromKind,
    blenderScript: load(join(projectRoot, "src/lib/assets/blender-script.ts")).blenderScript,
    bakeScript: load(join(projectRoot, "src/lib/assets/blender-script.ts")).bakeScript,
    meshName: load(join(projectRoot, "src/lib/assets/naming.ts")).meshName,
    collisionName: load(join(projectRoot, "src/lib/assets/naming.ts")).collisionName,
  };
}

function slugName(graph) {
  const raw = graph.displayName || graph.id || "weapon";
  return String(raw)
    .replace(/^weapon\./, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
}

/**
 * Emit a rifle-kind build sized to the WeaponGraph (kit family rifle).
 * Returns paths + mesh name. Labels honesty: kit carbine, not CAD M4.
 */
export function emitWeaponBuild(graph, { engine = "godot", outDir, bake = true } = {}) {
  const api = loadAnvil();
  const lengthM = Number(graph.overallLengthM) || 0.84;
  const spec = api.specFromKind("rifle", engine);
  // Prefer display name that yields m4_* / weapon-like mesh for path gates.
  const preset = graph.preset || "custom";
  if (preset === "m4_carbine" || preset === "m4_cqbr") {
    spec.name = preset === "m4_cqbr" ? "M4 CQBR" : "M4 Carbine";
  } else {
    spec.name = graph.displayName || slugName(graph).replace(/_/g, " ");
  }
  spec.brief =
    (graph.displayName || graph.id) +
    ` WeaponGraph forge (${preset}); overallLengthM=${lengthM}; kitFamily=rifle (parametric kit carbine, not CAD-accurate M4 parts).`;
  spec.dimensions = {
    x: lengthM,
    y: Math.min(0.28, Math.max(0.18, lengthM * 0.26)),
    z: Math.min(0.09, Math.max(0.06, lengthM * 0.085)),
  };
  // Weapons: center pivot; grip gate also accepts rootNearOrigin / grip node names.
  spec.pivot = "center";
  if (graph.collision?.style === "godot_convcolonly" || graph.collision?.style === "godot_colonly") {
    spec.collision = graph.collision.style.includes("conv") ? "convex" : "box";
  }

  const mesh = api.meshName(spec);
  const collision = api.collisionName(spec);
  const dir = resolve(outDir || join(projectRoot, "tools/blender-check/out/gen"));
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `weapon_${preset}_${engine}`);
  const buildPath = `${base}.py`;
  const bakePath = `${base}.bake.py`;
  const metaPath = `${base}.json`;
  writeFileSync(buildPath, api.blenderScript(spec));
  if (bake) writeFileSync(bakePath, api.bakeScript(spec));
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        honesty: "kit_carbine_via_rifle_family",
        note: "Real Blender kit forge; not part-accurate M4 CAD. STUB only if Blender/kit unavailable (fail closed).",
        graphId: graph.id,
        preset,
        overallLengthM: lengthM,
        mesh,
        collision,
        dimensions: spec.dimensions,
      },
      null,
      2,
    ) + "\n",
  );
  return {
    spec,
    mesh,
    collision,
    buildPath,
    bakePath: bake ? bakePath : null,
    metaPath,
    lengthM,
    honesty: "kit_carbine_via_rifle_family",
  };
}

/**
 * Extra weapon gates when artifact exists: length vs overallLengthM, claimed clips present.
 * Returns { ok, hardFails, details }.
 */
export function weaponArtifactGates(absGlb, graph) {
  const hardFails = [];
  const details = {};
  let summary;
  try {
    const parsed = readGlb(absGlb);
    summary = summarizeGlb(parsed, absGlb);
  } catch (e) {
    return { ok: false, hardFails: ["weapon_glb_parse"], details: { error: String(e.message || e) } };
  }

  const lengthM = Number(graph.overallLengthM);
  if (Number.isFinite(lengthM) && lengthM > 0 && summary.bounds) {
    const size = summary.bounds.size;
    const maxDim = Math.max(...size);
    const tol = Math.max(0.12, lengthM * 0.2);
    const okLen = Math.abs(maxDim - lengthM) <= tol;
    details.meters = {
      overallLengthM: lengthM,
      aabbMaxM: maxDim,
      aabb: size,
      toleranceM: tol,
      ok: okLen,
    };
    if (!okLen) hardFails.push("weapon_length_meters");
  } else if (Number.isFinite(lengthM) && lengthM > 0) {
    hardFails.push("weapon_length_meters");
    details.meters = { overallLengthM: lengthM, ok: false, error: "no bounds" };
  }

  const pivot = summary.pivot || {};
  const gripOk = Boolean(pivot.gripNode) || pivot.rootNearOrigin === true;
  details.pivot = {
    gripNode: pivot.gripNode || null,
    rootNearOrigin: pivot.rootNearOrigin,
    ok: gripOk,
    claimed: graph.pivot || null,
  };
  if (!gripOk) hardFails.push("weapon_grip_pivot");

  const nodes = summary.nodes || [];
  const hasCol = nodes.some((n) => /-(?:conv)?col(?:only)?$/i.test(n || ""));
  details.collision = { ok: hasCol, style: graph.collision?.style || null, nodes: nodes.filter((n) => /col/i.test(n || "")) };
  if (!hasCol) hardFails.push("weapon_collision");

  const claimed = Array.isArray(graph.clips) ? graph.clips.map((c) => c.name).filter(Boolean) : [];
  const present = summary.animations || [];
  details.clips = { claimed, present, ok: true };
  if (claimed.length) {
    const missing = claimed.filter((name) => !present.includes(name));
    // Accept if all claimed present, OR if kit exported a strict subset of known demo names
    // with at least 1 clip when graph claims clips (kit ACTIONS names match graph for m4).
    const hit = claimed.filter((name) => present.includes(name));
    if (present.length === 0) {
      details.clips.ok = false;
      details.clips.missing = claimed;
      hardFails.push("weapon_clips_claimed");
    } else if (hit.length === 0) {
      details.clips.ok = false;
      details.clips.missing = claimed;
      details.clips.note = "GLB has animations but none match WeaponGraph clip names";
      hardFails.push("weapon_clips_claimed");
    } else if (missing.length) {
      details.clips.missing = missing;
      details.clips.ok = hit.length >= Math.min(3, claimed.length);
      details.clips.note = `partial clip match ${hit.length}/${claimed.length}`;
      if (!details.clips.ok) hardFails.push("weapon_clips_claimed");
    } else {
      details.clips.ok = true;
    }
  }

  return { ok: hardFails.length === 0, hardFails, details, summary };
}

/**
 * Run a claimed weapon job to terminal status.
 */
export async function executeWeaponJob(job) {
  const blender = findBlender();
  const kitDir = defaultKitDir(projectRoot);
  const graph = job.inputs?.graph;
  const engine = job.inputs?.engine || graph?.engine || "godot";
  const bake = job.inputs?.bake !== false; // default bake on — PBR required to publish

  try {
    if (!graph || typeof graph !== "object") {
      failJobHard(job, "weapon_graph_missing", "weapon job missing inputs.graph");
      return { ok: false, job };
    }

    if (!blender.available) {
      job.notes = job.notes || [];
      job.notes.push("STUB: Blender unavailable — cannot forge weapon mesh; fail closed (never fake ready)");
      failJobHard(job, "blender_absent", "Blender not found — weapon forge refuses stub ready");
      return { ok: false, job };
    }
    if (!kitDir) {
      job.notes = job.notes || [];
      job.notes.push("STUB: ANVIL kit dir missing — refuse fake carbine");
      failJobHard(job, "weapon_kit_absent", "rifle kit dir missing under public/downloads");
      return { ok: false, job };
    }

    const genDir = join(projectRoot, "tools/blender-check/out/gen");
    const emitted = emitWeaponBuild(graph, { engine, outDir: genDir, bake });
    job.paths.weaponGraph = job.inputs.graphPath || null;
    job.paths.buildScript = relative(projectRoot, emitted.buildPath).split("\\").join("/");
    if (emitted.bakePath) {
      job.paths.bakeScript = relative(projectRoot, emitted.bakePath).split("\\").join("/");
    }
    job.honesty = emitted.honesty;
    job.notes = job.notes || [];
    job.notes.push(
      `forge path: rifle kit → ${emitted.mesh}.glb @ ${emitted.lengthM}m (kit carbine, not CAD M4 parts)`,
    );
    saveJob(job);

    const outDir = resolve(projectRoot, job.paths.artifactDir || `exports/forge/${job.id}`);
    mkdirSync(outDir, { recursive: true });
    // Persist resolved graph next to artifact for audit.
    const graphOut = join(outDir, "weapon.graph.json");
    writeFileSync(graphOut, JSON.stringify(graph, null, 2) + "\n");
    job.paths.weaponGraph = relative(projectRoot, graphOut).split("\\").join("/");

    const exportName = join(outDir, `${emitted.mesh}.glb`);
    job.blender = {
      available: true,
      path: blender.path,
      source: blender.source,
      kitDir,
      note: "weapon forge: headless Blender + rifle kit + ANVIL_RIG=1",
      honesty: emitted.honesty,
    };
    if (job.status !== "building") {
      advanceStage(job, "building", `weapon Blender build: ${blender.path}`);
    } else {
      job.notes.push(`weapon Blender build: ${blender.path}`);
      saveJob(job);
    }

    // Stay in building until Blender is live; record PID for kill-mid (same as asset path).
    job.worker = {
      ...(job.worker || {}),
      blenderSpawnPending: true,
      blenderPath: blender.path,
    };
    saveJob(job);

    const bakeScript = bake ? emitted.bakePath : null;
    const run = await runHeadlessBlender({
      blenderPath: blender.path,
      buildScript: emitted.buildPath,
      bakeScript,
      exportPath: exportName,
      kitDir,
      extraEnv: { ANVIL_RIG: "1" },
      onSpawn(pid) {
        job.worker = {
          ...(job.worker || {}),
          blenderSpawnPending: false,
          blenderPid: pid,
          blenderStartedAt: new Date().toISOString(),
        };
        saveJob(job);
        if (bakeScript && job.status !== "baking") {
          advanceStage(job, "baking", `weapon bake (pid ${pid}): ${bakeScript}`);
        }
      },
    });
    if (!bakeScript) {
      job.notes = job.notes || [];
      job.notes.push("bake skipped — expect PBR hard-fail (fail closed)");
      saveJob(job);
    }
    job.blender.logTail = (run.stdout + "\n" + run.stderr).slice(-4000);
    job.blender.exitCode = run.exitCode;
    const kitUsed = /part kit/i.test(run.stdout) || /USING_KIT|Anvil kit/i.test(run.stdout);
    const sourceMatch = run.stdout.match(/built \((part kit|blockout)\)/i);
    job.blender.buildSource = sourceMatch ? sourceMatch[1].toLowerCase() : kitUsed ? "kit?" : "unknown";
    saveJob(job);

    if (run.exitCode !== 0 || !existsSync(exportName)) {
      failJob(
        job,
        `weapon Blender failed (exit ${run.exitCode}): ` +
          (run.stderr || run.stdout || "").split("\n").slice(-20).join(" | "),
      );
      return { ok: false, job };
    }

    if (job.blender.buildSource === "blockout") {
      job.notes.push("WARNING: kit did not engage — blockout fallback; still validating fail-closed");
    }

    job.paths.mesh = relative(projectRoot, exportName).split("\\").join("/");
    job.paths.textures = relative(projectRoot, run.texDir).split("\\").join("/");
    saveJob(job);

    try {
      const gripPatch = ensureGripPivotInGlb(exportName, graph);
      job.notes.push(
        gripPatch.patched
          ? `injected grip pivot node @ [${(gripPatch.translation || []).join(", ")}]`
          : `grip pivot: ${gripPatch.reason || "ok"}`,
      );
      saveJob(job);
    } catch (e) {
      failJobHard(job, "weapon_grip_inject", "failed to inject grip pivot: " + (e.message || e));
      return { ok: false, job };
    }

    // Weapon-specific gates before ship publish.
    advanceStage(job, "validating", "weapon artifact gates (meters/pivot/collision/clips)");
    const wg = weaponArtifactGates(exportName, graph);
    job.weaponGates = wg;
    saveJob(job);
    if (!wg.ok) {
      job.validation = {
        ok: false,
        hardFails: wg.hardFails,
        report: wg.details,
      };
      failJobHard(job, wg.hardFails[0] || "weapon_gates", "weapon gates failed: " + wg.hardFails.join(", "));
      return { ok: false, job };
    }

    return finishPublished(job, exportName, job.blender);
  } catch (e) {
    failJob(job, e.message || String(e));
    return { ok: false, job };
  }
}

void here;
