/**
 * Phase 4 scene composer — kit instance emitter (no Blender).
 *
 *   node tools/scene-compose/compose.mjs <SceneSpec.json> [--json]
 *
 * Writes exports/scenes/<id>/scene.tscn + report.json (+ scene.json, manifest, validation).
 * Present kit GLBs are staged under kits/ and instanced as PackedScene ExtResources.
 * Missing kits stay placeholder Node3D (anvil_placeholder) and fail kits_resolve.
 * Lighting: WorldEnvironment (ProceduralSky + Environment) + SceneSpec light setups
 * as oriented key/fill/rim or god_rays shafts — not empty env / identity DirectionalLights.
 * Authored realtime environment; not baked lightmaps. Kit binaries are NOT invented.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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


function colorTscn(rgb, a = 1) {
  const [r, g, b] = rgb;
  return `Color(${round3(r)}, ${round3(g)}, ${round3(b)}, ${round3(a)})`;
}

function wrapDeg(d) {
  let x = d % 360;
  if (x < 0) x += 360;
  return x;
}

/** Godot Node3D Euler YXZ → Transform3D (light shines along -Z). */
function eulerYxzTransform(pitchDeg, yawDeg, ox, oy, oz) {
  const pitch = (pitchDeg * Math.PI) / 180;
  const yaw = (yawDeg * Math.PI) / 180;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const Xx = cy;
  const Xy = 0;
  const Xz = -sy;
  const Yx = sy * sp;
  const Yy = cp;
  const Yz = cy * sp;
  const Zx = sy * cp;
  const Zy = -sp;
  const Zz = cy * cp;
  return `Transform3D(${round3(Xx)}, ${round3(Yx)}, ${round3(Zx)}, ${round3(Xy)}, ${round3(Yy)}, ${round3(Zy)}, ${round3(Xz)}, ${round3(Yz)}, ${round3(Zz)}, ${round3(ox)}, ${round3(oy)}, ${round3(oz)})`;
}

function sunGizmoOrigin(pitchDeg, yawDeg, distance = 24) {
  const pitch = (pitchDeg * Math.PI) / 180;
  const yaw = (yawDeg * Math.PI) / 180;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const Zx = sy * cp;
  const Zy = -sp;
  const Zz = cy * cp;
  return { x: Zx * distance, y: Math.max(6, Zy * distance), z: Zz * distance };
}

/** Elevation/azimuth (deg) → DirectionalLight3D transform. Matches Godot rotation_degrees=(-elev, -az, 0). */
function directionalTransform(elevDeg, azDeg, distance = 24) {
  const pitch = -elevDeg;
  const yaw = -azDeg;
  const o = sunGizmoOrigin(pitch, yaw, distance);
  return eulerYxzTransform(pitch, yaw, o.x, o.y, o.z);
}

function environmentPalette(kind) {
  switch (kind) {
    case "god_rays":
      return {
        skyTop: [0.3, 0.42, 0.62],
        skyHorizon: [0.82, 0.66, 0.42],
        groundBottom: [0.1, 0.11, 0.07],
        groundHorizon: [0.42, 0.36, 0.22],
        ambientEnergy: 0.45,
        fogColor: [0.72, 0.58, 0.38],
        fogDensity: 0.003,
        volDensity: 0.022,
        volAlbedo: [0.85, 0.72, 0.48],
        volAnisotropy: 0.45,
      };
    case "night_moon":
      return {
        skyTop: [0.04, 0.06, 0.14],
        skyHorizon: [0.1, 0.12, 0.2],
        groundBottom: [0.03, 0.04, 0.04],
        groundHorizon: [0.08, 0.1, 0.09],
        ambientEnergy: 0.22,
        fogColor: [0.12, 0.14, 0.22],
        fogDensity: 0.006,
        volDensity: 0.03,
        volAlbedo: [0.18, 0.22, 0.32],
        volAnisotropy: 0.2,
      };
    case "sun_sky":
      return {
        skyTop: [0.22, 0.45, 0.78],
        skyHorizon: [0.72, 0.8, 0.88],
        groundBottom: [0.12, 0.14, 0.1],
        groundHorizon: [0.42, 0.46, 0.38],
        ambientEnergy: 0.5,
        fogColor: [0.62, 0.7, 0.78],
        fogDensity: 0.002,
        volDensity: 0.01,
        volAlbedo: [0.78, 0.82, 0.88],
        volAnisotropy: 0.25,
      };
    case "overcast":
    default:
      return {
        skyTop: [0.32, 0.48, 0.52],
        skyHorizon: [0.58, 0.64, 0.55],
        groundBottom: [0.12, 0.14, 0.09],
        groundHorizon: [0.38, 0.4, 0.28],
        ambientEnergy: 0.65,
        fogColor: [0.55, 0.62, 0.5],
        fogDensity: 0.004,
        volDensity: 0.018,
        volAlbedo: [0.72, 0.76, 0.64],
        volAnisotropy: 0.35,
      };
  }
}

