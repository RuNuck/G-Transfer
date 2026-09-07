/**
 * Emit Anvil Blender build (+ optional bake) scripts for one catalog kind.
 *
 *   node tools/forge-run/emit-script.mjs --kind lantern [--engine godot] [--out-dir tools/blender-check/out/gen]
 *
 * Uses jiti to load src/lib TypeScript without a separate build step.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");

function parseArgs(argv) {
  const args = { kind: "lantern", engine: "godot", outDir: null, bake: true, jsonOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kind") args.kind = argv[++i];
    else if (a.startsWith("--kind=")) args.kind = a.slice(7);
    else if (a === "--engine") args.engine = argv[++i];
    else if (a.startsWith("--engine=")) args.engine = a.slice(9);
    else if (a === "--out-dir") args.outDir = argv[++i];
    else if (a.startsWith("--out-dir=")) args.outDir = a.slice(10);
    else if (a === "--no-bake") args.bake = false;
    else if (a === "--json") args.jsonOnly = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: node tools/forge-run/emit-script.mjs --kind <kind> [--engine godot] [--out-dir dir] [--no-bake] [--json]");
      process.exit(0);
    }
  }
  return args;
}

function loadAnvil() {
  const require = createRequire(import.meta.url);
  const jitiFactory = require("jiti");
  const load = jitiFactory(import.meta.url, { esmResolve: true });
  const specMod = load(join(projectRoot, "src/lib/assets/spec.ts"));
  const scriptMod = load(join(projectRoot, "src/lib/assets/blender-script.ts"));
  const namingMod = load(join(projectRoot, "src/lib/assets/naming.ts"));
  return {
    specFromKind: specMod.specFromKind,
    blenderScript: scriptMod.blenderScript,
    bakeScript: scriptMod.bakeScript,
    meshName: namingMod.meshName,
    collisionName: namingMod.collisionName,
    textureSet: namingMod.textureSet,
  };
}

export function emitKind({ kind, engine = "godot", outDir, bake = true } = {}) {
  const api = loadAnvil();
  const spec = api.specFromKind(kind, engine);
  const mesh = api.meshName(spec);
  const collision = api.collisionName(spec);
  const textures = api.textureSet(spec);
  const dir = resolve(outDir || join(projectRoot, "tools/blender-check/out/gen"));
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${kind}_${engine}`);
  const buildPath = `${base}.py`;
  const bakePath = `${base}.bake.py`;
  const metaPath = `${base}.json`;
  writeFileSync(buildPath, api.blenderScript(spec));
  if (bake) writeFileSync(bakePath, api.bakeScript(spec));
  writeFileSync(
    metaPath,
    JSON.stringify({ spec, mesh, collision, textures }, null, 2) + "\n",
  );
  return {
    kind,
    engine,
    mesh,
    collision,
    textures,
    buildPath,
    bakePath: bake ? bakePath : null,
    metaPath,
    outDir: dir,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = emitKind({
    kind: args.kind,
    engine: args.engine,
    outDir: args.outDir,
    bake: args.bake,
  });
  if (args.jsonOnly) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`emitted ${result.kind}/${result.engine} → ${result.buildPath}`);
    if (result.bakePath) console.log(`bake → ${result.bakePath}`);
    console.log(`mesh=${result.mesh} collision=${result.collision}`);
  }
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
