/**
 * Shared asset-job execution for sync run-asset and durable worker.
 * Ship gates unchanged: Godot absent fail-close, PBR validate, mesh under exports/.
 */
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { advanceStage, failJob, failJobHard, projectRoot, quarantineJobArtifacts, saveJob } from "./job-store.mjs";
import { defaultKitDir, findBlender } from "./find-dcc.mjs";
import { runGodotImportCheck, patchIndexShipGate } from "./ship-gate.mjs";
import { emitKind } from "./emit-script.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const HEADLESS = resolve(here, "headless-run.py");

export function underExports(absPath) {
  const root = resolve(projectRoot, "exports");
  let abs;
  try {
    abs = realpathSync(absPath);
  } catch {
    abs = resolve(absPath);
  }
  let rootReal = root;
  try {
    rootReal = realpathSync(root);
  } catch {
    /* exports may be absent */
  }
  return abs === rootReal || abs.startsWith(rootReal + "/") || abs.startsWith(rootReal + "\\");
}

/** Resolve an existing .glb strictly under exports/. */
export function resolveMesh(input) {
  if (!input) return null;
  const exportsRoot = resolve(projectRoot, "exports");
  const candidates = [];
  if (isAbsolute(input)) {
    candidates.push(resolve(input));
  } else {
    candidates.push(resolve(projectRoot, input));
    candidates.push(resolve(exportsRoot, input));
    candidates.push(resolve(exportsRoot, "forge", input));
    if (!input.toLowerCase().endsWith(".glb")) {
      candidates.push(resolve(exportsRoot, "forge", input + ".glb"));
      candidates.push(resolve(exportsRoot, input + ".glb"));
    }
  }
  for (const c of candidates) {
    const abs = resolve(c);
    if (!underExports(abs)) continue;
    if (!abs.toLowerCase().endsWith(".glb")) continue;
    if (existsSync(abs)) return abs;
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

export function runHeadlessBlender({ blenderPath, buildScript, bakeScript, exportPath, kitDir, extraEnv = {}, onSpawn }) {
  mkdirSync(dirname(exportPath), { recursive: true });
  const texDir = join(dirname(exportPath), "textures");
  mkdirSync(texDir, { recursive: true });
  const env = {
    ...process.env,
    ANVIL_EXPORT_PATH: exportPath,
    ANVIL_TEXTURE_DIR: texDir,
    ...extraEnv,
  };
  if (kitDir) env.ANVIL_KIT_DIR = kitDir;
  const pyArgs = [HEADLESS, "--", buildScript];
  if (bakeScript) pyArgs.push(bakeScript);
  const args = ["--background", "--python", ...pyArgs];

  // Async spawn so durable worker / kill-mid smoke can observe Blender PID in-tree.
  return new Promise((resolve) => {
    const child = spawn(blenderPath, args, {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (typeof onSpawn === "function") {
      try {
        onSpawn(child.pid);
      } catch {
        /* ignore */
      }
    }
    let stdout = "";
    let stderr = "";
    const cap = 32 * 1024 * 1024;
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > cap) stdout = stdout.slice(-cap / 2);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > cap) stderr = stderr.slice(-cap / 2);
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* */
      }
    }, 600000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout,
        stderr: String(stderr || "") + "\n" + String(err?.message || err),
        exportPath,
        texDir,
        signal: null,
        pid: child.pid,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: stdout || "",
        stderr: stderr || "",
        exportPath,
        texDir,
        signal: signal || null,
        pid: child.pid,
      });
    });
  });
}

function sleepSync(ms) {
  const end = Date.now() + Math.max(0, ms);
  while (Date.now() < end) {
    const slice = Math.min(500, end - Date.now());
    if (slice <= 0) break;
    spawnSync("sleep", [String(slice / 1000)], { encoding: "utf8" });
  }
}

/**
 * Validate + Godot ship gate + index. Never published+ok unless shipGate===ready.
 * @returns {{ ok: boolean, job: object }}
 */
