import { createFileRoute } from "@tanstack/react-router";
import type { ForgedAsset, ForgedListing } from "@/lib/assets/forged";

/**
 * Lists and serves the GLBs under the project's `exports/` folder, so the studio can preview what
 * Blender actually built. Read-only, local files only, and it simply reports nothing when there is
 * no exports folder (a deployed copy), which makes the studio fall back to its blockout preview.
 */
const MAX_DEPTH = 4;
const MAX_ASSETS = 200;

type NodeFs = typeof import("node:fs/promises");
type NodePath = typeof import("node:path");

async function node(): Promise<{ fs: NodeFs; path: NodePath } | null> {
  try {
    const [fs, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
    return { fs, path };
  } catch {
    return null; // no filesystem here (an edge runtime); nothing to serve
  }
}

function exportsRoot(path: NodePath) {
  return path.resolve(process.cwd(), "exports");
}

async function isEngineProject(fs: NodeFs, path: NodePath, dir: string) {
  for (const marker of ["project.godot", "Assets", "Content"]) {
    try {
      await fs.stat(path.join(dir, marker));
      return true;
    } catch {
      // not this one
    }
  }
  return false;
}


async function collect(fs: NodeFs, path: NodePath, dir: string, root: string, depth: number, out: ForgedAsset[]) {
  if (depth > MAX_DEPTH || out.length >= MAX_ASSETS) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_ASSETS) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue; // .godot import caches and the like
      // An engine project under exports/ holds copies of assets already listed from their source
      // folder, so descending into it would show every asset twice.
      if (await isEngineProject(fs, path, full)) continue;
      await collect(fs, path, full, root, depth + 1, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".glb")) {
      const stat = await fs.stat(full);
      out.push({
        file: path.relative(root, full).split(path.sep).join("/"),
        mesh: entry.name.slice(0, -4),
        bytes: stat.size,
        modified: stat.mtimeMs,
      });
    }
  }
}

const EMPTY: ForgedListing = { available: false, root: null, assets: [] };

async function listing(): Promise<ForgedListing> {
  const mods = await node();
  if (!mods) return EMPTY;
  const { fs, path } = mods;
  const root = exportsRoot(path);
  try {
    if (!(await fs.stat(root)).isDirectory()) return EMPTY;
  } catch {
    return EMPTY;
  }
  const assets: ForgedAsset[] = [];
  await collect(fs, path, root, root, 0, assets);
  assets.sort((a, b) => b.modified - a.modified);
  return { available: true, root, assets };
}

async function serve(file: string): Promise<Response> {
  const mods = await node();
  if (!mods) return new Response("no filesystem", { status: 404 });
  const { fs, path } = mods;
  const root = exportsRoot(path);
  const full = path.resolve(root, file);
  // The path comes from a query string: keep it inside the exports folder and to one file type.
  const inside = full === root || full.startsWith(root + path.sep);
  if (!inside || !full.toLowerCase().endsWith(".glb")) {
    return new Response("not found", { status: 404 });
  }
  try {
    const stat = await fs.stat(full);
    if (!stat.isFile()) return new Response("not found", { status: 404 });
    const bytes = await fs.readFile(full);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "model/gltf-binary",
        "content-length": String(stat.size),
        // the file is rewritten by every forge, so never let a stale copy be reused
        "cache-control": "no-store",
        "last-modified": new Date(stat.mtimeMs).toUTCString(),
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

async function handle(request: Request): Promise<Response> {
  const file = new URL(request.url).searchParams.get("file");
  if (file) return serve(file);
  return new Response(JSON.stringify(await listing()), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/forged")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
    },
  },
});
