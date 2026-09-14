import { CATALOG, catalogByKind } from "./catalog";
import { DEFAULT_ENGINE, KINDS, type AssetKind, type AssetSpec, type Engine } from "./types";

/**
 * Kind aliases. Phrases are matched on word boundaries after normalising
 * punctuation, and the LONGEST matching phrase wins (ties go to the earlier row),
 * so "oil lantern" is a lantern, "ammo box" is an ammo can and "pumpkin" is nothing.
 */
const KIND_ALIASES: Array<{ keys: string[]; kind: AssetKind }> = [
  { keys: ["sci-fi crate", "scifi crate", "supply crate", "hard surface crate", "sci-fi container", "cargo pod", "military crate"], kind: "sci_crate" },
  { keys: ["crate", "box", "container", "shipping crate", "wooden box", "wooden crate", "storage box"], kind: "crate" },
  { keys: ["barrel", "drum", "oil drum", "oil barrel", "keg", "cask"], kind: "barrel" },
  { keys: ["chest", "loot chest", "treasure chest", "treasure", "loot", "coffer"], kind: "chest" },
  { keys: ["ammo can", "ammo box", "ammunition box", "ammunition can", "ammo", "ammunition"], kind: "ammo_can" },
  { keys: ["shotgun", "combat shotgun", "pump-action", "pump action", "scattergun"], kind: "shotgun" },
  { keys: ["rifle", "assault rifle", "carbine", "ar-15", "ar15", "gun", "smg", "submachine gun", "machine gun"], kind: "rifle" },
  { keys: ["pistol", "sidearm", "handgun", "revolver"], kind: "pistol" },
  { keys: ["sword", "longsword", "blade", "broadsword", "katana", "greatsword"], kind: "sword" },
  { keys: ["dagger", "knife", "dirk", "combat knife"], kind: "dagger" },
  { keys: ["shield", "buckler", "kite shield", "round shield"], kind: "shield" },
  { keys: ["helmet", "helm", "closed helm", "hard hat"], kind: "helmet" },
  { keys: ["pillar", "column"], kind: "pillar" },
  { keys: ["wall", "modular wall", "wall module", "wall panel", "wall segment"], kind: "wall" },
  { keys: ["stairs", "stair", "staircase", "steps", "stair module", "stairway"], kind: "stairs" },
  { keys: ["pipe", "pipes", "pipe junction", "junction", "conduit", "pipework"], kind: "pipe" },
  { keys: ["door", "hatch", "bulkhead", "bulkhead door", "gate", "doorway"], kind: "door" },
  { keys: ["vent", "grille", "grate", "air vent", "vent module", "vent cover"], kind: "vent" },
  { keys: ["lantern", "lamp", "oil lantern", "torch"], kind: "lantern" },
  { keys: ["potion", "flask", "vial", "potion flask", "bottle", "elixir"], kind: "potion" },
  { keys: ["hoverbike", "hover bike", "speeder", "speeder bike", "bike", "motorbike", "motorcycle", "vehicle"], kind: "hoverbike" },
  { keys: ["mannequin", "character", "human", "humanoid", "figure", "hero mannequin", "person"], kind: "mannequin" },
  { keys: ["jungle mud tile", "terrain tile mud", "mud tile"], kind: "jungle_terrain_tile_mud" },
  { keys: ["jungle dirt path", "path dirt", "dirt path"], kind: "jungle_path_dirt_a" },
  { keys: ["jungle trunk a", "tree trunk a"], kind: "jungle_tree_trunk_a" },
  { keys: ["jungle trunk b", "tree trunk b"], kind: "jungle_tree_trunk_b" },
  { keys: ["jungle canopy", "tree canopy"], kind: "jungle_tree_canopy_a" },
  { keys: ["jungle root", "tree root"], kind: "jungle_tree_root_a" },
  { keys: ["jungle fern", "fern card"], kind: "jungle_fern_card_a" },
  { keys: ["jungle shrub", "shrub"], kind: "jungle_shrub_a" },
  { keys: ["jungle river bank", "river bank"], kind: "jungle_river_bank_a" },
  { keys: ["jungle water", "water plane"], kind: "jungle_water_plane_a" },
  { keys: ["jungle rock", "rock scatter"], kind: "jungle_rock_scatter_a" },
  { keys: ["jungle fallen log", "fallen log"], kind: "jungle_fallen_log_a" },
  { keys: ["jungle mud decal", "mud decal"], kind: "jungle_mud_decal_a" },
];

const ENGINE_ALIASES: Array<{ keys: string[]; engine: Engine }> = [
  { keys: ["unreal", "unreal engine", "ue5", "ue4", "nanite", "lumen"], engine: "unreal" },
  { keys: ["unity", "urp", "hdrp"], engine: "unity" },
  { keys: ["godot"], engine: "godot" },
  { keys: ["blender"], engine: "blender" },
];

