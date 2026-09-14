/**
 * Forged assets: the GLBs Blender actually wrote, listed and served from the local `exports/`
 * folder so the studio can show the real thing instead of its own blockout.
 *
 * This only works where the app runs next to the exports (the dev server on your machine). A
 * deployed copy has no exports folder, `list()` returns nothing, and the studio falls back to the
 * blockout preview, which is what it always drew.
 */
export type ForgedAsset = {
  /** Path relative to the exports folder, and the value to pass back as `?file=`. */
  file: string;
  /** File name without the extension: the mesh name Blender used. */
  mesh: string;
  bytes: number;
  /** Last modified, milliseconds since the epoch. */
  modified: number;
};

export type ForgedListing = {
  available: boolean;
  /** Absolute path of the exports folder, so the studio can say where it looked. */
  root: string | null;
  assets: ForgedAsset[];
};

/** Triangles per LOD in the forged file on screen, LOD0 first; null where the file has no such level
 * (a Godot export carries no LOD chain, the engine builds its own on import). */
export type ForgedLods = {
  file: string;
  triangles: Array<number | null>;
};

export const FORGED_ENDPOINT = "/api/forged";

export function forgedUrl(asset: ForgedAsset) {
  return `${FORGED_ENDPOINT}?file=${encodeURIComponent(asset.file)}`;
}

/**
 * The forged asset for a spec, matched on the mesh name Blender would have used. A brief-named
 * asset ("iron_banded_oak_loot_chest") will not match a prototype's name ("relic_chest"), which is
 * why the studio also lets you pick one by hand.
 */
export function matchForged(assets: ForgedAsset[], mesh: string): ForgedAsset | null {
  const wanted = mesh.toLowerCase();
  const exact = assets.filter((a) => a.mesh.toLowerCase() === wanted);
  if (exact.length) return exact.reduce((newest, a) => (a.modified > newest.modified ? a : newest));
  return null;
}

export async function fetchForged(signal?: AbortSignal): Promise<ForgedListing> {
  const res = await fetch(FORGED_ENDPOINT, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`forged listing: HTTP ${res.status}`);
  return (await res.json()) as ForgedListing;
}
