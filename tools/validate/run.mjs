#!/usr/bin/env node
/**
 * Artifact validation for Anvil forged GLBs / export folders.
 *
 *   node tools/validate/run.mjs [paths...] [--profile godot_prod] [--json]
 *   node tools/validate/run.mjs exports/forge
 *
 * Default profile: godot_prod (hard gates; fail closed). Exit 1 if any asset hard-fails.
 * Without Godot/Blender installed, gates use GLB JSON structure + Godot naming heuristics.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isGodotCollisionName, isUnrealCollisionName, readGlb, summarizeGlb } from "./glb-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function findProjectRoot() {
  for (const start of [here, process.cwd()]) {
  let dir = start;
  for (;;) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const name = JSON.parse(readFileSync(pkg, "utf8")).name;
        if (name === "anvil") return dir;
      } catch {
        // ignore
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  } // start candidates
  return resolve(process.cwd());
}

const projectRoot = findProjectRoot();

const PROFILE = "godot_prod";
const GODOT_COL_SUFFIXES = ["-col", "-convcol", "-colonly", "-convcolonly"];

function usage() {
  console.error(`usage: node tools/validate/run.mjs [paths...] [--profile godot_prod] [--json] [--out report.json]
  paths   .glb files and/or directories (default: exports/forge)
  --json  print only JSON (no human summary)
  --out   write the full report JSON to a file`);
}

function parseArgs(argv) {
  const args = { paths: [], profile: PROFILE, jsonOnly: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else if (a === "--json") args.jsonOnly = true;
    else if (a === "--profile") {
      args.profile = argv[++i] ?? PROFILE;
    } else if (a.startsWith("--profile=")) args.profile = a.slice("--profile=".length);
    else if (a === "--out") args.out = argv[++i] ?? null;
    else if (a.startsWith("--out=")) args.out = a.slice("--out=".length);
    else if (a.startsWith("-")) {
      console.error(`unknown flag: ${a}`);
      usage();
      process.exit(2);
    } else args.paths.push(a);
  }
  if (!args.paths.length) args.paths.push("exports/forge");
  return args;
}

function collectGlbs(input) {
  const path = resolve(projectRoot, input);
  if (!existsSync(path)) throw new Error(`no such path: ${input}`);
  const st = statSync(path);
  const files = [];
  if (st.isFile()) {
    if (extname(path).toLowerCase() !== ".glb") throw new Error(`not a .glb: ${input}`);
    files.push(path);
  } else if (st.isDirectory()) {
    walk(path, files, 0);
  } else throw new Error(`not a file or directory: ${input}`);
  return files;
}

function walk(dir, out, depth) {
  if (depth > 6) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // skip engine project copies and texture dumps
      if (["textures", "maps", ".godot"].includes(name)) continue;
      if (existsSync(join(full, "project.godot"))) continue;
      walk(full, out, depth + 1);
    } else if (st.isFile() && extname(name).toLowerCase() === ".glb") {
      out.push(full);
    }
  }
}

/**
 * godot_prod hard gates (artifact-level). Soft items are warnings only.
 */
