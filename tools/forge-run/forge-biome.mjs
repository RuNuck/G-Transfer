/**
 * Forge biome kit pieces into the paths scene-compose expects.
 *
 *   node tools/forge-run/forge-biome.mjs --manifest docs/schemas/examples/jungle.biome-kits.json
 *   node tools/forge-run/forge-biome.mjs --piece rock_scatter_a [--bake]
 *   node tools/forge-run/forge-biome.mjs --all [--bake] [--json]
 *
 * Does NOT invent ready GLBs. Writes real Blender part-kit builds (or fails honestly).
 * Compose resolves via exports/forge/biome/<biome>/<piece>.glb existence only.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const DEFAULT_MANIFEST = "docs/schemas/examples/jungle.biome-kits.json";

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    piece: null,
    all: false,
    bake: false,
    json: false,
    limit: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") args.manifest = argv[++i];
    else if (a.startsWith("--manifest=")) args.manifest = a.slice(11);
    else if (a === "--piece") args.piece = argv[++i];
    else if (a.startsWith("--piece=")) args.piece = a.slice(8);
    else if (a === "--all") args.all = true;
    else if (a === "--bake") args.bake = true;
    else if (a === "--json") args.json = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(`usage: node tools/forge-run/forge-biome.mjs [--manifest path] (--all | --piece <slug>) [--bake] [--limit N] [--json]`);
      process.exit(0);
    }
  }
  if (!args.piece && !args.all) args.all = true;
  return args;
}

function loadManifest(rel) {
  const abs = resolve(projectRoot, rel);
  if (!existsSync(abs)) throw new Error("manifest missing: " + rel);
  return JSON.parse(readFileSync(abs, "utf8"));
}

function forgeOne(piece, bake) {
  const outDir = dirname(resolve(projectRoot, piece.glbPath));
  mkdirSync(outDir, { recursive: true });
  const args = [
    "tools/forge-run/run-asset.mjs",
    "--kind",
    piece.kind,
    "--out-dir",
    relativeSafe(outDir),
    "--json",
  ];
  if (bake) args.push("--bake");
  const env = {
    ...process.env,
    ANVIL_KIT_DIR: process.env.ANVIL_KIT_DIR || join(projectRoot, "public/downloads"),
  };
  const started = Date.now();
  const run = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - started;
  let report = null;
  try {
    report = JSON.parse(run.stdout || "{}");
  } catch {
    report = { parseError: true, stdoutTail: (run.stdout || "").slice(-800) };
  }
  const glbAbs = resolve(projectRoot, piece.glbPath);
  const present = existsSync(glbAbs);
  const buildSource =
    report?.blender?.buildSource ||
    (/(part kit)/i.test(run.stdout || "") ? "part kit" : null);
  return {
    piece: piece.piece,
    kind: piece.kind,
    kitId: piece.kitId,
    glbPath: piece.glbPath,
    exitCode: run.status ?? 1,
    elapsedMs,
    present,
    buildSource,
    jobStatus: report?.status || null,
    hardFails: report?.validation?.hardFails || report?.hardFails || [],
    stderrTail: (run.stderr || "").slice(-600),
  };
}

function relativeSafe(abs) {
  return abs.startsWith(projectRoot) ? abs.slice(projectRoot.length + 1) : abs;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(args.manifest);
  let pieces = manifest.pieces || [];
  if (args.piece) {
    pieces = pieces.filter((p) => p.piece === args.piece || p.kind === args.piece || p.kitId === args.piece);
    if (!pieces.length) {
      console.error("piece not in manifest:", args.piece);
      process.exit(2);
    }
  }
  if (args.limit != null && Number.isFinite(args.limit)) {
    pieces = pieces.slice(0, args.limit);
  }

  const results = [];
  for (const piece of pieces) {
    console.error(`[forge-biome] ${piece.piece} (${piece.kind}) → ${piece.glbPath}`);
    const r = forgeOne(piece, args.bake);
    results.push(r);
    console.error(
      `  → present=${r.present} exit=${r.exitCode} source=${r.buildSource || "?"} ${r.elapsedMs}ms job=${r.jobStatus || "?"}`,
    );
  }

  const present = results.filter((r) => r.present).length;
  const missing = results.length - present;
  const summary = {
    schemaVersion: 1,
    biome: manifest.biome,
    manifest: args.manifest,
    bake: args.bake,
    requested: results.length,
    present,
    missing,
    kitPrefix: manifest.kitPrefix,
    results,
    note: "GLBs gitignored; compose kits_resolve = file exists. ready/publish still needs bake+Godot gates.",
  };

  const evidenceDir = join(projectRoot, "docs/evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, `jungle-kits-forge-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(evidencePath, JSON.stringify(summary, null, 2) + "\n");
  summary.evidencePath = relativeSafe(evidencePath);

  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`forge-biome: ${present}/${results.length} GLBs present (${missing} missing)`);
    console.log(`evidence: ${summary.evidencePath}`);
  }
  process.exit(missing === 0 ? 0 : 1);
}

main();
