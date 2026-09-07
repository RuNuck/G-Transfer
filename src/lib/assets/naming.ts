import type { AssetSpec, CollisionType, Engine } from "./types";

const PREFIX: Record<Engine, { mesh: string; mat: string; tex: string; col: string }> = {
  unreal: { mesh: "SM_", mat: "MI_", tex: "T_", col: "UCX_" },
  unity: { mesh: "", mat: "M_", tex: "T_", col: "COL_" },
  godot: { mesh: "", mat: "mat_", tex: "tex_", col: "" },
  blender: { mesh: "", mat: "MAT_", tex: "TEX_", col: "COL_" },
};

function slug(name: string) {
  return name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
}

export function meshName(spec: AssetSpec) {
  const s = slug(spec.name);
  const p = PREFIX[spec.engine];
  if (spec.engine === "unreal") return `${p.mesh}${s}`;
  if (spec.engine === "godot") return s.toLowerCase();
  return s;
}

export function materialName(spec: AssetSpec, matName: string) {
  const s = slug(matName);
  const p = PREFIX[spec.engine];
  if (spec.engine === "godot") return `${p.mat}${s.toLowerCase()}`;
  return `${p.mat}${s}`;
}

export function textureSet(spec: AssetSpec) {
  const s = slug(spec.name);
  const p = PREFIX[spec.engine];
  if (spec.engine === "unreal") {
    return {
      albedo: `${p.tex}${s}_D`,
      normal: `${p.tex}${s}_N`,
      packed: `${p.tex}${s}_ORM`,
      notes: "ORM packed: R=AO, G=Roughness, B=Metallic. sRGB off on N and ORM. N is DirectX (-Y): flip green when importing a Blender (OpenGL) bake.",
    };
  }
  if (spec.engine === "unity") {
    return {
      albedo: `${p.tex}${s}_Albedo`,
      normal: `${p.tex}${s}_Normal`,
      packed: `${p.tex}${s}_Mask`,
      notes: "HDRP Mask: R=Metallic, G=AO, B=Detail, A=Smoothness. URP: Metallic(A=Smoothness) + AO.",
    };
  }
  if (spec.engine === "godot") {
    const id = s.toLowerCase();
    return {
      albedo: `${p.tex}${id}_albedo`,
      normal: `${p.tex}${id}_normal`,
      packed: `${p.tex}${id}_orm`,
      notes: "Godot ORM: R=AO, G=Roughness, B=Metallic. Import as StandardMaterial3D.",
    };
  }
  return {
    albedo: `${p.tex}${s}_Diff`,
    normal: `${p.tex}${s}_Nrm`,
    packed: `${p.tex}${s}_ORM`,
    notes: "Blender: Principled BSDF. Bake to 2 UDIMs max; 4k hero, 2k prop, 1k kit.",
  };
}

/** Unreal reads the collision primitive type from the prefix: UBX_ box, USP_ sphere, UCP_ capsule, UCX_ convex. */
const UNREAL_COLLISION_PREFIX: Record<CollisionType, string> = {
  box: "UBX_",
  sphere: "USP_",
  capsule: "UCP_",
  convex: "UCX_",
  trimesh: "UCX_",
};

export function collisionName(spec: AssetSpec) {
  const base = meshName(spec);
  if (spec.engine === "unreal") return `${UNREAL_COLLISION_PREFIX[spec.collision]}${base}`;
  // Godot's importer turns a "-convcolonly" node into a StaticBody3D with a convex CollisionShape3D,
  // naming the body after whatever precedes the suffix; the "_col" keeps it from colliding with the mesh's own name.
  if (spec.engine === "godot") return `${base}_col-convcolonly`;
  return `${PREFIX[spec.engine].col}${base}`;
}

export function lodName(spec: AssetSpec, lod: 0 | 1 | 2) {
  const base = meshName(spec);
  if (spec.engine === "unreal") return `${base}_LOD${lod}`;
  return `${base}_LOD${lod}`;
}

export function folderHint(spec: AssetSpec) {
  if (spec.engine === "unreal") return `/Game/Art/${title(spec.category)}/${slug(spec.name)}/`;
  if (spec.engine === "unity") return `Assets/Art/${title(spec.category)}/${slug(spec.name)}/`;
  if (spec.engine === "godot") return `res://art/${spec.category}/${slug(spec.name).toLowerCase()}/`;
  return `//assets/${spec.category}/${slug(spec.name)}/`;
}

function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