function emitEnvironmentSubresources(lines, spec) {
  const setups = spec.layers.lighting.setups || [];
  const defaultId = spec.layers.lighting.defaultSetup || setups[0]?.id || "overcast";
  const defaultSetup = setups.find((s) => s.id === defaultId) || setups[0] || { kind: "overcast", id: defaultId };
  const pal = environmentPalette(defaultSetup.kind || "overcast");
  lines.push(`[sub_resource type="ProceduralSkyMaterial" id="ProceduralSkyMaterial_anvil"]`);
  lines.push(`sky_top_color = ${colorTscn(pal.skyTop)}`);
  lines.push(`sky_horizon_color = ${colorTscn(pal.skyHorizon)}`);
  lines.push(`ground_bottom_color = ${colorTscn(pal.groundBottom)}`);
  lines.push(`ground_horizon_color = ${colorTscn(pal.groundHorizon)}`);
  lines.push(``);
  lines.push(`[sub_resource type="Sky" id="Sky_anvil"]`);
  lines.push(`sky_material = SubResource("ProceduralSkyMaterial_anvil")`);
  lines.push(``);
  lines.push(`[sub_resource type="Environment" id="Environment_anvil"]`);
  lines.push(`background_mode = 2`);
  lines.push(`sky = SubResource("Sky_anvil")`);
  lines.push(`ambient_light_source = 3`);
  lines.push(`ambient_light_energy = ${pal.ambientEnergy}`);
  lines.push(`tonemap_mode = 3`);
  lines.push(`ssao_enabled = true`);
  lines.push(`glow_enabled = true`);
  lines.push(`fog_enabled = true`);
  lines.push(`fog_light_color = ${colorTscn(pal.fogColor)}`);
  lines.push(`fog_density = ${pal.fogDensity}`);
  lines.push(`volumetric_fog_enabled = true`);
  lines.push(`volumetric_fog_density = ${pal.volDensity}`);
  lines.push(`volumetric_fog_albedo = ${colorTscn(pal.volAlbedo)}`);
  lines.push(`volumetric_fog_anisotropy = ${pal.volAnisotropy}`);
  lines.push(``);
  return {
    defaultId,
    defaultKind: defaultSetup.kind || "overcast",
    subResourceCount: 3,
  };
}

function emitDirectionalLight(lines, p) {
  lines.push(`[node name="${p.name}" type="DirectionalLight3D" parent="${p.parent}"]`);
  lines.push(`transform = ${directionalTransform(p.elev, p.az, p.distance ?? 24)}`);
  lines.push(`light_color = ${colorTscn(p.color)}`);
  lines.push(`light_energy = ${round3(p.energy)}`);
  if (p.indirect != null) lines.push(`light_indirect_energy = ${round3(p.indirect)}`);
  if (p.volumetric != null) lines.push(`light_volumetric_fog_energy = ${round3(p.volumetric)}`);
  if (p.angular != null) lines.push(`light_angular_distance = ${round3(p.angular)}`);
  if (p.shadow) {
    lines.push(`shadow_enabled = true`);
    if (p.shadowBlur != null) lines.push(`shadow_blur = ${round3(p.shadowBlur)}`);
    if (p.shadowDistance != null) lines.push(`directional_shadow_max_distance = ${round3(p.shadowDistance)}`);
  }
  lines.push(`metadata/role = "${String(p.name).toLowerCase()}"`);
  lines.push(``);
}