export function finishPublished(job, abs, blenderInfo = {}) {
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
    return { ok: false, job };
  }

  advanceStage(job, "validating", "running tools/godot-check (ship gate)");
  const ship = runGodotImportCheck(abs);
  job.godotImport = ship;
  job.shipGate = ship.status;
  saveJob(job);

  if (ship.status !== "ready") {
    const failId = ship.available ? "godot_import" : "godot_absent";
    job.validation.ok = false;
    job.validation.hardFails = [...new Set([...(job.validation.hardFails || []), failId])];
    saveJob(job);
    const idxBlocked = rebuildIndex();
    job.paths.index = "exports/index.json";
    if (idxBlocked.exitCode === 0) {
      job.paths.indexStatus = patchIndexShipGate(rel, ship) || ship.status;
    }
    failJob(
      job,
      ship.available
        ? "godot import ship gate blocked: " + ((ship.problems || []).join("; ") || ship.note)
        : "Godot absent — shipGate validated_glb_only (refuse published+ok; hardFail godot_absent)",
    );
    return { ok: false, job };
  }

  const idx = rebuildIndex();
  job.paths.index = "exports/index.json";
  if (idx.exitCode !== 0) {
    failJob(job, "index rebuild failed: " + (idx.stderr || idx.stdout || "exit " + idx.exitCode));
    return { ok: false, job };
  }

  const indexStatus = patchIndexShipGate(rel, ship) || ship.status;
  job.paths.indexStatus = indexStatus;
  saveJob(job);

  advanceStage(job, "published", "validated + godot import ok + index ready");
  return { ok: true, job };
}

/**
 * Run a claimed/created asset job to terminal status.
 * Supports inputs.mode: kind-build | script-build | existing-glb | fake-long
 */
