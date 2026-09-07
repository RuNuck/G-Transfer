/** SceneSpec types mirroring docs/schemas/scene-spec.schema.json (schemaVersion 1). */

export type Vec3 = [number, number, number];

export type AabbMeters = {
  min: Vec3;
  max: Vec3;
};

export type Biome =
  | "jungle_clearing"
  | "jungle_river"
  | "temperate_forest"
  | "arid_outcrop"
  | "custom";

export type SceneEngine = "godot" | "unreal" | "unity" | "blender";

export type KitRole =
  | "terrain_tile"
  | "path_dirt"
  | "tree_trunk"
  | "tree_canopy"
  | "tree_root"
  | "understory"
  | "river_bank"
  | "water_plane"
  | "rock_scatter"
  | "fallen_log"
  | "mud_decal"
  | "landmark"
  | "other";

export type KitRef = {
  id: string;
  role: KitRole;
  variant?: string;
};

export type DensityCap = {
  perSquareMeter?: number;
  maxInstances: number;
  minSpacingM?: number;
};

export type ScatterLayer = {
  enabled: boolean;
  density: DensityCap;
  kitRoles?: string[];
  excludeAabb?: AabbMeters[];
};

export type GroundLayer = {
  style: "tiled_kit" | "heightfield_stub" | "flat_plane";
  tileSizeM?: number;
  path?: {
    polyline?: Vec3[];
    widthM?: number;
    kitRole?: "path_dirt";
  };
  collision?: "trimesh_ground" | "heightfield" | "box_tiles";
};

export type WaterLayer = {
  enabled: boolean;
  style?: "kit_segments" | "plane";
  river?: {
    polyline?: Vec3[];
    widthM?: number;
    bankKitRole?: "river_bank";
    waterKitRole?: "water_plane";
    flowAxisHint?: "+x" | "-x" | "+z" | "-z";
  };
};

export type LandmarkItem = {
  id: string;
  kitId: string;
  transform: {
    translation: Vec3;
    rotationDeg?: Vec3;
    scale?: number;
  };
};

export type LandmarksLayer = {
  items: LandmarkItem[];
};

export type LightSetup = {
  id: string;
  kind: "sun_sky" | "overcast" | "god_rays" | "night_moon" | "custom";
  sunElevationDeg?: number;
  sunAzimuthDeg?: number;
  energy?: number;
  notes?: string;
};

export type LightingLayer = {
  setups: LightSetup[];
  defaultSetup?: string;
};

export type NavLayer = {
  agentRadiusM?: number;
  agentHeightM?: number;
  walkableLayers?: Array<"ground" | "path" | "bank">;
  bakeHint?: "godot_navigation_region" | "none";
};

export type SceneLayers = {
  ground: GroundLayer;
  lighting: LightingLayer;
  water?: WaterLayer;
  canopy?: ScatterLayer;
  undergrowth?: ScatterLayer;
  rocks?: ScatterLayer;
  landmarks?: LandmarksLayer;
  nav?: NavLayer;
};

export type SceneConstraints = {
  forbidMegaMesh?: true;
  maxTotalInstances?: number;
  maxUniqueKitPieces?: number;
  requireRiverWhenBiome?: string[];
  riverMustStayInsideAabb?: boolean;
  pathMustStayInsideAabb?: boolean;
  sameSeedStableHash?: boolean;
};

export type SceneSpec = {
  schemaVersion: 1;
  id: string;
  displayName?: string;
  biome: Biome;
  engine: SceneEngine;
  aabb: AabbMeters;
  seed: number;
  layers: SceneLayers;
  constraints?: SceneConstraints;
  kitRefs?: KitRef[];
  notes?: string;
};

/** Directory id under exports/scenes/ (dots → underscores). */
export function sceneExportId(sceneId: string): string {
  return sceneId.replace(/\./g, "_");
}