function validateGodotProd(absPath) {
  const rel = relative(projectRoot, absPath).split("\\").join("/") || basename(absPath);
  const gates = [];
  const soft = [];
  const push = (id, severity, ok, detail) => {
    const item = { id, severity, ok, detail };
    if (severity === "hard") gates.push(item);
    else soft.push(item);
  };

  // --- file exists / extension / readable ---
  if (!existsSync(absPath)) {
    push("file_exists", "hard", false, `missing: ${rel}`);
    return report(rel, absPath, null, gates, soft);
  }
  push("file_exists", "hard", true, rel);

  if (extname(absPath).toLowerCase() !== ".glb") {
    push("extension", "hard", false, "expected .glb");
    return report(rel, absPath, null, gates, soft);
  }
  push("extension", "hard", true, ".glb");

  let parsed;
  try {
    parsed = readGlb(absPath);
    push("readable_glb", "hard", true, `glTF ${parsed.version}, ${parsed.bytes} bytes`);
  } catch (e) {
    push("readable_glb", "hard", false, e.message);
    return report(rel, absPath, null, gates, soft);
  }

  const summary = summarizeGlb(parsed, rel);
  const { json } = parsed;

  const meshCount = json.meshes?.length ?? 0;
  push("has_meshes", "hard", meshCount > 0, meshCount ? `${meshCount} mesh(es): ${summary.meshes.join(", ") || "(unnamed)"}` : "no meshes in GLB JSON");

  const matCount = json.materials?.length ?? 0;
  push("has_materials", "hard", matCount > 0, matCount ? `${matCount} material(s)` : "no materials — Godot import will lack PBR bindings");

  const nodeCount = json.nodes?.length ?? 0;
  push("has_nodes", "hard", nodeCount > 0, nodeCount ? `${nodeCount} node(s)` : "no nodes");

  // Collision: Godot importer suffixes
  const godotCol = summary.godotCollisionNodes;
  const unrealCol = summary.unrealCollisionNodes;
  const colOk = godotCol.length > 0;
  push(
    "collision_godot_suffix",
    "hard",
    colOk,
    colOk
      ? `Godot collision node(s): ${godotCol.join(", ")}`
      : `missing Godot collision suffix (${GODOT_COL_SUFFIXES.join(", ")})${unrealCol.length ? `; found Unreal-style ${unrealCol.join(", ")}` : ""}`,
  );
  if (unrealCol.length && colOk) {
    push("collision_unreal_leftover", "soft", false, `Unreal collision names also present: ${unrealCol.join(", ")}`);
  }

  // Animations when path suggests rigged
  const anims = summary.animations;
  if (summary.suggestsRigged) {
    push(
      "rigged_clips",
      "hard",
      anims.length > 0,
      anims.length ? `clips: ${anims.join(", ")}` : "path suggests rigged but GLB has no animations",
    );
  } else {
    push(
      "rigged_clips",
      "soft",
      true,
      anims.length ? `clips present (not required by path): ${anims.join(", ")}` : "no clips (path does not suggest rigged)",
    );
  }

  // Skins without clips
  if (summary.skins > 0 && anims.length === 0) {
    push("skin_without_clips", "soft", false, `${summary.skins} skin(s) but no animation clips`);
  }

  // Meters / bounds: out-of-range OR missing POSITION min/max is hard for ALL kinds
  // (props included — no soft skip).
  if (summary.bounds) {
    const [sx, sy, sz] = summary.bounds.size;
    const maxDim = Math.max(sx, sy, sz);
    const sane = [sx, sy, sz].every((d) => Number.isFinite(d)) && maxDim >= 0.02 && maxDim <= 50;
    push(
      "meters_bounds",
      "hard",
      sane,
      `AABB size ≈ ${sx.toFixed(3)}×${sy.toFixed(3)}×${sz.toFixed(3)} m (from POSITION min/max)` +
        (sane ? "" : " — out of sane meter range [0.02, 50]"),
    );
  } else {
    push(
      "meters_bounds",
      "hard",
      false,
      "no POSITION min/max in accessors — cannot prove meters (hard fail for all kinds)",
    );
  }

  // PBR textures must resolve when materials claim texture maps / anvilPbr extras
  const tex = summary.textures || { claimedPbr: 0, missing: [], refs: [] };
  if (tex.claimedPbr > 0) {
    const okTex = (tex.missing || []).length === 0;
    push(
      "pbr_textures_resolve",
      "hard",
      okTex,
      okTex
        ? `${tex.refs.length} PBR texture ref(s) resolve (${tex.imageCount} image(s))`
        : `materials claim PBR textures but ${tex.missing.length} ref(s) missing: ` +
          tex.missing.map((m) => `${m.material}.${m.slot}`).join(", "),
    );
  } else {
    push(
      "pbr_textures_resolve",
      "hard",
      false,
      "no albedo+normal+ORM (or claimed PBR maps) — untextured/blockout is not ready/publish",
    );
  }

  // Pivot / grip heuristics for weapons and rigged
  const pivot = summary.pivot || {};
  if (pivot.suggestsWeapon || pivot.suggestsRigged) {
    const gripOk = Boolean(pivot.gripNode) || pivot.rootNearOrigin === true;
    push(
      "pivot_weapon_or_rigged",
      "hard",
      gripOk,
      gripOk
        ? pivot.gripNode
          ? `grip-like node: ${pivot.gripNode}`
          : `root translation near origin: [${(pivot.rootTranslation || []).join(", ")}]`
        : "weapon/rigged asset lacks grip/hand_socket node and root is not near origin",
    );
  } else {
    push(
      "pivot_weapon_or_rigged",
      "soft",
      true,
      "path does not suggest weapon/rigged — pivot not gated",
    );
  }

  // LOD sibling note (Godot auto-LOD vs exported _LOD*)
  const lodNodes = summary.nodes.filter((n) => /_LOD\d+$/i.test(n || ""));
  if (lodNodes.length) {
    push("lod_siblings", "soft", false, `exported LOD siblings may double-draw in Godot: ${lodNodes.join(", ")}`);
  }

  return report(rel, absPath, summary, gates, soft);
}