function emitLightRig(lines, setup, isDefault) {
  const group = `Lighting_${setup.id}`;
  const kind = setup.kind || "custom";
  const elev = setup.sunElevationDeg ?? 45;
  const az = setup.sunAzimuthDeg ?? 180;
  const energy = setup.energy ?? 1;
  lines.push(`[node name="${group}" type="Node3D" parent="."]`);
  if (!isDefault) lines.push(`visible = false`);
  lines.push(`metadata/kind = "${kind}"`);
  lines.push(`metadata/anvil_light_setup = true`);
  if (setup.notes) lines.push(`metadata/notes = "${String(setup.notes).replace(/"/g, '\\"')}"`);
  lines.push(``);

  if (kind === "god_rays") {
    emitDirectionalLight(lines, {
      name: "Key",
      parent: group,
      elev,
      az,
      energy,
      color: [1.0, 0.86, 0.58],
      shadow: true,
      angular: 0.5,
      volumetric: 1.8,
      indirect: 0.9,
      shadowBlur: 0.8,
      shadowDistance: 80,
    });
    emitDirectionalLight(lines, {
      name: "Fill",
      parent: group,
      elev: Math.min(70, elev + 18),
      az: wrapDeg(az + 175),
      energy: energy * 0.18,
      color: [0.42, 0.55, 0.72],
      shadow: false,
      volumetric: 0.15,
      indirect: 0.8,
    });
    return;
  }

  if (kind === "night_moon") {
    emitDirectionalLight(lines, {
      name: "Key",
      parent: group,
      elev,
      az,
      energy,
      color: [0.55, 0.65, 0.95],
      shadow: true,
      angular: 0.4,
      volumetric: 0.6,
      indirect: 0.7,
      shadowBlur: 1.2,
      shadowDistance: 70,
    });
    emitDirectionalLight(lines, {
      name: "Fill",
      parent: group,
      elev: Math.min(80, elev + 25),
      az: wrapDeg(az + 160),
      energy: energy * 0.22,
      color: [0.18, 0.22, 0.35],
      shadow: false,
      volumetric: 0.2,
      indirect: 0.9,
    });
    return;
  }

  const overcast = kind === "overcast";
  emitDirectionalLight(lines, {
    name: "Key",
    parent: group,
    elev,
    az,
    energy,
    color: overcast ? [0.9, 0.93, 1.0] : [1.0, 0.96, 0.88],
    shadow: true,
    angular: overcast ? 2.5 : 0.8,
    volumetric: overcast ? 0.35 : 0.7,
    indirect: overcast ? 1.15 : 1.0,
    shadowBlur: overcast ? 1.6 : 1.0,
    shadowDistance: 80,
  });
  emitDirectionalLight(lines, {
    name: "Fill",
    parent: group,
    elev: Math.min(75, elev + 8),
    az: wrapDeg(az + 165),
    energy: energy * (overcast ? 0.32 : 0.25),
    color: overcast ? [0.52, 0.68, 0.5] : [0.55, 0.65, 0.85],
    shadow: false,
    volumetric: 0.12,
    indirect: 1.0,
  });
  emitDirectionalLight(lines, {
    name: "Rim",
    parent: group,
    elev: Math.max(12, elev - 18),
    az: wrapDeg(az - 110),
    energy: energy * 0.18,
    color: overcast ? [0.82, 0.78, 0.68] : [1.0, 0.85, 0.65],
    shadow: false,
    volumetric: 0.2,
    indirect: 0.6,
  });
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

function stageKitGlbs(outDir, layout) {
  // Stage as relative symlinks (Reed nit: absolute box paths break on copy).
  const kitsDir = join(outDir, "kits");
  mkdirSync(kitsDir, { recursive: true });
  const presentById = new Map();
  for (const note of layout.kitNotes || []) {
    if (note.status === "present" && note.expectedPath) {
      presentById.set(note.kitId, note.expectedPath);
    }
  }
  const usedKits = [...new Set((layout.instances || []).map((i) => i.kitId))];
  const resourceMap = new Map();
  for (const kitId of usedKits) {
    const srcRel = presentById.get(kitId);
    if (!srcRel) continue;
    const srcAbs = resolve(projectRoot, srcRel);
    if (!existsSync(srcAbs)) continue;
    const fileName = `${shortKit(kitId)}.glb`;
    const dest = join(kitsDir, fileName);
    try {
      if (existsSync(dest)) rmSync(dest);
    } catch {
      /* ignore */
    }
    try {
      // Relative to kits/ so the scene folder copies without box-absolute paths.
      const relTarget = relative(kitsDir, srcAbs).split("\\").join("/");
      symlinkSync(relTarget, dest);
    } catch {
      copyFileSync(srcAbs, dest);
    }
    resourceMap.set(kitId, {
      extId: `kit_${shortKit(kitId)}`,
      resPath: `res://kits/${fileName}`,
      srcRel: srcRel.split("\\").join("/"),
      stagedRel: relative(projectRoot, dest).split("\\").join("/"),
    });
  }
  return resourceMap;
}

function writeSceneProjectGodot(outDir) {
  const body = [
    "config_version=5",
    "",
    "[application]",
    "",
    'config/name="Anvil composed scene"',
    'run/main_scene="res://scene.tscn"',
    'config/features=PackedStringArray("4.4")',
    "",
    "[rendering]",
    "",
    'renderer/rendering_method="forward_plus"',
    "",
  ].join("\n");
  writeFileSync(join(outDir, "project.godot"), body + "\n");
}

function writeTscn(spec, layout, outPath, anvilStatus = "scaffold", resourceMap = new Map()) {
  const rootName = (spec.displayName || "SceneRoot")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1") || "SceneRoot";
  const uniqueResources = [];
  const seenExt = new Set();
  for (const r of resourceMap.values()) {
    if (seenExt.has(r.extId)) continue;
    seenExt.add(r.extId);
    uniqueResources.push(r);
  }
  const lines = [];
  const envInfo = { defaultId: null, defaultKind: null, subResourceCount: 0 };
  // subresources counted after ext_resources; load_steps patched below
  lines.push(`[gd_scene load_steps=0 format=3]`);
  lines.push(``);
  for (const r of uniqueResources) {
    lines.push(`[ext_resource type="PackedScene" path="${r.resPath}" id="${r.extId}"]`);
  }
  if (uniqueResources.length) lines.push(``);
  Object.assign(envInfo, emitEnvironmentSubresources(lines, spec));
  const loadSteps = 1 + uniqueResources.length + envInfo.subResourceCount;
  lines[0] = `[gd_scene load_steps=${loadSteps} format=3]`;
  lines.push(`[node name="${rootName}" type="Node3D"]`);
  lines.push(`metadata/anvil_scene_id = "${spec.id}"`);
  lines.push(`metadata/anvil_seed = ${spec.seed}`);
  lines.push(`metadata/anvil_status = "${anvilStatus}"`);
  lines.push(``);
  lines.push(`[node name="WorldEnvironment" type="WorldEnvironment" parent="."]`);
  lines.push(`environment = SubResource("Environment_anvil")`);
  lines.push(`metadata/anvil_env = "procedural_sky"`);
  lines.push(`metadata/anvil_default_setup = "${envInfo.defaultId}"`);
  lines.push(`metadata/anvil_lightmaps = false`);
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

  let realInstances = 0;
  let placeholderInstances = 0;
  for (const inst of layout.instances) {
    const parent = layerParent[inst.layer] || "Ground";
    const res = resourceMap.get(inst.kitId);
    if (res) {
      lines.push(`[node name="${inst.name}" parent="${parent}" instance=ExtResource("${res.extId}")]`);
      lines.push(`transform = ${transformLine(inst.x, inst.y, inst.z, inst.yaw, inst.scale)}`);
      lines.push(`metadata/kit_id = "${inst.kitId}"`);
      lines.push(``);
      realInstances++;
    } else {
      const nodeType = inst.kind === "landmark" ? "MeshInstance3D" : "Node3D";
      lines.push(`[node name="${inst.name}" type="${nodeType}" parent="${parent}"]`);
      lines.push(`transform = ${transformLine(inst.x, inst.y, inst.z, inst.yaw, inst.scale)}`);
      lines.push(`metadata/kit_id = "${inst.kitId}"`);
      lines.push(`metadata/anvil_placeholder = true`);
      lines.push(``);
      placeholderInstances++;
    }
  }

  // Named light setups from SceneSpec (≥2). Default visible; others hidden so they do not double-light.
  const setups = spec.layers.lighting.setups;
  const defaultId = envInfo.defaultId || setups[0]?.id;
  for (const setup of setups) {
    emitLightRig(lines, setup, setup.id === defaultId);
  }

  if (spec.layers.nav?.bakeHint === "godot_navigation_region") {
    lines.push(`[node name="Navigation" type="NavigationRegion3D" parent="."]`);
    lines.push(``);
  }

  writeFileSync(outPath, lines.join("\n") + "\n");
  return {
    realInstances,
    placeholderInstances,
    extResourceCount: uniqueResources.length,
    lighting: {
      environment: "procedural_sky",
      lightmaps: false,
      defaultSetup: envInfo.defaultId,
      defaultKind: envInfo.defaultKind,
      setups: setups.map((s) => s.id),
    },
  };
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
  const kitsResolveOkEarly = !(layout.kitNotes || []).some((k) => k.status === "missing");
  const resourceMap = stageKitGlbs(outDir, layout);
  const allInstanced =
    kitsResolveOkEarly &&
    layout.instances.length > 0 &&
    layout.instances.every((inst) => resourceMap.has(inst.kitId));
  const layoutStatus = allInstanced ? "instanced" : kitsResolveOkEarly ? "kits_present" : "scaffold";
  const tscnPath = join(outDir, "scene.tscn");
  const emitStats = writeTscn(spec, layout, tscnPath, layoutStatus, resourceMap);
  writeSceneProjectGodot(outDir);

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
    lighting: emitStats.lighting || null,
    contentHash: hash,
    megaMeshRejected: true,
    status: layoutStatus,
    kitsPresent: (layout.kitNotes || []).filter((k) => k.status === "present").length,
    kitsMissing: (layout.kitNotes || []).filter((k) => k.status === "missing").length,
    realInstances: emitStats.realInstances,
    placeholderInstances: emitStats.placeholderInstances,
    extResourceCount: emitStats.extResourceCount,
    kitsStaged: [...resourceMap.values()].map((r) => r.stagedRel),
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
    realInstances: emitStats.realInstances,
    placeholderInstances: emitStats.placeholderInstances,
    extResourceCount: emitStats.extResourceCount,
    kitRefsRequested: (spec.kitRefs || []).map((k) => k.id),
    kitNotes: layout.kitNotes,
    lightSetups,
    lighting: emitStats.lighting || null,
    contentHash: hash,
    paths: {
      dir: relative(projectRoot, outDir).split("\\").join("/"),
      sceneJson: relative(projectRoot, sceneJsonPath).split("\\").join("/"),
      sceneTscn: relative(projectRoot, tscnPath).split("\\").join("/"),
      manifest: relative(projectRoot, join(outDir, "manifest.json")).split("\\").join("/"),
      report: relative(projectRoot, join(outDir, "report.json")).split("\\").join("/"),
    },
    notes: [],
  };

  // Minimal validation stub checklist (layout-only — not the ship gate)
  const kitsResolveOk = !(report.kitNotes || []).some((k) => k.status === "missing");
  const missingCount = (report.kitNotes || []).filter((k) => k.status === "missing").length;
  const presentCount = (report.kitNotes || []).filter((k) => k.status === "present").length;
  report.kits_resolve = kitsResolveOk;
  report.real_instances = emitStats.placeholderInstances === 0 && emitStats.realInstances > 0;
  report.status = report.real_instances ? "instanced" : kitsResolveOk ? "kits_present" : "scaffold";
  report.notes = [
    report.real_instances
      ? `Emitted ${emitStats.realInstances} PackedScene kit instances (${emitStats.extResourceCount} ExtResources); 0 anvil_placeholder.`
      : kitsResolveOk
        ? `Kit GLBs present (${presentCount}) but emitter left ${emitStats.placeholderInstances} placeholders — not playable.`
        : `Kit GLBs missing (${missingCount} unresolved) — placeholder Node3D only; no binary invented.`,
    "Never fuse a mega-mesh jungle.glb; composer instances biome kits only.",
    "WorldEnvironment uses ProceduralSky + Environment (ambient/fog/volumetric); light setups are key/fill/rim (overcast) or key+fill shafts (god_rays). Authored realtime environment — not baked lightmaps.",
    "Compose layout-only godot_import stays null until run-scene / forge_scene finish rewrites it.",
    spec.notes || null,
  ].filter(Boolean);
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");

  const godotImportNote = kitsResolveOk
    ? "not-yet-checked — deferred-to-run-scene ship gate (fail-closed; not skipped OK)"
    : "N/A until kits resolve — deferred-to-run-scene (compose is layout-only)";
  const validation = {
    schemaVersion: 1,
    sceneId: spec.id,
    status: report.status,
    note: "compose checklist; ship/publish requires run-scene Godot open + godot_import rewrite",
    gates: [
      { id: "schema", ok: true },
      { id: "lights_gte_2", ok: lightSetups.length >= 2 },
      { id: "mega_mesh", ok: true, note: "no fused jungle.glb produced" },
      { id: "kits_resolve", ok: kitsResolveOk, note: "see report.kitNotes" },
      {
        id: "real_instances",
        ok: report.real_instances,
        note: report.real_instances
          ? `${emitStats.realInstances} PackedScene instances; 0 placeholders`
          : `${emitStats.placeholderInstances} anvil_placeholder Node3Ds remain`,
      },
      { id: "godot_import", ok: null, note: godotImportNote },
    ],
  };
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
            ok: Boolean(report.kits_resolve) && Boolean(report.real_instances),
            layoutOnly: true,
            note: "exit 0 = kits resolve + real PackedScene instances; not ship — run-scene owns Godot gate",
            status: report.status,
            sceneId: report.sceneId,
            exportId: report.exportId,
            seed: report.seed,
            instanceTotal: report.instanceTotal,
            realInstances: report.realInstances,
            placeholderInstances: report.placeholderInstances,
            paths: report.paths,
          },
          null,
          2,
        ),
      );
    }
    process.exit(report.kits_resolve && report.real_instances ? 0 : 1);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message || String(e) }, null, 2));
    process.exit(1);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
