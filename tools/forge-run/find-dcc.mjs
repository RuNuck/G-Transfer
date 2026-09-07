/**
 * Resolve Blender / Godot binaries for forge runners.
 * Prefer absolute env paths (ANVIL_BLENDER / ANVIL_GODOT), then PATH via `which`.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function which(bin) {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return null;
}

function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && typeof c === "string" && existsSync(c)) return c;
  }
  return null;
}

/** @returns {{ path: string|null, source: string, available: boolean }} */
export function findBlender() {
  const env = process.env.ANVIL_BLENDER?.trim();
  if (env) {
    if (existsSync(env)) return { path: env, source: "ANVIL_BLENDER", available: true };
    return { path: null, source: "ANVIL_BLENDER (missing)", available: false };
  }
  const fromPath = which("blender");
  if (fromPath) return { path: fromPath, source: "which blender", available: true };
  // common box install layout (docs/DCC-SETUP.md)
  const fallback = firstExisting([
    "/home/box/tools/blender-5.2.1-linux-x64/blender",
    "/home/box/.local/bin/blender",
  ]);
  if (fallback) return { path: fallback, source: "fallback path", available: true };
  return { path: null, source: "not found", available: false };
}

/** @returns {{ path: string|null, source: string, available: boolean }} */
export function findGodot() {
  const env = process.env.ANVIL_GODOT?.trim();
  if (env) {
    if (existsSync(env)) return { path: env, source: "ANVIL_GODOT", available: true };
    return { path: null, source: "ANVIL_GODOT (missing)", available: false };
  }
  for (const name of ["godot", "godot4", "Godot"]) {
    const p = which(name);
    if (p) return { path: p, source: `which ${name}`, available: true };
  }
  const fallback = firstExisting([
    "/home/box/tools/godot-4.7.2/Godot_v4.7.2-stable_linux.x86_64",
    "/home/box/.local/bin/godot",
  ]);
  if (fallback) return { path: fallback, source: "fallback path", available: true };
  return { path: null, source: "not found", available: false };
}

/** Parent of the `anvil_blender_addon` package (usually public/downloads). */
export function defaultKitDir(projectRoot) {
  const candidates = [
    process.env.ANVIL_KIT_DIR,
    `${projectRoot}/public/downloads`,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (existsSync(`${c}/anvil_blender_addon`)) return c;
  }
  return null;
}
