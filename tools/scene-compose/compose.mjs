/**
 * Phase 4 scene composer scaffold (no Blender/Godot required).
 *
 *   node tools/scene-compose/compose.mjs <SceneSpec.json> [--json]
 *
 * Writes exports/scenes/<id>/scene.tscn + report.json (+ scene.json copy, manifest stub).
 * Kit GLBs are NOT invented — missing kits are noted in report.kitNotes.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, "../..");

const BIOMES = new Set(["jungle_clearing", "jungle_river", "temperate_forest", "arid_outcrop", "custom"]);
const ENGINES = new Set(["godot", "unreal", "unity", "blender"]);

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function sceneExportId(id) {
  return String(id).replace(/\./g, "_");
}

function shortKit(kitId) {
  const parts = String(kitId).split(".");
  return parts[parts.length - 1] || kitId;
}

function kitPathGuess(kitId) {
  // Convention only — files may not exist yet (Phase 3 kits).
  return `exports/forge/${kitId.replace(/\./g, "/")}.glb`;
}

/** Lightweight SceneSpec checks (mirrors required schema fields). */
export function validateSceneSpec(data) {
  const errors = [];
  if (!data || typeof data !== "object") return ["root must be an object"];
  if (data.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof data.id !== "string" || !/^scene\.[a-z0-9_.-]+$/.test(data.id)) {
    errors.push("id must match ^scene\\.[a-z0-9_.-]+$");
  }
  if (!BIOMES.has(data.biome)) errors.push("biome invalid");
  if (!ENGINES.has(data.engine)) errors.push("engine invalid");
  if (!data.aabb || !Array.isArray(data.aabb.min) || !Array.isArray(data.aabb.max)) {
    errors.push("aabb.min/max required");
  }
  if (typeof data.seed !== "number" || data.seed < 0 || !Number.isInteger(data.seed)) {
    errors.push("seed must be a non-negative integer");
  }
  if (!data.layers || typeof data.layers !== "object") errors.push("layers required");
  else {
    if (!data.layers.ground) errors.push("layers.ground required");
    if (!data.layers.lighting || !Array.isArray(data.layers.lighting.setups) || data.layers.lighting.setups.length < 2) {
      errors.push("layers.lighting.setups must have ≥2 entries");
    }
  }
  return errors;
}

function inExclude(x, z, excludes) {
  if (!excludes) return false;
  for (const box of excludes) {
    const [xmin, , zmin] = box.min;
    const [xmax, , zmax] = box.max;
    if (x >= xmin && x <= xmax && z >= zmin && z <= zmax) return true;
  }
  return false;
}

