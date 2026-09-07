import { collisionName, folderHint, lodName, materialName, meshName, textureSet } from "./naming";
import type { AssetSpec, PipelineStage, QcItem } from "./types";

/** One LOD screen-size table for every tool and note (fractions of screen height). */
export const LOD_SCREEN = { lod0: 1.0, lod1: 0.45, lod2: 0.12, cull: 0.04 } as const;

/** Atlas size the bake script and the QC agree on. */
export function atlasSize(spec: AssetSpec) {
  return spec.texelDensity >= 1024 ? 2048 : spec.texelDensity >= 512 ? 1024 : 512;
}

const NAME_RULES: Record<AssetSpec["engine"], RegExp> = {
  unreal: /^SM_[A-Za-z0-9_]+$/,
  unity: /^[A-Za-z0-9_]+$/,
  godot: /^[a-z0-9_]+$/,
  blender: /^[A-Za-z0-9_]+$/,
};

export function pipelineFor(spec: AssetSpec): PipelineStage[] {
  return [
    { id: "brief", label: "Brief", status: "done", note: spec.brief },
    {
      id: "blockout",
      label: "Blockout",
      status: "done",
      note: `${spec.dimensions.x}×${spec.dimensions.y}×${spec.dimensions.z} m · pivot ${spec.pivot}`,
    },
    {
      id: "high",
      label: "High / bevel",
      status: "ready",
      note: "Bevel + weighted normals. Keep supporting edges for hard surface.",
    },
    {
      id: "uv",
      label: "UV",
      status: "ready",
      note: `Texel ${spec.texelDensity} px/m · UV0 unique · UV1 lightmap 2 px pad`,
    },
    {
      id: "bake",
      label: "Bake",
      status: "ready",
      note: "Normal, AO, curvature → ORM pack. 2k prop / 4k hero.",
    },
    {
      id: "pbr",
      label: "PBR",
      status: "done",
      note: spec.materials.map((m) => m.name).join(" · "),
    },
    {
      id: "lod",
      label: "LOD",
      status: "ready",
      note: `LOD0 ${spec.triangleBudget.lod0} · LOD1 ${spec.triangleBudget.lod1} · LOD2 ${spec.triangleBudget.lod2}`,
    },
    {
      id: "collision",
      label: "Collision",
      status: "ready",
      note: `${spec.collision} · ${collisionName(spec)}`,
    },
    {
      id: "export",
      label: "Export",
      status: "ready",
      note: `${folderHint(spec)}${meshName(spec)}.glb`,
    },
  ];
}

export function qcFor(spec: AssetSpec): QcItem[] {
  const { x, y, z } = spec.dimensions;
  const hero = spec.category === "weapons" || spec.category === "characters";
  const trisLimit = spec.category === "vehicles" || hero ? 8000 : spec.category === "architecture" ? 4000 : 3000;
  const texelMin = spec.category === "architecture" ? 256 : hero ? 1024 : 512;
  const sane = [x, y, z].every((d) => Number.isFinite(d) && d >= 0.02 && d <= 12);
  const expectedPivot = spec.category === "weapons" ? "center" : "bottom";
  const { lod0, lod1, lod2 } = spec.triangleBudget;
  const mesh = meshName(spec);
  const pbrProblems = spec.materials.flatMap((m) => {
    const issues: string[] = [];
    if (m.roughness < 0.04 || m.roughness > 0.95) issues.push(`${m.name}: roughness ${m.roughness} outside 0.04–0.95`);
    if (m.metalness !== 0 && m.metalness !== 1) issues.push(`${m.name}: metalness ${m.metalness} must be binary 0 or 1 for production materials`);
    if (m.metalness === 1 && (m.roughness < 0.2 || m.roughness > 0.5)) issues.push(`${m.name}: metal roughness ${m.roughness} outside 0.2–0.5`);
    return issues;
  });
  return [
    {
      id: "scale",
      label: "Real-world scale",
      kind: "check",
      ok: spec.units === "meters" && sane,
      detail: sane ? `${x} × ${y} × ${z} m in meters.` : `Dimensions ${x} × ${y} × ${z} m are outside 0.02–12 m.`,
    },
    {
      id: "pivot",
      label: "Pivot",
      kind: "check",
      ok: spec.pivot === expectedPivot,
      detail:
        spec.pivot === "bottom"
          ? "Origin at ground contact (props, architecture, vehicles, characters)."
          : "Origin at the centre of mass (weapons); grip placement is done in-engine.",
    },
    {
      id: "forward",
      label: "Forward axis",
      kind: "note",
      ok: true,
      detail: spec.engine === "unity" ? "+Z forward, Y up; glTF handles the conversion." : spec.engine === "unreal" ? "+X forward, Z up after import; glTF handles the conversion." : "glTF: +Y up, -Z forward.",
    },
    {
      id: "tris",
      label: "Triangle budget",
      kind: "check",
      ok: lod0 <= trisLimit,
      detail: `LOD0 ${lod0} tris; ${spec.category} envelope ≤ ${trisLimit}.`,
    },
    {
      id: "texel",
      label: "Texel density",
      kind: "check",
      ok: spec.texelDensity >= texelMin,
      detail: `${spec.texelDensity} px/m → ${atlasSize(spec)} px atlas; ${spec.category} needs ≥ ${texelMin} px/m.`,
    },
    {
      id: "uv",
      label: "UV islands",
      kind: "note",
      ok: true,
      detail: "No overlap on UV0, 2–4 px padding at 2k, UV1 reserved for lightmaps.",
    },
    {
      id: "naming",
      label: "Naming",
      kind: "check",
      ok: NAME_RULES[spec.engine].test(mesh),
      detail: `${mesh} · ${materialName(spec, spec.materials[0]?.name ?? "Main")} · ${collisionName(spec)}`,
    },
    {
      id: "collision",
      label: "Collision",
      kind: "check",
      ok: spec.collision !== "trimesh",
      detail: spec.collision === "trimesh" ? "Trimesh collision is expensive and unstable on movables; use a primitive or convex hull." : `${spec.collision} primitive → ${collisionName(spec)}.`,
    },
    {
      id: "lod",
      label: "LOD chain",
      kind: "check",
      ok: lod1 <= lod0 * 0.5 && lod2 <= lod0 * 0.2 && lod2 <= lod1,
      detail: `${lodName(spec, 0)} ${lod0} → ${lodName(spec, 1)} ${lod1} → ${lodName(spec, 2)} ${lod2}; LOD1 ≤ 50%, LOD2 ≤ 20% of LOD0.`,
    },
    {
      id: "pbr",
      label: "PBR ranges",
      kind: "check",
      ok: pbrProblems.length === 0,
      detail: pbrProblems.length ? pbrProblems.join(" ") : "Dielectrics metalness 0, metals metalness 1 with roughness 0.2–0.5, all roughness 0.04–0.95.",
    },
  ];
}

