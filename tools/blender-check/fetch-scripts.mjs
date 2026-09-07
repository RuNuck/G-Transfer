// Fetch the generated build + bake scripts and their specs for every kind x engine from a running Anvil server.
//
//   node tools/blender-check/fetch-scripts.mjs [outDir] [mcpUrl]
//
// Defaults: outDir = tools/blender-check/out/gen, mcpUrl = http://localhost:8080/api/mcp (npm run dev).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(here, "out", "gen"));
const MCP = process.argv[3] ?? "http://localhost:8080/api/mcp";
mkdirSync(OUT, { recursive: true });

const KINDS = ["crate", "sci_crate", "barrel", "chest", "ammo_can", "sword", "dagger", "pistol", "rifle", "shotgun", "shield", "helmet", "pillar", "wall", "stairs", "pipe", "door", "vent", "lantern", "potion", "hoverbike", "mannequin"];
const ENGINES = ["unreal", "unity", "godot", "blender"];

async function call(name, args, id) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${name}: ${JSON.stringify(body.error)}`);
  return body.result.content[0].text;
}

let id = 1;
let count = 0;
for (const kind of KINDS) {
  for (const engine of ENGINES) {
    const brief = `${kind.replace("_", " ")} test piece`;
    const created = JSON.parse(await call("forge_create_asset", { brief, engine, kind }, id++));
    const bakePlan = JSON.parse(await call("forge_bake_plan", { brief, engine, kind }, id++));
    const base = `${OUT}/${kind}_${engine}`;
    writeFileSync(`${base}.py`, created.blenderScript);
    writeFileSync(`${base}.bake.py`, bakePlan.blender);
    writeFileSync(
      `${base}.json`,
      JSON.stringify({ spec: created.spec, mesh: created.mesh, collision: created.collision, textures: created.textures }, null, 1),
    );
    count++;
  }
}
console.log(`fetched ${count} kind/engine pairs into ${OUT}`);