function scatterPoints(rng, aabb, density, excludes) {
  const [xmin, , zmin] = aabb.min;
  const [xmax, , zmax] = aabb.max;
  const area = Math.max(0, (xmax - xmin) * (zmax - zmin));
  const soft = density.perSquareMeter != null ? Math.floor(area * density.perSquareMeter) : density.maxInstances;
  const target = Math.min(density.maxInstances, Math.max(0, soft));
  const minSp = density.minSpacingM ?? 0;
  const pts = [];
  let attempts = 0;
  const maxAttempts = Math.max(target * 40, 50);
  while (pts.length < target && attempts < maxAttempts) {
    attempts++;
    const x = xmin + rng() * (xmax - xmin);
    const z = zmin + rng() * (zmax - zmin);
    if (inExclude(x, z, excludes)) continue;
    if (minSp > 0) {
      let ok = true;
      for (const p of pts) {
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz < minSp * minSp) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    pts.push({ x: round3(x), y: 0, z: round3(z), yaw: round3(rng() * 360) });
  }
  return pts;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function transformLine(x, y, z, yawDeg = 0, scale = 1) {
  const rad = (yawDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // Basis columns: X, Y, Z, origin — yaw around Y
  const sx = scale;
  return `Transform3D(${round3(c * sx)}, 0, ${round3(s * sx)}, 0, ${sx}, 0, ${round3(-s * sx)}, 0, ${round3(c * sx)}, ${round3(x)}, ${round3(y)}, ${round3(z)})`;
}

function pickKits(kitRefs, roles) {
  if (!kitRefs || !roles) return [];
  return kitRefs.filter((k) => roles.includes(k.role));
}

function buildLayout(spec) {
  const rng = mulberry32(spec.seed);
  const byLayer = {
    ground: 0,
    water: 0,
    canopy: 0,
    undergrowth: 0,
    rocks: 0,
    landmarks: 0,
  };
  const instances = [];
  const kitNotes = [];
  const kitRefs = spec.kitRefs || [];

  for (const kr of kitRefs) {
    const guess = kitPathGuess(kr.id);
    if (!existsSync(resolve(projectRoot, guess))) {
      kitNotes.push({
        kitId: kr.id,
        role: kr.role,
        expectedPath: guess,
        status: "missing",
        note: "GLB not forged yet — placeholder Node3D only (no binary invented)",
      });
    } else {
      kitNotes.push({ kitId: kr.id, role: kr.role, expectedPath: guess, status: "present" });
    }
  }

  // Ground tiles (sparse grid markers)
  const tileSize = spec.layers.ground.tileSizeM ?? 4;
  const [xmin, , zmin] = spec.aabb.min;
  const [xmax, , zmax] = spec.aabb.max;
  const terrainKits = pickKits(kitRefs, ["terrain_tile"]);
  const terrainKit = terrainKits[0]?.id || "biome.jungle.terrain_tile_mud";
  let gi = 0;
  for (let x = xmin + tileSize / 2; x < xmax; x += tileSize) {
    for (let z = zmin + tileSize / 2; z < zmax; z += tileSize) {
      if (gi >= 64) break; // scaffold cap for tile markers
      instances.push({
        layer: "ground",
        name: `${shortKit(terrainKit)}_${String(gi).padStart(3, "0")}`,
        kitId: terrainKit,
        x: round3(x),
        y: 0,
        z: round3(z),
        yaw: 0,
        scale: 1,
        kind: "marker",
      });
      byLayer.ground++;
      gi++;
    }
  }

  // Path polyline markers
  const pathPoly = spec.layers.ground.path?.polyline;
  if (pathPoly && pathPoly.length >= 2) {
    const pathKits = pickKits(kitRefs, ["path_dirt"]);
    const pathKit = pathKits[0]?.id || "biome.jungle.path_dirt_a";
    pathPoly.forEach((p, i) => {
      instances.push({
        layer: "ground",
        name: `${shortKit(pathKit)}_${String(i).padStart(3, "0")}`,
        kitId: pathKit,
        x: p[0],
        y: p[1] ?? 0,
        z: p[2],
        yaw: 0,
        scale: 1,
        kind: "marker",
      });
      byLayer.ground++;
    });
  }

  // Water / river
  const water = spec.layers.water;
  if (water?.enabled && water.river?.polyline) {
    const bankKits = pickKits(kitRefs, ["river_bank"]);
    const waterKits = pickKits(kitRefs, ["water_plane"]);
    const bankKit = bankKits[0]?.id || "biome.jungle.river_bank_a";
    const waterKit = waterKits[0]?.id || "biome.jungle.water_plane_a";
    water.river.polyline.forEach((p, i) => {
      instances.push({
        layer: "water",
        name: `${shortKit(waterKit)}_${String(i).padStart(3, "0")}`,
        kitId: waterKit,
        x: p[0],
        y: p[1] ?? 0.05,
        z: p[2],
        yaw: 0,
        scale: 1,
        kind: "marker",
      });
      byLayer.water++;
      instances.push({
        layer: "water",
        name: `${shortKit(bankKit)}_${String(i).padStart(3, "0")}`,
        kitId: bankKit,
        x: p[0],
        y: 0,
        z: round3(p[2] - (water.river.widthM ?? 5) / 2),
        yaw: 0,
        scale: 1,
        kind: "marker",
      });
      byLayer.water++;
    });
  }

  // Canopy scatter (scaffold: cap soft for readable .tscn)
  function scatterLayer(key, roles) {
    const layer = spec.layers[key];
    if (!layer?.enabled) return;
    const kits = pickKits(kitRefs, roles);
    const density = {
      ...layer.density,
      // scaffold soft-cap so tscn stays small; still deterministic
      maxInstances: Math.min(layer.density.maxInstances, key === "canopy" ? 24 : key === "undergrowth" ? 40 : 16),
    };
    const pts = scatterPoints(rng, spec.aabb, density, layer.excludeAabb);
    pts.forEach((p, i) => {
      const kit = kits.length ? kits[i % kits.length] : { id: `biome.jungle.${roles[0]}`, role: roles[0] };
      instances.push({
        layer: key,
        name: `${shortKit(kit.id)}_${String(i).padStart(3, "0")}`,
        kitId: kit.id,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        scale: 1,
        kind: "marker",
      });
      byLayer[key]++;
    });
  }

  scatterLayer("canopy", ["tree_trunk", "tree_canopy", "tree_root"]);
  scatterLayer("undergrowth", ["understory", "mud_decal"]);
  scatterLayer("rocks", ["rock_scatter", "fallen_log"]);

  // Landmarks
  for (const item of spec.layers.landmarks?.items || []) {
    const t = item.transform.translation;
    instances.push({
      layer: "landmarks",
      name: item.id,
      kitId: item.kitId,
      x: t[0],
      y: t[1] ?? 0,
      z: t[2],
      yaw: item.transform.rotationDeg?.[1] ?? 0,
      scale: item.transform.scale ?? 1,
      kind: "landmark",
    });
    byLayer.landmarks++;
  }

  const maxTotal = spec.constraints?.maxTotalInstances ?? 1200;
  if (instances.length > maxTotal) {
    instances.length = maxTotal;
  }

  return { instances, byLayer, kitNotes };
}

function writeTscn(spec, layout, outPath) {
  const rootName = (spec.displayName || "SceneRoot")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1") || "SceneRoot";
  const lines = [];
  lines.push(`[gd_scene load_steps=1 format=3]`);
  lines.push(``);
  lines.push(`[node name="${rootName}" type="Node3D"]`);
  lines.push(`metadata/anvil_scene_id = "${spec.id}"`);
  lines.push(`metadata/anvil_seed = ${spec.seed}`);
  lines.push(`metadata/anvil_status = "scaffold"`);
  lines.push(``);
  lines.push(`[node name="WorldEnvironment" type="WorldEnvironment" parent="."]`);
  lines.push(``);
  lines.push(`[node name="Ground" type="Node3D" parent="."]`);
  lines.push(`[node name="Water" type="Node3D" parent="."]`);
  lines.push(`[node name="Canopy" type="Node3D" parent="."]`);
  lines.push(`[node name="Undergrowth" type="Node3D" parent="."]`);
  lines.push(`[node name="Rocks" type="Node3D" parent="."]`);
  lines.push(`[node name="Landmarks" type="Node3D" parent="."]`);
  lines.push(``);

  const layerParent = {
    ground: "Ground",
    water: "Water",
    canopy: "Canopy",
    undergrowth: "Undergrowth",
    rocks: "Rocks",
    landmarks: "Landmarks",
  };

  for (const inst of layout.instances) {
    const parent = layerParent[inst.layer] || "Ground";
    const nodeType = inst.kind === "landmark" ? "MeshInstance3D" : "Node3D";
    lines.push(`[node name="${inst.name}" type="${nodeType}" parent="${parent}"]`);
    lines.push(`transform = ${transformLine(inst.x, inst.y, inst.z, inst.yaw, inst.scale)}`);
    lines.push(`metadata/kit_id = "${inst.kitId}"`);
    lines.push(`metadata/anvil_placeholder = true`);
    lines.push(``);
  }

  // ≥2 named light setups
  const setups = spec.layers.lighting.setups;
  for (const setup of setups) {
    const group = `Lighting_${setup.id}`;
    lines.push(`[node name="${group}" type="Node3D" parent="."]`);
    const elev = setup.sunElevationDeg ?? 45;
    const az = setup.sunAzimuthDeg ?? 180;
    const energy = setup.energy ?? 1;
    // Approximate sun direction from elev/az into a Transform3D (placeholder)
    const elevR = (elev * Math.PI) / 180;
    const azR = (az * Math.PI) / 180;
    const dx = Math.cos(elevR) * Math.sin(azR);
    const dy = -Math.sin(elevR);
    const dz = Math.cos(elevR) * Math.cos(azR);
    lines.push(`[node name="Sun" type="DirectionalLight3D" parent="${group}"]`);
    lines.push(`light_energy = ${energy}`);
    lines.push(`transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${round3(dx * 10)}, ${round3(20)}, ${round3(dz * 10)})`);
    lines.push(`metadata/kind = "${setup.kind}"`);
    if (setup.notes) lines.push(`metadata/notes = "${String(setup.notes).replace(/"/g, '\\"')}"`);
    lines.push(``);
  }

  if (spec.layers.nav?.bakeHint === "godot_navigation_region") {
    lines.push(`[node name="Navigation" type="NavigationRegion3D" parent="."]`);
    lines.push(``);
  }

  writeFileSync(outPath, lines.join("\n") + "\n");
}

function contentHash(instances) {
  const ordered = instances
    .map((i) => `${i.kitId}|${i.x},${i.y},${i.z}|${i.yaw}|${i.scale}`)
    .join("\n");
  return "sha256:" + createHash("sha256").update(ordered).digest("hex");
}

export function composeScene(specPath, options = {}) {
  const abs = isAbsolute(specPath) ? specPath : resolve(projectRoot, specPath);
  if (!existsSync(abs)) throw new Error("SceneSpec not found: " + abs);
  const spec = JSON.parse(readFileSync(abs, "utf8"));
  const errors = validateSceneSpec(spec);
  if (errors.length) throw new Error("SceneSpec invalid: " + errors.join("; "));

  const exportId = sceneExportId(spec.id);
  const outDir = join(projectRoot, "exports", "scenes", exportId);
  mkdirSync(outDir, { recursive: true });

  // Canonical copy of input
  const sceneJsonPath = join(outDir, "scene.json");
  copyFileSync(abs, sceneJsonPath);

  const layout = buildLayout(spec);
  const tscnPath = join(outDir, "scene.tscn");
  writeTscn(spec, layout, tscnPath);

  const hash = contentHash(layout.instances);
  const lightSetups = spec.layers.lighting.setups.map((s) => s.id);

  const manifest = {
    schemaVersion: 1,
    sceneId: spec.id,
    seed: spec.seed,
    engine: spec.engine,
    instanceCount: layout.instances.length,
    byLayer: layout.byLayer,
    kitRefsUsed: [...new Set(layout.instances.map((i) => i.kitId))],
    lightSetups,
    contentHash: hash,
    megaMeshRejected: true,
    status: "scaffold",
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const report = {
    schemaVersion: 1,
    status: "scaffold",
    sceneId: spec.id,
    exportId,
    seed: spec.seed,
    bounds: spec.aabb,
    instanceCounts: layout.byLayer,
    instanceTotal: layout.instances.length,
    kitRefsRequested: (spec.kitRefs || []).map((k) => k.id),
    kitNotes: layout.kitNotes,
    lightSetups,
    contentHash: hash,
    paths: {
      dir: relative(projectRoot, outDir).split("\\").join("/"),
      sceneJson: relative(projectRoot, sceneJsonPath).split("\\").join("/"),
      sceneTscn: relative(projectRoot, tscnPath).split("\\").join("/"),
      manifest: relative(projectRoot, join(outDir, "manifest.json")).split("\\").join("/"),
      report: relative(projectRoot, join(outDir, "report.json")).split("\\").join("/"),
    },
    notes: [
      "Scaffold composer — placeholders only; no binary GLBs invented.",
      "Instance kit refs when biome.jungle.* pieces are forged (Phase 3).",
      spec.notes || null,
    ].filter(Boolean),
  };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");

  // Minimal validation stub checklist
  const validation = {
    schemaVersion: 1,
    sceneId: spec.id,
    status: "scaffold",
    gates: [
      { id: "schema", ok: true },
      { id: "lights_gte_2", ok: lightSetups.length >= 2 },
      { id: "mega_mesh", ok: true, note: "no fused jungle.glb produced" },
      { id: "kits_resolve", ok: !(report.kitNotes || []).some((k) => k.status === "missing"), note: "see report.kitNotes" },
      { id: "godot_import", ok: null, note: "skipped (Godot not required for scaffold)" },
    ],
  };
  const kitsResolveOk = validation.gates.find((g) => g.id === "kits_resolve")?.ok === true;
  report.kits_resolve = kitsResolveOk;
  if (!kitsResolveOk) report.status = "scaffold";
  writeFileSync(join(outDir, "validation.json"), JSON.stringify(validation, null, 2) + "\n");

  return report;
}

function main() {
  const argv = process.argv.slice(2);
  let specPath = null;
  let jsonOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") jsonOnly = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: node tools/scene-compose/compose.mjs <SceneSpec.json> [--json]");
      process.exit(0);
    } else if (!a.startsWith("-") && !specPath) specPath = a;
  }
  if (!specPath) {
    console.error("usage: node tools/scene-compose/compose.mjs <SceneSpec.json> [--json]");
    process.exit(2);
  }
  try {
    const report = composeScene(specPath);
    if (jsonOnly) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(
        JSON.stringify(
          {
            ok: Boolean(report.kits_resolve),
            status: report.status,
            sceneId: report.sceneId,
            exportId: report.exportId,
            seed: report.seed,
            instanceTotal: report.instanceTotal,
            paths: report.paths,
          },
          null,
          2,
        ),
      );
    }
    process.exit(report.kits_resolve ? 0 : 1);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message || String(e) }, null, 2));
    process.exit(1);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
