// Inference/domain test through the live MCP endpoint. node test-inference.mjs [mcpUrl]
const MCP = process.argv[2] ?? "http://localhost:8080/api/mcp";
let id = 1;
async function call(name, args) {
  const res = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } }) });
  const body = await res.json();
  if (body.error) throw new Error(`${name}: ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result.content[0].text);
}
const problems = [];
const expect = (cond, what) => { if (!cond) problems.push(what); };

// 1. Every catalog brief infers its own kind (no kind, no engine passed).
const protos = await call("forge_list_prototypes", {});
for (const p of protos) {
  const spec = (await call("forge_create_asset", { brief: p.brief })).spec;
  expect(spec.kind === p.kind, `catalog brief for ${p.kind} inferred ${spec.kind}: "${p.brief.slice(0, 60)}"`);
}

// 2. The review's misroutes and word-boundary traps.
const routes = {
  "oil lantern": "lantern", "Oil lantern, brass, weathered": "lantern", "science lab crate": "crate", "fascia panel door": "door",
  "pumpkin lantern": "lantern", "hero prop barrel": "barrel", "wooden box": "crate", "pistol grip": "pistol", "shotgun shell ammo box": "ammo_can",
  "modular wall with a door": "wall", "stone stairs, godot": "stairs", "helmet stand": "helmet", "Sidearm": "pistol", "combat shotgun with heat shield": "shotgun",
  "begun": "sci_crate", "clamp": "sci_crate", "aluminium foil roll": "sci_crate", "community hall pillar": "pillar", "purple potion flask": "potion",
};
for (const [brief, kind] of Object.entries(routes)) {
  const spec = (await call("forge_create_asset", { brief })).spec;
  expect(spec.kind === kind, `"${brief}" -> ${spec.kind}, expected ${kind}`);
}

// 3. Engine: explicit wins; inferred only when absent; no substring false positives.
const e1 = (await call("forge_create_asset", { brief: "purple potion flask", engine: "godot" })).spec;
expect(e1.engine === "godot", `explicit godot overridden to ${e1.engine}`);
const e2 = (await call("forge_create_asset", { brief: "stone stairs, godot" })).spec;
expect(e2.engine === "godot", `inferred engine ${e2.engine}, expected godot`);
const e3 = (await call("forge_create_asset", { brief: "community hall pillar" })).spec;
expect(e3.engine === "godot", `"community" inferred ${e3.engine}, expected default godot`);
const e4 = (await call("forge_create_asset", { brief: "turpentine barrel for unity" })).spec;
expect(e4.engine === "unity", `"for unity" inferred ${e4.engine}`);
const e5 = (await call("forge_create_asset", { brief: "crate for unity", engine: "unreal" })).spec;
expect(e5.engine === "unreal", `explicit unreal overridden by brief to ${e5.engine}`);

// 4. Titles.
const titles = {
  "A 1.2 m tall rusted barrel, Unreal": "Tall rusted barrel", "Rifle. For unity": "Rifle", "make me a wooden box": "Wooden box",
  "Sci-fi crate, 0.8 m, Unreal": "Sci-fi crate", "0.8 m": "Supply crate", "Unreal": "Supply crate", "剣": "Supply crate",
};
for (const [brief, name] of Object.entries(titles)) {
  const spec = (await call("forge_create_asset", { brief })).spec;
  expect(spec.name === name, `title for "${brief}" -> "${spec.name}", expected "${name}"`);
}

// 5. QC: every prototype passes its own checks in every engine; notes are notes; kit honours grid.
for (const p of protos) {
  for (const engine of ["unreal", "unity", "godot", "blender"]) {
    const qc = await call("forge_qc_checklist", { brief: p.brief, engine, kind: p.kind });
    expect(qc.passed === true, `${p.kind}/${engine} QC failed: ${qc.qc.filter((i) => i.kind === "check" && !i.ok).map((i) => i.label + ": " + i.detail).join(" | ")}`);
    expect(qc.qc.filter((i) => i.kind === "note").length === 2, `${p.kind}/${engine}: expected 2 notes`);
  }
}
const kit = await call("forge_kit_module", { theme: "sci-fi corridor", grid: 3, engine: "unity" });
expect(kit.gridMeters === 3 && /dim = Vector\(\(3, 0\.3, 3\)\)/.test(kit.wallScript) === false && /DIM = Vector\(\(3, 0\.3, 3\)\)/.test(kit.wallScript), `kit wall script not sized to grid: ${(kit.wallScript.match(/DIM = .*/) || [""])[0]}`);
expect(/MESH = "SM_Sci_fi_corridor_wall"|Sci_fi_corridor_wall/i.test(kit.wallScript), "kit wall script not named after theme");

// 6. LOD numbers agree between the plan and the notes; seeds do not depend on engine.
const plan = await call("forge_lod_plan", { brief: "oil barrel" });
const notesUnreal = await call("forge_engine_export", { brief: "oil barrel", engine: "unreal" });
expect(plan.screensize.lod1 === 0.45 && notesUnreal.notes.some((n) => n.includes("1 / 0.45 / 0.12")), `LOD numbers disagree: ${JSON.stringify(plan.screensize)} vs ${notesUnreal.notes.find((n) => n.includes("Screen size"))}`);
const a = (await call("forge_create_asset", { brief: "oil barrel", engine: "unreal" })).spec.materials[0].albedo;
const b = (await call("forge_create_asset", { brief: "oil barrel", engine: "godot" })).spec.materials[0].albedo;
expect(a === b, `albedo differs by engine: ${a} vs ${b}`);
const pbr = await call("forge_pbr_set", { brief: "oil barrel", engine: "unreal" });
expect(/DirectX/.test(pbr.colorSpace.normal), `unreal normal convention missing: ${pbr.colorSpace.normal}`);
const pbrUnity = await call("forge_pbr_set", { brief: "oil barrel", engine: "unity" });
expect(/OpenGL/.test(pbrUnity.colorSpace.normal) && !/flip/i.test(pbrUnity.colorSpace.normal), `unity normal convention wrong: ${pbrUnity.colorSpace.normal}`);

console.log(JSON.stringify({ ok: problems.length === 0, prototypes: protos.length, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
