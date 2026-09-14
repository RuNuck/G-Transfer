// Import Anvil's exported GLBs into a throwaway Godot 4 project, headless, and report what the
// engine actually got: nodes, meshes, surfaces, materials, textures, LODs, collision, skeleton
// and animation clips. This is the engine-side proof that the pipeline's output is game-ready.
//
//   node tools/godot-check/check-import.mjs <file-or-dir.glb> [more...] [--keep]
//
// Finds the Godot binary from ANVIL_GODOT (shell or project .env), the PATH, or the usual WinGet package folder.
import "../load-env.mjs";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const inputs = args.filter((a) => !a.startsWith("--"));
if (!inputs.length) {
  console.error("usage: node tools/godot-check/check-import.mjs <file-or-dir.glb> [more...] [--keep]");
  process.exit(2);
}

function findGodot() {
  if (process.env.ANVIL_GODOT) return process.env.ANVIL_GODOT;
  const winget = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  if (existsSync(winget)) {
    for (const pkg of readdirSync(winget).filter((d) => d.toLowerCase().includes("godot"))) {
      const dir = join(winget, pkg);
      // the console build writes to stdout on Windows, which is what we need
      const consoleExe = readdirSync(dir).find((f) => /console\.exe$/i.test(f));
      const plainExe = readdirSync(dir).find((f) => /^godot.*\.exe$/i.test(f) && !/console/i.test(f));
      if (consoleExe) return join(dir, consoleExe);
      if (plainExe) return join(dir, plainExe);
    }
  }
  for (const name of ["godot_console", "godot", "Godot"]) {
    const probe = spawnSync(name, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return name;
  }
  return null;
}

const GODOT = findGodot();
if (!GODOT) {
  console.error("Godot not found. Install it (winget install GodotEngine.GodotEngine) or set ANVIL_GODOT to the executable.");
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
if (!files.length) throw new Error("no .glb files to import");

const project = mkdtempSync(join(tmpdir(), "anvil-godot-"));
mkdirSync(join(project, "assets"), { recursive: true });
writeFileSync(
  join(project, "project.godot"),
  `config_version=5\n\n[application]\n\nconfig/name="Anvil import check"\nconfig/features=PackedStringArray("4.4")\n`,
);
for (const file of files) copyFileSync(file, join(project, "assets", basename(file)));
copyFileSync(join(here, "report.gd"), join(project, "report.gd"));

const version = spawnSync(GODOT, ["--version"], { encoding: "utf8" }).stdout.trim();
// first pass: import the assets (Godot exits after building .godot/imported)
spawnSync(GODOT, ["--headless", "--path", project, "--import"], { encoding: "utf8", timeout: 300000 });
const run = spawnSync(GODOT, ["--headless", "--path", project, "--script", "res://report.gd"], { encoding: "utf8", timeout: 300000 });
const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
const start = out.indexOf("ANVIL_REPORT_JSON ");
if (start < 0) {
  console.error(out.slice(-4000));
  throw new Error("the Godot report script produced no JSON");
}
const report = JSON.parse(out.slice(start + "ANVIL_REPORT_JSON ".length).split("\n")[0]);
report.godot = version;
report.project = keep ? project : undefined;

const problems = [];
for (const asset of report.assets) {
  if (asset.error) problems.push(`${asset.file}: ${asset.error}`);
  if (!asset.meshes?.length) problems.push(`${asset.file}: no MeshInstance3D imported`);
  for (const mesh of asset.meshes ?? []) {
    if (!mesh.surfaces) problems.push(`${asset.file}/${mesh.name}: no surfaces`);
    for (const material of mesh.materials ?? []) {
      if (!material.albedo_texture && !material.normal_texture && !material.orm_texture && mesh.name === asset.body) {
        problems.push(`${asset.file}/${mesh.name}/${material.name}: no textures reached the material`);
      }
    }
  }
  if (asset.animations?.length === 0 && asset.skeletons?.length) problems.push(`${asset.file}: a skeleton but no animations`);
}
report.problems = problems;
report.ok = problems.length === 0;
console.log(JSON.stringify(report, null, 1));
if (!keep) rmSync(project, { recursive: true, force: true });
process.exit(report.ok ? 0 : 1);