export async function executeAssetJob(job) {
  const blender = findBlender();
  const kitDir = defaultKitDir(projectRoot);
  const mode = job.inputs?.mode;

  try {
    if (mode === "fake-long") {
      const sleepMs = Number(job.inputs.sleepMs) || 30000;
      const artRel = job.paths.artifactDir || `exports/forge/${job.id}`;
      const artAbs = resolve(projectRoot, artRel);
      mkdirSync(artAbs, { recursive: true });
      const partial = join(artAbs, "partial.glb");
      writeFileSync(partial, "ANVIL_PARTIAL_NOT_SHIP_GATED\n");
      job.paths.mesh = relative(projectRoot, partial).split("\\").join("/");
      job.paths.artifactDir = artRel;
      job.blender = { available: blender.available, path: blender.path, note: "fake-long smoke stage" };
      if (job.status !== "building") {
        advanceStage(job, "building", `fake-long sleep ${sleepMs}ms (kill-mid smoke)`);
      } else {
        job.notes = job.notes || [];
        job.notes.push(`fake-long sleep ${sleepMs}ms (kill-mid smoke)`);
        saveJob(job);
      }
      sleepSync(sleepMs);
      quarantineJobArtifacts(job);
      failJobHard(job, "fake_long_completed", "fake-long finished without interrupt — not publishable");
      return { ok: false, job };
    }

    if (mode === "kind-build" || mode === "script-build") {
      if (!blender.available) {
        failJob(job, "Blender not found (set ANVIL_BLENDER or install blender on PATH)");
        return { ok: false, job };
      }
      if (!existsSync(HEADLESS)) {
        failJob(job, "missing headless runner: " + HEADLESS);
        return { ok: false, job };
      }

      let buildScript = job.inputs.script ? resolve(projectRoot, job.inputs.script) : null;
      let bakeScript = job.inputs.bakeScript ? resolve(projectRoot, job.inputs.bakeScript) : null;
      let meshName = job.inputs.meshName || null;
      let emitted = null;

      if (mode === "kind-build" && job.inputs.kind) {
        emitted = emitKind({
          kind: job.inputs.kind,
          engine: job.inputs.engine || "godot",
          outDir: join(projectRoot, "tools/blender-check/out/gen"),
          bake: true,
        });
        buildScript = emitted.buildPath;
        meshName = emitted.mesh;
        if (job.inputs.bake) bakeScript = emitted.bakePath;
      }

      if (!buildScript || !existsSync(buildScript)) {
        failJob(job, "build script missing: " + buildScript);
        return { ok: false, job };
      }

      const outDir = resolve(
        projectRoot,
        job.paths.artifactDir || job.inputs.outDir || `exports/forge/${job.id}`,
      );
      mkdirSync(outDir, { recursive: true });
      const exportName = job.inputs.out
        ? resolve(projectRoot, job.inputs.out)
        : join(outDir, `${meshName || basename(buildScript, ".py")}.glb`);

      job.paths.artifactDir = relative(projectRoot, outDir).split("\\").join("/");
      job.blender = {
        available: true,
        path: blender.path,
        source: blender.source,
        kitDir,
        note: "headless Blender build via tools/forge-run/headless-run.py",
      };
      saveJob(job);

      if (job.status !== "building") {
        advanceStage(job, "building", `Blender headless build: ${blender.path}`);
      } else {
        job.notes = job.notes || [];
        job.notes.push(`Blender headless build: ${blender.path}`);
        saveJob(job);
      }

      // Stay in building until Blender is live; record PID for kill-mid.
      // With --bake, advance to baking once Blender PID is known (same spawn runs bake).
      job.worker = {
        ...(job.worker || {}),
        blenderSpawnPending: true,
        blenderPath: blender.path,
      };
      saveJob(job);

      const run = await runHeadlessBlender({
        blenderPath: blender.path,
        buildScript,
        bakeScript,
        exportPath: exportName,
        kitDir,
        onSpawn(pid) {
          job.worker = {
            ...(job.worker || {}),
            blenderSpawnPending: false,
            blenderPid: pid,
            blenderStartedAt: new Date().toISOString(),
          };
          saveJob(job);
          if (bakeScript && job.status !== "baking") {
            advanceStage(job, "baking", `Blender bake (pid ${pid}): ${bakeScript}`);
          }
        },
      });
      if (!bakeScript) {
        job.notes = job.notes || [];
        job.notes.push("bake skipped (--bake not set); materials are untextured Principled BSDF");
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
          `Blender headless failed (exit ${run.exitCode}): ` +
            (run.stderr || run.stdout || "").split("\n").slice(-20).join(" | "),
        );
        return { ok: false, job };
      }

      job.paths.mesh = relative(projectRoot, exportName).split("\\").join("/");
      job.paths.textures = relative(projectRoot, run.texDir).split("\\").join("/");
      if (emitted) {
        job.paths.buildScript = relative(projectRoot, emitted.buildPath).split("\\").join("/");
        if (bakeScript) job.paths.bakeScript = relative(projectRoot, bakeScript).split("\\").join("/");
      }
      saveJob(job);
      return finishPublished(job, exportName, job.blender);
    }

    if (mode === "existing-glb") {
      const file = job.inputs.file || job.paths.mesh;
      const abs = resolveMesh(file);
      if (!abs) {
        failJob(job, "missing existing .glb under exports/: " + file);
        return { ok: false, job };
      }
      if (!blender.available) {
        failJob(job, "Blender not found — refusing existing-GLB publish via simulated build/bake");
        return { ok: false, job };
      }
      const rel = relative(projectRoot, abs).split("\\").join("/");
      job.paths.mesh = rel;
      job.blender = {
        available: blender.available,
        path: blender.path,
        source: blender.source,
        kitDir,
        note: "Blender present; existing-GLB mode does not rebuild — use kind for a real headless forge",
      };
      if (job.status !== "building") {
        advanceStage(job, "building", "existing GLB — skip Blender rebuild (pass --kind to forge new)");
      }
      advanceStage(job, "baking", "existing GLB — skip Blender bake");
      return finishPublished(job, abs, job.blender);
    }

    failJob(job, "unknown job inputs.mode: " + mode);
    return { ok: false, job };
  } catch (e) {
    failJob(job, e.message || String(e));
    return { ok: false, job };
  }
}