/** Lower-case, punctuation collapsed to single spaces, padded so every word has boundaries. */
function normalize(text: string) {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function longestMatch<T>(brief: string, rows: Array<{ keys: string[]; value: T }>): T | null {
  const q = normalize(brief);
  let best: { value: T; length: number } | null = null;
  for (const row of rows) {
    for (const key of row.keys) {
      const phrase = normalize(key);
      if (phrase.trim() && q.includes(phrase) && (!best || phrase.length > best.length)) {
        best = { value: row.value, length: phrase.length };
      }
    }
  }
  return best ? best.value : null;
}

export function inferKind(brief: string): AssetKind {
  return longestMatch(brief, KIND_ALIASES.map((row) => ({ keys: row.keys, value: row.kind }))) ?? "sci_crate";
}

/** Engine named in the brief, or the fallback. Callers that know the engine must not call this. */
export function inferEngine(brief: string, fallback: Engine = DEFAULT_ENGINE): Engine {
  return longestMatch(brief, ENGINE_ALIASES.map((row) => ({ keys: row.keys, value: row.engine }))) ?? fallback;
}

function hashSeed(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function makeId() {
  return `anv_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * Build a spec from a brief. `engine` is authoritative when given (a UI tab, an explicit
 * tool argument); only when it is omitted is the engine inferred from the brief.
 */
export function specFromBrief(brief: string, engine?: Engine, kind?: AssetKind): AssetSpec {
  const resolved = kind && KINDS.includes(kind) ? kind : inferKind(brief);
  const item = catalogByKind(resolved);
  const seed = hashSeed(brief.trim() || item.brief);
  const name = titleFromBrief(brief, item.name);
  return {
    id: makeId(),
    name,
    kind: resolved,
    category: item.category,
    style: item.style,
    engine: engine ?? inferEngine(brief, DEFAULT_ENGINE),
    brief: brief.trim() || item.brief,
    units: "meters",
    dimensions: item.dimensions,
    triangleBudget: item.triangleBudget,
    texelDensity: item.texelDensity,
    materials: defaultMaterials(resolved, seed),
    collision: item.collision,
    pivot: item.category === "weapons" ? "center" : "bottom",  // held items pivot at their centre of mass
    seed,
    tags: [item.category, item.style, resolved],
    createdAt: Date.now(),
  };
}

export function specFromKind(kind: AssetKind, engine: Engine): AssetSpec {
  const item = catalogByKind(kind);
  const spec = specFromBrief(item.brief, engine, kind);
  spec.name = item.name;
  return spec;
}

const FILLER =
  /^(?:please\s+)?(?:(?:make|create|build|design|forge|model|generate|give|draw)\s+(?:me\s+)?(?:a|an|the)?\s*|i\s+(?:want|need)\s+(?:a|an|the)?\s*|(?:a|an|the)\s+)/i;
const MEASURE = /\b\d+(?:[.,]\d+)?\s*(?:m|cm|mm|meters?|metres?)\b/gi;
const ENGINE_WORDS = /\b(?:unreal(?:\s+engine)?|ue[45]|unity|godot|blender|urp|hdrp|nanite|lumen)\b/gi;

/**
 * The asset's display name: the first clause of the brief (commas, semicolons, line
 * breaks, or a period that is not a decimal point), minus leading filler, sizes and
 * engine names. Falls back to the prototype name when nothing usable is left.
 */
function titleFromBrief(brief: string, fallback: string) {
  const trimmed = brief.trim();
  if (!trimmed) return fallback;
  let first = trimmed.split(/[,;\n]|\.(?!\d)/)[0]?.trim() ?? "";
  first = first.replace(FILLER, "").replace(MEASURE, "").replace(ENGINE_WORDS, "").replace(/\s+/g, " ").trim();
  first = first.replace(/^[\s\-–:]+|[\s\-–:]+$/g, "");
  if (!/[a-z0-9]/i.test(first) || first.length < 3 || first.length > 36) return fallback;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function defaultMaterials(kind: AssetKind, seed: number): AssetSpec["materials"] {
  const n = (seed % 1000) / 1000;
  const wood = lerpColor("#6b4b2a", "#8a6236", n);
  const steel = lerpColor("#6f7378", "#9aa0a6", n);
  const paint = lerpColor("#3e4a3a", "#4d5c3f", n);
  const sci = lerpColor("#3a4148", "#4e5963", n);
  switch (kind) {
    case "crate":
    case "chest":
      return [
        mat("Wood", "primary", wood, 0.72, 0.02),
        mat("Steel bands", "trim", steel, 0.38, 0.85),
      ];
    case "sci_crate":
    case "door":
    case "vent":
    case "hoverbike":
      return [
        mat("Hull", "primary", sci, 0.42, 0.72),
        mat("Trim", "trim", steel, 0.28, 0.9),
        mat("Lamp", "emissive", "#c9d6c4", 0.4, 0.0, "#c9d6c4", 1.8),
      ];
    case "barrel":
      return [mat("Painted steel", "primary", paint, 0.55, 0.0), mat("Rust rim", "trim", "#6a4636", 0.85, 0.0)];
    case "ammo_can":
      return [mat("Olive drab", "primary", "#4a5238", 0.6, 0.0), mat("Steel", "trim", steel, 0.35, 0.88)];
    case "sword":
    case "dagger":
      return [
        mat("Blade", "primary", "#c5c8cc", 0.22, 0.95),
        mat("Wrap", "secondary", "#4a372c", 0.78, 0.05),
        mat("Guard", "trim", steel, 0.3, 0.9),
      ];
    case "pistol":
    case "rifle":
    case "shotgun":
      return [
        mat("Receiver", "primary", "#3d4046", 0.4, 0.78),
        mat("Polymer", "secondary", "#2a2b2e", 0.62, 0.08),
        mat("Steel", "trim", steel, 0.28, 0.92),
      ];
    case "shield":
      return [mat("Face", "primary", "#6e3b32", 0.68, 0.05), mat("Rim", "trim", steel, 0.32, 0.88)];
    case "helmet":
      return [mat("Plate", "primary", steel, 0.3, 0.9), mat("Leather", "secondary", "#4a372c", 0.75, 0.04)];
    case "pillar":
    case "wall":
    case "stairs":
      return [mat("Stone", "primary", "#7a7468", 0.82, 0.04), mat("Moss", "secondary", "#4d5a42", 0.86, 0.02)];
    case "pipe":
      return [mat("Steel", "primary", "#6a6e72", 0.45, 0.82), mat("Rust", "trim", "#6a4636", 0.85, 0.0)];
    case "lantern":
      return [
        mat("Brass", "trim", "#b08a4a", 0.35, 1.0),
        mat("Glass", "glass", "#c5d4c8", 0.08, 0.0),
        mat("Flame", "emissive", "#f0e2b8", 0.4, 0, "#f0e2b8", 3.2),
      ];
    case "potion":
      return [
        mat("Glass", "glass", "#3e6a52", 0.12, 0.0),
        mat("Liquid", "emissive", "#6fbf7a", 0.35, 0, "#6fbf7a", 1.4),
        mat("Cork", "secondary", "#8a6236", 0.85, 0.02),
      ];
    case "mannequin":
      return [mat("Clay", "primary", "#c4b7a4", 0.7, 0.04)];
    case "jungle_terrain_tile_mud":
    case "jungle_path_dirt_a":
    case "jungle_mud_decal_a":
    case "jungle_river_bank_a":
      return [
        mat("Soil", "primary", lerpColor("#4a3a28", "#5c4630", n), 0.88, 0.0),
        mat("Moss", "secondary", "#3d5240", 0.9, 0.0),
        mat("Wet", "trim", "#2f3a32", 0.55, 0.0),
      ];
    case "jungle_tree_trunk_a":
    case "jungle_tree_trunk_b":
    case "jungle_tree_root_a":
    case "jungle_fallen_log_a":
      return [
        mat("Bark", "primary", lerpColor("#3a2a1c", "#4a3828", n), 0.86, 0.0),
        mat("Moss", "secondary", "#3d5240", 0.9, 0.0),
        mat("Wet bark", "trim", "#2a2218", 0.7, 0.0),
      ];
    case "jungle_tree_canopy_a":
    case "jungle_fern_card_a":
    case "jungle_shrub_a":
      return [
        mat("Foliage", "primary", lerpColor("#2f4a28", "#3a5a32", n), 0.78, 0.0),
        mat("Stem", "secondary", "#3a2a1c", 0.85, 0.0),
        mat("Vein", "trim", "#243820", 0.7, 0.0),
      ];
    case "jungle_water_plane_a":
      return [
        mat("Water", "glass", "#3a6a72", 0.08, 0.0),
        mat("Depth", "primary", "#1e3a42", 0.35, 0.0),
      ];
    case "jungle_rock_scatter_a":
      return [
        mat("Stone", "primary", "#6a6560", 0.82, 0.04),
        mat("Dirt", "secondary", "#4a3a28", 0.88, 0.0),
        mat("Wet stone", "trim", "#4a5048", 0.55, 0.0),
      ];
    default:
      return [mat("Default", "primary", sci, 0.5, 0.0)];
  }
}

function mat(
  name: string,
  slot: AssetSpec["materials"][number]["slot"],
  albedo: string,
  roughness: number,
  metalness: number,
  emissive?: string,
  emissiveIntensity?: number,
): AssetSpec["materials"][number] {
  // Production PBR: metallicFactor must be binary 0 (dielectric) or 1 (metal).
  const metal = metalness >= 0.5 ? 1 : 0;
  return { name, slot, albedo, roughness, metalness: metal, emissive, emissiveIntensity };
}

function lerpColor(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const mix = (shift: number) => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${mix(16)}${mix(8)}${mix(0)}`;
}

export function allKinds() {
  return CATALOG.map((item) => item.kind);
}
