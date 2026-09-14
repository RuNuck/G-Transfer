/**
 * Headless-open a composed scene.tscn in a throwaway Godot project.
 *
 *   node tools/godot-check/check-scene.mjs <path/to/scene.tscn|scene-dir> [--keep]
 *
 * Exit 0 + JSON ok:true when Godot loads/instantiates the scene.
 * Copies sibling kits/ into the throwaway project so ExtResource PackedScenes resolve.
 * When Godot binary is missing, exits 2 with available:false (caller decides policy).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findGodot } from "../forge-run/find-dcc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const positional = args.filter((a) => !a.startsWith("--"));
if (!positional.length) {
  console.error("usage: node tools/godot-check/check-scene.mjs <scene.tscn|dir> [--keep]");
  process.exit(2);
}

function resolveScene(input) {
  const path = resolve(input);
  if (!existsSync(path)) throw new Error("no such path: " + input);
  if (statSync(path).isDirectory()) {
    const cand = join(path, "scene.tscn");
    if (!existsSync(cand)) throw new Error("no scene.tscn in " + input);
    return cand;
  }
  if (!path.toLowerCase().endsWith(".tscn")) throw new Error("expected .tscn: " + input);
  return path;
}

const godot = findGodot();
if (!godot.available) {
  console.log(JSON.stringify({
    ok: false,
    available: false,
    ran: false,
    status: "godot_absent",
    problems: ["Godot not available"],
    note: godot.source,
  }, null, 2));
  process.exit(2);
}

const scenePath = resolveScene(positional[0]);
const project = mkdtempSync(join(tmpdir(), "anvil-scene-"));
writeFileSync(
  join(project, "project.godot"),
  [
    "config_version=5",
    "",
    "[application]",
    "",
    "config/name=\"Anvil scene check\"",
    "run/main_scene=\"res://scene.tscn\"",
    "config/features=PackedStringArray(\"4.4\")",
    "",
  ].join("\n"),
);
copyFileSync(scenePath, join(project, "scene.tscn"));
copyFileSync(join(here, "open-scene.gd"), join(project, "open_scene.gd"));

// Stage kits/ next to scene.tscn so PackedScene ExtResources (res://kits/*.glb) resolve.
const kitsSrc = join(dirname(scenePath), "kits");
if (existsSync(kitsSrc) && statSync(kitsSrc).isDirectory()) {
  const kitsDst = join(project, "kits");
  mkdirSync(kitsDst, { recursive: true });
  for (const name of readdirSync(kitsSrc)) {
    const src = join(kitsSrc, name);
    const dst = join(kitsDst, name);
    try {
      const st = lstatSync(src);
      if (st.isSymbolicLink()) {
        // Materialize symlink target so the throwaway project is self-contained.
        const target = readlinkSync(src);
        const absTarget = target.startsWith("/") ? target : join(kitsSrc, target);
        if (existsSync(absTarget)) copyFileSync(absTarget, dst);
      } else if (st.isFile()) {
        copyFileSync(src, dst);
      } else if (st.isDirectory()) {
        cpSync(src, dst, { recursive: true });
      }
    } catch (e) {
      // Best-effort; Godot open will fail closed if a kit is missing.
    }
  }
}

const version = spawnSync(godot.path, ["--version"], { encoding: "utf8" }).stdout.trim();
spawnSync(godot.path, ["--headless", "--path", project, "--import"], {
  encoding: "utf8",
  timeout: 300000,
});
const run = spawnSync(godot.path, ["--headless", "--path", project, "--script", "res://open_scene.gd"], {
  encoding: "utf8",
  timeout: 300000,
});
const out = (run.stdout || "") + "\n" + (run.stderr || "");
const okLine = out.split("\n").find((l) => l.includes("ANVIL_SCENE_OK"));
const failLine = out.split("\n").find((l) => l.includes("ANVIL_SCENE_FAIL"));
const ok = Boolean(okLine) && (run.status ?? 1) === 0;
const report = {
  ok,
  available: true,
  ran: true,
  status: ok ? "ready" : "blocked",
  godot: version,
  path: godot.path,
  source: godot.source,
  scene: scenePath,
  exitCode: run.status ?? 1,
  problems: ok ? [] : [failLine || "Godot did not print ANVIL_SCENE_OK", out.slice(-2000)].filter(Boolean),
  note: ok ? okLine.trim() : (failLine || "scene open failed"),
  project: keep ? project : undefined,
};
console.log(JSON.stringify(report, null, 2));
if (!keep) rmSync(project, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
