/**
 * Phase 1 forge runner (scaffold).
 *
 *   node tools/forge-run/run-asset.mjs --mesh|--file <path-to-glb> [--json]
 *
 * Accepts an existing exports GLB, walks job stages (build/bake stubbed when
 * Blender is missing), runs validate, rebuilds exports/index.json, marks published.
 * Real Blender execution is TODO when `which blender` finds a binary.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { createJob, advanceStage, failJob, projectRoot, saveJob } from "./job-store.mjs";

function which(bin) {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return null;
}

function parseArgs(argv) {
  const args = { file: null, mesh: null, jsonOnly: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.jsonOnly = true;
    else if (a === "--force") args.force = true;
    else if (a === "--file" || a === "--mesh") args.file = argv[++i];
    else if (a.startsWith("--file=")) args.file = a.slice(7);
    else if (a.startsWith("--mesh=")) args.file = a.slice(7);
    else if (a === "--help" || a === "-h") {
      console.log("usage: node tools/forge-run/run-asset.mjs --file|--mesh <glb> [--json]");
      process.exit(0);
    } else if (!a.startsWith("-") && !args.file) args.file = a;
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
      try { doc = JSON.parse(m[0]); } catch { /* ignore */ }
    }
  }
  return { exitCode: r.status ?? 1, doc, stderr: r.stderr };
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const abs = resolveMesh(args.file);
  if (!abs) {
    console.error("missing --file/--mesh pointing at an existing .glb under exports/");
    process.exit(2);
  }

  const rel = relative(projectRoot, abs).split("\\").join("/");
  const blenderBin = which("blender");
  const job = createJob({
    type: "asset",
    status: "queued",
    inputs: { file: rel, mode: "existing-glb" },
    paths: { mesh: rel },
    blender: {
      available: Boolean(blenderBin),
      path: blenderBin,
      note: blenderBin
        ? "TODO: invoke Blender kit/bake for real builds (Phase 1 smoke)"
        : "blender binary not found (which blender); build/bake stages simulated",
    },
  });

  try {
    advanceStage(job, "building", blenderBin
      ? "TODO: Blender build stub — using existing GLB as input"
      : "simulated build (no blender); reusing existing GLB");

    advanceStage(job, "baking", blenderBin
      ? "TODO: Blender bake stub — skipping surfacing"
      : "simulated bake (no blender); textures assumed already in GLB");

    advanceStage(job, "validating", "running tools/validate godot_prod");
    const v = runValidate(abs);
    job.validation = {
      ok: Boolean(v.doc?.ok) && v.exitCode === 0,
      exitCode: v.exitCode,
      counts: v.doc?.counts ?? null,
      hardFails: v.doc?.results?.[0]?.hardFails ?? [],
      report: v.doc?.results?.[0] ?? null,
    };
    saveJob(job);

    if (!job.validation.ok) {
      failJob(job, "validate failed: " + (job.validation.hardFails.join(", ") || "exit " + v.exitCode));
      if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
      else console.error(JSON.stringify({ ok: false, jobId: job.id, status: job.status, validation: job.validation }, null, 2));
      process.exit(1);
    }

    const idx = rebuildIndex();
    job.paths.index = "exports/index.json";
    if (idx.exitCode !== 0) {
      failJob(job, "index rebuild failed: " + (idx.stderr || idx.stdout || ("exit " + idx.exitCode)));
      if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
      process.exit(1);
    }

    advanceStage(job, "published", "validated + index rebuilt");
    if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
    else {
      console.log(JSON.stringify({ ok: true, jobId: job.id, status: job.status, mesh: rel, blender: job.blender }, null, 2));
    }
    process.exit(0);
  } catch (e) {
    failJob(job, e.message || String(e));
    if (args.jsonOnly) console.log(JSON.stringify(job, null, 2));
    else console.error(e);
    process.exit(1);
  }
}

main();
