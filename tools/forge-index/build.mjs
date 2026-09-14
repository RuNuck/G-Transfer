#!/usr/bin/env node
/**
 * Build exports/index.json — catalog of forged GLBs under exports/.
 *
 *   node tools/forge-index/build.mjs [--root exports] [--out exports/index.json] [--skip-validate]
 *
 * Listing rules mirror src/routes/api/forged.ts (skip engine project copies, depth cap).
 * When validation runs (default), validate-ok => validated_glb_only (ready=false). Index ready only after forge-run Godot ship-gate patches an entry.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGodotProd } from "../validate/run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");

const MAX_DEPTH = 4;
const MAX_ASSETS = 200;

function parseArgs(argv) {
  const args = { root: "exports", out: "exports/index.json", skipValidate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = argv[++i];
    else if (a.startsWith("--root=")) args.root = a.slice(7);
    else if (a === "--out") args.out = argv[++i];
    else if (a.startsWith("--out=")) args.out = a.slice(6);
    else if (a === "--skip-validate") args.skipValidate = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "usage: node tools/forge-index/build.mjs [--root exports] [--out exports/index.json] [--skip-validate]",
      );
      process.exit(0);
    }
  }
  return args;
}

function isEngineProject(dir) {
  for (const marker of ["project.godot", "Assets", "Content"]) {
    if (existsSync(join(dir, marker))) return true;
  }
  return false;
}

/** Map relative export path → ok from last godot-prod report (optional hint). */
function loadLastReportMap() {
  const candidates = [
    join(projectRoot, "exports/forge/godot-prod-report.json"),
    join(projectRoot, "exports/godot-prod-report.json"),
  ];
  const map = new Map();
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const doc = JSON.parse(readFileSync(path, "utf8"));
      for (const r of doc.results ?? []) {
        if (typeof r.file === "string") map.set(r.file.replace(/\\/g, "/"), Boolean(r.ok));
      }
    } catch {
      // ignore corrupt report
    }
  }
  return map;
}

function collect(dir, root, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_ASSETS) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_ASSETS) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      if (isEngineProject(full)) continue;
      collect(full, root, depth + 1, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".glb")) {
      const st = statSync(full);
      const file = relative(root, full).split("\\").join("/");
      const folder = dirname(file) === "." ? "" : dirname(file);
      let sha256 = null;
      try {
        sha256 = createHash("sha256").update(readFileSync(full)).digest("hex");
      } catch {
        // skip hash on read failure
      }
      out.push({
        id: file.replace(/\.glb$/i, "").replace(/[\\/]/g, "."),
        file,
        absPath: full,
        mesh: entry.name.slice(0, -extname(entry.name).length),
        bytes: st.size,
        modified: st.mtimeMs,
        modifiedAt: new Date(st.mtimeMs).toISOString(),
        folder: folder || null,
        folderHint: folder ? `res://art/${folder}/` : "res://art/",
        hash: sha256 ? `sha256:${sha256}` : null,
        engine: "godot",
        status: "indexed",
      });
    }
  }
}


/** Preserve Godot shipGate proof across index rebuilds (ready/blocked). */
function loadPriorShipGates(indexPath) {
  const map = new Map();
  if (!existsSync(indexPath)) return map;
  try {
    const doc = JSON.parse(readFileSync(indexPath, "utf8"));
    for (const e of doc.entries ?? []) {
      if (!e || typeof e.file !== "string") continue;
      const sg = e.shipGate;
      if (!sg || typeof sg !== "object") continue;
      if (sg.status !== "ready" && sg.status !== "blocked") continue;
      const f = e.file.replace(/\\/g, "/");
      map.set(f, sg);
      map.set(f.startsWith("exports/") ? f.slice("exports/".length) : "exports/" + f, sg);
    }
  } catch {
    // ignore corrupt prior index
  }
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(projectRoot, args.root);
  const outPath = resolve(projectRoot, args.out);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`exports root not found: ${args.root}`);
    process.exit(2);
  }

  const entries = [];
  collect(root, root, 0, entries);
  entries.sort((a, b) => b.modified - a.modified);

  const reportHint = args.skipValidate ? new Map() : loadLastReportMap();
  const priorShip = args.skipValidate ? new Map() : loadPriorShipGates(outPath);
  let readyCount = 0;
  let failedCount = 0;
  let blockedCount = 0;
  let validatedOnlyCount = 0;
  let unchecked = 0;

  for (const entry of entries) {
    const relFromProject = relative(projectRoot, entry.absPath).split("\\").join("/");
    delete entry.absPath;

    if (args.skipValidate) {
      entry.ready = null;
      entry.status = "indexed";
      unchecked++;
      continue;
    }

    let ok = null;
    try {
      const result = validateGodotProd(resolve(projectRoot, relFromProject));
      ok = Boolean(result.ok);
      entry.validation = {
        ok,
        hardFails: result.hardFails ?? [],
        profile: result.profile,
      };
    } catch (e) {
      if (reportHint.has(relFromProject)) {
        ok = reportHint.get(relFromProject);
        entry.validation = { ok, hardFails: [], profile: "godot_prod", fromReport: true };
      } else {
        ok = false;
        entry.validation = { ok: false, hardFails: ["validate_error"], detail: String(e.message || e) };
      }
    }

    // Honesty: validate-ok alone is never "ready". Ready requires Godot import
    // proof (forge-run ship-gate patches index after check-import). Preserve prior
    // shipGate ready/blocked so published weapon/asset jobs do not regress to
    // validated_glb_only on bare rebuild.
    if (ok) {
      const fileKey = relFromProject.replace(/^exports\//, "");
      const prior =
        priorShip.get(fileKey) ||
        priorShip.get(relFromProject) ||
        priorShip.get("exports/" + fileKey);
      if (prior && prior.status === "ready" && prior.godotImportOk) {
        entry.ready = true;
        entry.status = "ready";
        entry.shipGate = prior;
        readyCount++;
      } else if (prior && prior.status === "blocked") {
        entry.ready = false;
        entry.status = "blocked";
        entry.shipGate = prior;
        blockedCount++;
      } else {
        entry.ready = false;
        entry.status = "validated_glb_only";
        validatedOnlyCount++;
      }
    } else {
      entry.ready = false;
      entry.status = "failed";
      failedCount++;
    }
  }

  const doc = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    root: relative(projectRoot, root).split("\\").join("/") || "exports",
    profile: "godot_prod",
    validated: !args.skipValidate,
    counts: {
      assets: entries.length,
      ready: args.skipValidate ? null : readyCount,
      failed: args.skipValidate ? null : failedCount,
      blocked: args.skipValidate ? null : blockedCount,
      validated_glb_only: args.skipValidate ? null : validatedOnlyCount,
      unchecked: args.skipValidate ? unchecked : 0,
    },
    entries,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  console.log(
    `wrote ${relative(projectRoot, outPath)} (${entries.length} assets` +
      (args.skipValidate ? ", validate skipped" : `, ready=${readyCount}, validated_glb_only=${validatedOnlyCount}, blocked=${blockedCount}, failed=${failedCount}`) +
      `)`,
  );
}

main();