export function engineNotes(spec: AssetSpec) {
  const tex = textureSet(spec);
  if (spec.engine === "unreal") {
    return [
      "Import glTF as static mesh. Generate lightmap UVs if UV1 missing.",
      "Build Nanite only if hero/arch with unique geo; keep LODs for weapons and small props.",
      tex.notes,
      "Normal maps: Unreal expects DirectX (-Y). Blender bakes OpenGL (+Y), so enable Flip Green Channel on the normal texture.",
      "Collision: UBX_/USP_/UCP_/UCX_ prefixed meshes exported beside the render mesh (FBX, or glTF on UE 5.4+), or Auto Convex.",
      `Enable Nanite fallback or 3 LODs. Screen size ${LOD_SCREEN.lod0} / ${LOD_SCREEN.lod1} / ${LOD_SCREEN.lod2}, cull ${LOD_SCREEN.cull}.`,
    ];
  }
  if (spec.engine === "unity") {
    return [
      "glTF via UnityGLTF or FBX. Mesh compression Off for hero, Low for props.",
      "Import scale 1. Generate colliders: Box/Mesh (convex) on a child.",
      tex.notes,
      "URP Lit or HDRP Lit. Normal maps: Unity expects OpenGL (+Y), which is what Blender bakes; no flip.",
      `LOD Group: ${LOD_SCREEN.lod0 * 100}% / ${LOD_SCREEN.lod1 * 100}% / ${LOD_SCREEN.lod2 * 100}%, culled below ${LOD_SCREEN.cull * 100}%. Name the base mesh <mesh>_LOD0 (alongside _LOD1/_LOD2) and the importer builds the LOD Group itself.`,
    ];
  }
  if (spec.engine === "godot") {
    return [
      "Drop .glb into the scene. Keep importer 'Meshes > Ensure Tangents'.",
      "Add StaticBody3D + CollisionShape3D matching the primitive.",
      tex.notes,
      "StandardMaterial3D, texture filter Linear Mipmap Anisotropic. Normal maps: OpenGL (+Y) as baked; no flip.",
      "Use VisibilityRange or Mesh LOD. Shadow casting On for LOD0 only if small.",
    ];
  }
  return [
    "Apply scale (Ctrl+A). Origin to geometry or 3D cursor at ground.",
    "Weighted Normal modifier after bevel. Smooth by Angle 30–60° (Blender 4.1+ replaced Auto Smooth).",
    tex.notes,
    "Export glTF: +Y up, apply modifiers, selected only, punctual lights off.",
    "Pack resources or keep external textures in the folder next to the .glb.",
  ];
}

export function texelSheet(spec: AssetSpec) {
  const { x, y, z } = spec.dimensions;
  const faces = [
    { name: "Front", w: x, h: y },
    { name: "Side", w: z, h: y },
    { name: "Top", w: x, h: z },
  ];
  return faces.map((face) => ({
    ...face,
    pxW: Math.round(face.w * spec.texelDensity),
    pxH: Math.round(face.h * spec.texelDensity),
  }));
}
