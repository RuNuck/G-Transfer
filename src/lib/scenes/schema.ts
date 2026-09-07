/**
 * Zod mirror of docs/schemas/scene-spec.schema.json (pragmatic — required + common fields).
 */
import { z } from "zod";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

const AabbMeters = z
  .object({
    min: Vec3,
    max: Vec3,
  })
  .strict();

const KitRole = z.enum([
  "terrain_tile",
  "path_dirt",
  "tree_trunk",
  "tree_canopy",
  "tree_root",
  "understory",
  "river_bank",
  "water_plane",
  "rock_scatter",
  "fallen_log",
  "mud_decal",
  "landmark",
  "other",
]);

const KitRef = z
  .object({
    id: z.string().regex(/^biome\.[a-z0-9_.-]+$/),
    role: KitRole,
    variant: z.string().optional(),
  })
  .strict();

const DensityCap = z
  .object({
    perSquareMeter: z.number().min(0).optional(),
    maxInstances: z.number().int().min(0).max(5000),
    minSpacingM: z.number().min(0).optional(),
  })
  .strict();

const ScatterLayer = z
  .object({
    enabled: z.boolean(),
    density: DensityCap,
    kitRoles: z.array(z.string()).optional(),
    excludeAabb: z.array(AabbMeters).optional(),
  })
  .strict();

const GroundLayer = z
  .object({
    style: z.enum(["tiled_kit", "heightfield_stub", "flat_plane"]),
    tileSizeM: z.number().min(1).optional(),
    path: z
      .object({
        polyline: z.array(Vec3).min(2).optional(),
        widthM: z.number().min(0.5).max(8).optional(),
        kitRole: z.literal("path_dirt").optional(),
      })
      .strict()
      .optional(),
    collision: z.enum(["trimesh_ground", "heightfield", "box_tiles"]).optional(),
  })
  .strict();

const WaterLayer = z
  .object({
    enabled: z.boolean(),
    style: z.enum(["kit_segments", "plane"]).optional(),
    river: z
      .object({
        polyline: z.array(Vec3).min(2).optional(),
        widthM: z.number().min(1).max(40).optional(),
        bankKitRole: z.literal("river_bank").optional(),
        waterKitRole: z.literal("water_plane").optional(),
        flowAxisHint: z.enum(["+x", "-x", "+z", "-z"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const LandmarkItem = z
  .object({
    id: z.string(),
    kitId: z.string().regex(/^biome\.[a-z0-9_.-]+$/),
    transform: z
      .object({
        translation: Vec3,
        rotationDeg: Vec3.optional(),
        scale: z.number().min(0.5).max(2).optional(),
      })
      .strict(),
  })
  .strict();

const LightingLayer = z
  .object({
    setups: z
      .array(
        z
          .object({
            id: z.string(),
            kind: z.enum(["sun_sky", "overcast", "god_rays", "night_moon", "custom"]),
            sunElevationDeg: z.number().optional(),
            sunAzimuthDeg: z.number().optional(),
            energy: z.number().min(0).optional(),
            notes: z.string().optional(),
          })
          .strict(),
      )
      .min(2),
    defaultSetup: z.string().optional(),
  })
  .strict();

const NavLayer = z
  .object({
    agentRadiusM: z.number().min(0.1).max(1.5).optional(),
    agentHeightM: z.number().min(0.5).max(3).optional(),
    walkableLayers: z.array(z.enum(["ground", "path", "bank"])).optional(),
    bakeHint: z.enum(["godot_navigation_region", "none"]).optional(),
  })
  .strict();

const Constraints = z
  .object({
    forbidMegaMesh: z.literal(true).optional(),
    maxTotalInstances: z.number().int().min(1).max(8000).optional(),
    maxUniqueKitPieces: z.number().int().min(1).max(256).optional(),
    requireRiverWhenBiome: z.array(z.string()).optional(),
    riverMustStayInsideAabb: z.boolean().optional(),
    pathMustStayInsideAabb: z.boolean().optional(),
    sameSeedStableHash: z.boolean().optional(),
  })
  .strict();

export const SceneSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^scene\.[a-z0-9_.-]+$/),
    displayName: z.string().optional(),
    biome: z.enum(["jungle_clearing", "jungle_river", "temperate_forest", "arid_outcrop", "custom"]),
    engine: z.enum(["godot", "unreal", "unity", "blender"]),
    aabb: AabbMeters,
    seed: z.number().int().min(0),
    layers: z
      .object({
        ground: GroundLayer,
        lighting: LightingLayer,
        water: WaterLayer.optional(),
        canopy: ScatterLayer.optional(),
        undergrowth: ScatterLayer.optional(),
        rocks: ScatterLayer.optional(),
        landmarks: z.object({ items: z.array(LandmarkItem) }).strict().optional(),
        nav: NavLayer.optional(),
      })
      .strict(),
    constraints: Constraints.optional(),
    kitRefs: z.array(KitRef).min(1).optional(),
    notes: z.string().optional(),
  })
  .strict();

export type SceneSpecParsed = z.infer<typeof SceneSpecSchema>;
