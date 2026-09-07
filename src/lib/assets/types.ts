export const ENGINES = ["godot", "unreal", "unity", "blender"] as const;
export type Engine = (typeof ENGINES)[number];
/** The engine used when a brief names none and no engine is chosen: the studio's and the MCP tools' default. */
export const DEFAULT_ENGINE: Engine = "godot";

export const STYLES = ["hard_surface", "stylized", "realistic", "hand_painted"] as const;
export type ArtStyle = (typeof STYLES)[number];

export const KINDS = [
  "crate",
  "sci_crate",
  "barrel",
  "chest",
  "ammo_can",
  "sword",
  "dagger",
  "pistol",
  "rifle",
  "shotgun",
  "shield",
  "helmet",
  "pillar",
  "wall",
  "stairs",
  "pipe",
  "door",
  "vent",
  "lantern",
  "potion",
  "hoverbike",
  "mannequin",
] as const;
export type AssetKind = (typeof KINDS)[number];

export const CATEGORIES = ["props", "weapons", "architecture", "vehicles", "characters"] as const;
export type Category = (typeof CATEGORIES)[number];

export type CollisionType = "box" | "convex" | "capsule" | "sphere" | "trimesh";
export type Pivot = "bottom" | "center";
export type ViewMode = "lit" | "unlit" | "wire" | "clay";

export type LodLevel = 0 | 1 | 2;

export type PbrMaterial = {
  name: string;
  slot: "primary" | "secondary" | "trim" | "emissive" | "glass";
  albedo: string;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
};

export type AssetSpec = {
  id: string;
  name: string;
  kind: AssetKind;
  category: Category;
  style: ArtStyle;
  engine: Engine;
  brief: string;
  units: "meters";
  dimensions: { x: number; y: number; z: number };
  triangleBudget: { lod0: number; lod1: number; lod2: number };
  texelDensity: number;
  materials: PbrMaterial[];
  collision: CollisionType;
  pivot: Pivot;
  seed: number;
  tags: string[];
  createdAt: number;
};

export type QcItem = {
  id: string;
  label: string;
  /** "check" is computed from the spec and can fail; "note" is a convention reminder. */
  kind: "check" | "note";
  ok: boolean;
  detail: string;
};

export type PipelineStage = {
  id: string;
  label: string;
  status: "done" | "ready" | "blocked";
  note: string;
};

export type CatalogItem = {
  kind: AssetKind;
  name: string;
  category: Category;
  blurb: string;
  brief: string;
  style: ArtStyle;
  triangleBudget: { lod0: number; lod1: number; lod2: number };
  texelDensity: number;
  collision: CollisionType;
  dimensions: { x: number; y: number; z: number };
};

export type McpLogEntry = {
  id: string;
  at: number;
  direction: "in" | "out" | "sys";
  method: string;
  summary: string;
  payload?: unknown;
};

export const ENGINE_LABEL: Record<Engine, string> = {
  unreal: "Unreal",
  unity: "Unity",
  godot: "Godot",
  blender: "Blender",
};

export const KIND_LABEL: Record<AssetKind, string> = {
  crate: "Shipping crate",
  sci_crate: "Sci-fi crate",
  barrel: "Oil barrel",
  chest: "Relic chest",
  ammo_can: "Ammo can",
  sword: "Longsword",
  dagger: "Dagger",
  pistol: "Sidearm",
  rifle: "Infantry rifle",
  shotgun: "Combat shotgun",
  shield: "Kite shield",
  helmet: "Closed helm",
  pillar: "Stone pillar",
  wall: "Wall module",
  stairs: "Stair module",
  pipe: "Pipe junction",
  door: "Bulkhead door",
  vent: "Vent module",
  lantern: "Oil lantern",
  potion: "Potion flask",
  hoverbike: "Hover bike",
  mannequin: "Hero mannequin",
};