function report(rel, absPath, summary, gates, soft) {
  const hardFails = gates.filter((g) => !g.ok);
  return {
    file: rel,
    absPath,
    profile: PROFILE,
    ok: hardFails.length === 0,
    hardFails: hardFails.map((g) => g.id),
    gates,
    soft,
    summary: summary
      ? {
          bytes: summary.bytes,
          meshes: summary.meshes,
          materials: summary.materials,
          animations: summary.animations,
          skins: summary.skins,
          godotCollisionNodes: summary.godotCollisionNodes,
          bounds: summary.bounds,
          suggestsRigged: summary.suggestsRigged,
          suggestsWeapon: summary.suggestsWeapon,
          textures: summary.textures
            ? { claimedPbr: summary.textures.claimedPbr, missing: summary.textures.missing?.length ?? 0 }
            : null,
          pivot: summary.pivot
            ? { gripNode: summary.pivot.gripNode, rootNearOrigin: summary.pivot.rootNearOrigin }
            : null,
        }
      : null,
  };
}

function humanSummary(results) {
  const lines = [];
  lines.push(`Anvil validate · profile=${PROFILE}`);
  lines.push(`assets: ${results.length} · hard-fail: ${results.filter((r) => !r.ok).length}`);
  lines.push("");
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    lines.push(`[${mark}] ${r.file}`);
    for (const g of r.gates) {
      lines.push(`  ${g.ok ? "✓" : "✗"} [${g.severity}] ${g.id}: ${g.detail}`);
    }
    for (const g of r.soft.filter((s) => !s.ok)) {
      lines.push(`  ! [soft] ${g.id}: ${g.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.profile !== PROFILE) {
    console.error(`unsupported profile "${args.profile}" (only ${PROFILE} in Phase 0)`);
    process.exit(2);
  }

  let files = [];
  try {
    for (const p of args.paths) files.push(...collectGlbs(p));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  files = [...new Set(files)].sort();
  if (!files.length) {
    console.error("no .glb files found");
    process.exit(2);
  }

  const results = files.map(validateGodotProd);
  const reportDoc = {
    schemaVersion: 1,
    profile: PROFILE,
    generatedAt: new Date().toISOString(),
    limits:
      "Godot/Blender not required. Gates use GLB JSON + Godot collision naming + rigged-path heuristics. Full import proof: node tools/godot-check/check-import.mjs",
    ok: results.every((r) => r.ok),
    counts: {
      assets: results.length,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
    results,
  };

  if (args.out) {
    const outPath = resolve(projectRoot, args.out);
    writeFileSync(outPath, JSON.stringify(reportDoc, null, 2));
  } else if (process.env.ANVIL_GATE_OUT) {
    const outPath = resolve(projectRoot, process.env.ANVIL_GATE_OUT);
    writeFileSync(outPath, JSON.stringify(reportDoc, null, 2));
  }

  if (args.jsonOnly) {
    console.log(JSON.stringify(reportDoc, null, 2));
  } else {
    console.log(humanSummary(results));
    console.log(JSON.stringify({ ok: reportDoc.ok, counts: reportDoc.counts }, null, 2));
  }

  process.exit(reportDoc.ok ? 0 : 1);
}

export { validateGodotProd, collectGlbs, findProjectRoot, PROFILE };

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) main();

