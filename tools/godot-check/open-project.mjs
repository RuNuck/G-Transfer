// Build a real Godot project from exported GLBs and open the editor on it, so the assets can be
// inspected in the engine rather than only checked headlessly.
//
//   node tools/godot-check/open-project.mjs <project-dir> <file-or-dir.glb> [more...] [--no-open]
//
// Creates (or refreshes) the project, copies the assets in, imports them headlessly, builds a
// showcase scene as the main scene, then launches the editor. Godot comes from ANVIL_GODOT, the
// PATH, or the WinGet package folder.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const open = !args.includes("--no-open");
const positional = args.filter((a) => !a.startsWith("--"));
if (positional.length < 2) {
  console.error("usage: node tools/godot-check/open-project.mjs <project-dir> <file-or-dir.glb> [more...] [--no-open]");
  process.exit(2);
}
const PROJECT = resolve(positional[0]);
const inputs = positional.slice(1);

function findGodot() {
  if (process.env.ANVIL_GODOT) return process.env.ANVIL_GODOT;
  const winget = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  if (existsSync(winget)) {
    for (const pkg of readdirSync(winget).filter((d) => d.toLowerCase().includes("godot"))) {
      const dir = join(winget, pkg);
      const consoleExe = readdirSync(dir).find((f) => /console\.exe$/i.test(f));
      const plainExe = readdirSync(dir).find((f) => /^godot.*\.exe$/i.test(f) && !/console/i.test(f));
      if (consoleExe) return join(dir, consoleExe);
      if (plainExe) return join(dir, plainExe);
    }
  }
  for (const name of ["godot_console", "godot", "Godot"]) {
    if (spawnSync(name, ["--version"], { encoding: "utf8" }).status === 0) return name;
  }
  return null;
}

const GODOT = findGodot();
if (!GODOT) {
  console.error("Godot not found. Install it (winget install GodotEngine.GodotEngine) or set ANVIL_GODOT.");
  process.exit(2);
}

const files = [];
for (const input of inputs) {
  const path = resolve(input);
  if (!existsSync(path)) throw new Error(`no such file: ${path}`);
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) if (extname(entry).toLowerCase() === ".glb") files.push(join(path, entry));
  } else files.push(path);
}
if (!files.length) throw new Error("no .glb files to open");

mkdirSync(join(PROJECT, "assets"), { recursive: true });
writeFileSync(
  join(PROJECT, "project.godot"),
  [
    "config_version=5",
    "",
    "[application]",
    "",
    'config/name="Anvil assets"',
    'run/main_scene="res://main.tscn"',
    'config/features=PackedStringArray("4.4", "Forward Plus")',
    "",
    "[rendering]",
    "",
    'anti_aliasing/quality/msaa_3d=2',
    "",
  ].join("\n"),
);
for (const file of files) copyFileSync(file, join(PROJECT, "assets", basename(file)));
copyFileSync(join(here, "build-showcase.gd"), join(PROJECT, "build_showcase.gd"));

const version = spawnSync(GODOT, ["--version"], { encoding: "utf8" }).stdout.trim();
spawnSync(GODOT, ["--headless", "--path", PROJECT, "--import"], { encoding: "utf8", timeout: 600000 });
const built = spawnSync(GODOT, ["--headless", "--path", PROJECT, "--script", "res://build_showcase.gd"], { encoding: "utf8", timeout: 600000 });
const out = `${built.stdout ?? ""}\n${built.stderr ?? ""}`;
const line = out.split("\n").find((l) => l.includes("ANVIL_SHOWCASE"))?.trim();
if (!line) {
  console.error(out.slice(-3000));
  throw new Error("the showcase scene was not built");
}
console.log(`godot ${version}`);
console.log(`project ${PROJECT}`);
console.log(`assets  ${files.map((f) => basename(f)).join(", ")}`);
console.log(line);

if (open) {
  // -e opens the editor; detached so this command returns while Godot keeps running
  const child = spawn(GODOT, ["--path", PROJECT, "-e"], { detached: true, stdio: "ignore" });
  child.unref();
  console.log("editor launched (main scene res://main.tscn)");
}
