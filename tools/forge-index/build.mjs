#!/usr/bin/env node
/**
 * Build exports/index.json — catalog of forged GLBs under exports/.
 *
 *   node tools/forge-index/build.mjs [--root exports] [--out exports/index.json]
 *
 * Listing rules mirror src/routes/api/forged.ts (skip engine project copies, depth cap).
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");

const MAX_DEPTH = 4;
const MAX_ASSETS = 200;

function parseArgs(argv) {
  const args = { root: "exports", out: "exports/index.json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = argv[++i];
    else if (a.startsWith("--root=")) args.root = a.slice(7);
    else if (a === "--out") args.out = argv[++i];
    else if (a.startsWith("--out=")) args.out = a.slice(6);
    else if (a === "--help" || a === "-h") {
      console.log("usage: node tools/forge-index/build.mjs [--root exports] [--out exports/index.json]");
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

  const doc = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    root: relative(projectRoot, root).split("\\").join("/") || "exports",
    profile: "godot_prod",
    counts: { assets: entries.length },
    entries,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`wrote ${relative(projectRoot, outPath)} (${entries.length} assets)`);
}

main();
