import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ForgedLods } from "./assets/forged";
import { specFromBrief, specFromKind } from "./assets/spec";
import {
  CATEGORIES,
  DEFAULT_ENGINE,
  ENGINES,
  KINDS,
  STYLES,
  type AssetKind,
  type AssetSpec,
  type CollisionType,
  type Engine,
  type LodLevel,
  type McpLogEntry,
  type PbrMaterial,
  type ViewMode,
} from "./assets/types";

type Panel = "catalog" | "inspect" | "pipeline" | "connect";

type ForgeState = {
  engine: Engine;
  brief: string;
  spec: AssetSpec | null;
  library: AssetSpec[];
  lod: LodLevel;
  viewMode: ViewMode;
  panel: Panel;
  forging: boolean;
  logs: McpLogEntry[];
  origin: string;
  /** Per-LOD triangles of the forged GLB the viewport is drawing, or null on the blockout. Session only. */
  forgedLods: ForgedLods | null;
  setEngine: (engine: Engine) => void;
  setBrief: (brief: string) => void;
  setPanel: (panel: Panel) => void;
  setLod: (lod: LodLevel) => void;
  setViewMode: (mode: ViewMode) => void;
  setOrigin: (origin: string) => void;
  pickKind: (kind: AssetKind) => void;
  applySpec: (spec: AssetSpec) => void;
  removeFromLibrary: (id: string) => void;
  loadFromLibrary: (id: string) => void;
  pushLog: (entry: Omit<McpLogEntry, "id" | "at">) => void;
  setForging: (on: boolean) => void;
  setForgedLods: (lods: ForgedLods | null) => void;
};

/** The slice that survives reloads. Everything else is session state. */
type PersistedForge = Pick<ForgeState, "engine" | "brief" | "spec" | "library">;

export const STORAGE_KEY = "anvil-forge-v1";
const STORAGE_VERSION = 1;
const LIBRARY_LIMIT = 40;

const first = specFromKind("sci_crate", DEFAULT_ENGINE);

const COLLISIONS: readonly CollisionType[] = ["box", "convex", "capsule", "sphere", "trimesh"];

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sanitizeMaterial(value: unknown): PbrMaterial | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Partial<PbrMaterial>;
  if (typeof m.name !== "string" || typeof m.albedo !== "string") return null;
  if (typeof m.roughness !== "number" || typeof m.metalness !== "number") return null;
  return {
    name: m.name,
    slot: oneOf(["primary", "secondary", "trim", "emissive", "glass"] as const, m.slot) ? m.slot : "primary",
    albedo: m.albedo,
    roughness: Math.min(1, Math.max(0, m.roughness)),
    metalness: Math.min(1, Math.max(0, m.metalness)),
    emissive: typeof m.emissive === "string" ? m.emissive : undefined,
    emissiveIntensity: typeof m.emissiveIntensity === "number" ? m.emissiveIntensity : undefined,
  };
}

/**
 * Turn whatever was in storage into a spec the app can render, or null. Fields the
 * catalog can supply (style, budget, texel, collision, pivot) fall back to the
 * prototype's values; the identity of the saved asset (id, name, brief, materials,
 * dimensions) is kept.
 */
export function sanitizeSpec(value: unknown): AssetSpec | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<AssetSpec>;
  if (!oneOf(KINDS, s.kind) || !oneOf(ENGINES, s.engine)) return null;
  if (typeof s.id !== "string" || typeof s.name !== "string") return null;
  const d = s.dimensions;
  if (!d || !positive(d.x) || !positive(d.y) || !positive(d.z)) return null;
  const materials = Array.isArray(s.materials) ? s.materials.map(sanitizeMaterial).filter((m): m is PbrMaterial => m !== null) : [];
  if (materials.length === 0) return null;
  const fresh = specFromKind(s.kind, s.engine);
  const tb = s.triangleBudget;
  return {
    ...fresh,
    id: s.id,
    name: s.name,
    brief: typeof s.brief === "string" && s.brief.trim() ? s.brief : fresh.brief,
    dimensions: { x: d.x, y: d.y, z: d.z },
    materials,
    style: oneOf(STYLES, s.style) ? s.style : fresh.style,
    category: oneOf(CATEGORIES, s.category) ? s.category : fresh.category,
    triangleBudget:
      tb && positive(tb.lod0) && positive(tb.lod1) && positive(tb.lod2) ? { lod0: tb.lod0, lod1: tb.lod1, lod2: tb.lod2 } : fresh.triangleBudget,
    texelDensity: positive(s.texelDensity) ? s.texelDensity : fresh.texelDensity,
    collision: oneOf(COLLISIONS, s.collision) ? s.collision : fresh.collision,
    pivot: s.pivot === "center" || s.pivot === "bottom" ? s.pivot : fresh.pivot,
    seed: typeof s.seed === "number" && Number.isFinite(s.seed) ? s.seed : fresh.seed,
    tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === "string") : fresh.tags,
    createdAt: typeof s.createdAt === "number" && Number.isFinite(s.createdAt) ? s.createdAt : fresh.createdAt,
  };
}

/** Validate a persisted blob against the current defaults; never trust storage. */
export function sanitizePersisted(persisted: unknown, current: PersistedForge): PersistedForge {
  const p = (persisted && typeof persisted === "object" ? persisted : {}) as Partial<Record<keyof PersistedForge, unknown>>;
  const engine = oneOf(ENGINES, p.engine) ? p.engine : current.engine;
  const library = Array.isArray(p.library)
    ? p.library.map(sanitizeSpec).filter((s): s is AssetSpec => s !== null).slice(0, LIBRARY_LIMIT)
    : current.library;
  const spec = sanitizeSpec(p.spec) ?? library[0] ?? current.spec ?? specFromKind("sci_crate", engine);
  const brief = typeof p.brief === "string" && p.brief.trim() ? p.brief : spec.brief;
  return { engine, brief, spec, library: library.length ? library : [spec] };
}

const noopStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

/**
 * localStorage that refuses writes until the store has been rehydrated. The persist
 * middleware writes partialize(state) on EVERY set, so a set that runs before
 * rehydrate() (a child effect, a hot reload) would overwrite the saved state with the
 * defaults and rehydrate would then read those defaults back.
 */
function guardedStorage() {
  if (typeof window === "undefined") return noopStorage;
  return {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => {
      if (useForge.persist.hasHydrated()) window.localStorage.setItem(key, value);
    },
    removeItem: (key: string) => window.localStorage.removeItem(key),
  };
}

export const useForge = create<ForgeState>()(
  persist(
    (set, get) => ({
      engine: DEFAULT_ENGINE,
      brief: first.brief,
      spec: first,
      library: [first],
      lod: 0,
      viewMode: "lit",
      panel: "catalog",
      forging: false,
      logs: [
        {
          id: "boot",
          at: Date.now(),
          direction: "sys",
          method: "initialize",
          summary: "Anvil MCP ready",
        },
      ],
      origin: "",
      forgedLods: null,
      setEngine: (engine) =>
        set((state) => {
          // The header engine is authoritative: re-target the current asset so naming,
          // notes and the persisted spec agree with it.
          const spec = state.spec ? { ...state.spec, engine } : state.spec;
          return { engine, spec, library: spec ? upsert(state.library, spec) : state.library };
        }),
      setBrief: (brief) => set({ brief }),
      setPanel: (panel) => set({ panel }),
      setLod: (lod) => set({ lod }),
      setViewMode: (viewMode) => set({ viewMode }),
      setOrigin: (origin) => set({ origin }),
      pickKind: (kind) => {
        const spec = specFromKind(kind, get().engine);
        set({
          spec,
          brief: spec.brief,
          library: upsert(get().library, spec),
        });
      },
      applySpec: (spec) =>
        set({
          spec,
          brief: spec.brief,
          engine: spec.engine,
          library: upsert(get().library, spec),
        }),
      removeFromLibrary: (id) =>
        set((state) => {
          const library = state.library.filter((item) => item.id !== id);
          if (state.spec?.id !== id) return { library };
          const next = library[0] ?? state.spec;
          return { library, spec: next, brief: next?.brief ?? state.brief, engine: next?.engine ?? state.engine };
        }),
      loadFromLibrary: (id) => {
        const spec = sanitizeSpec(get().library.find((item) => item.id === id));
        if (spec) set({ spec, brief: spec.brief, engine: spec.engine });
      },
      pushLog: (entry) =>
        set({
          logs: [
            { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...entry },
            ...get().logs,
          ].slice(0, 80),
        }),
      setForging: (forging) => set({ forging }),
      setForgedLods: (forgedLods) => set({ forgedLods }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(guardedStorage),
      // SSR: the first client render must match the server's, so hydration is
      // triggered explicitly by the Studio once it is mounted (see Studio.tsx).
      skipHydration: true,
      partialize: (state) => ({
        engine: state.engine,
        brief: state.brief,
        spec: state.spec,
        library: state.library,
      }),
      migrate: (persisted) => persisted as PersistedForge,
      merge: (persisted, current) => ({ ...current, ...sanitizePersisted(persisted, current) }),
    },
  ),
);

/** Same asset by identity or by content (a re-pick of a prototype) replaces its earlier entry. */
function upsert(list: AssetSpec[], spec: AssetSpec) {
  const same = (item: AssetSpec) =>
    item.id === spec.id || (item.kind === spec.kind && item.engine === spec.engine && item.name === spec.name && item.brief === spec.brief);
  return [spec, ...list.filter((item) => !same(item))].slice(0, LIBRARY_LIMIT);
}

export function localForge(brief: string, engine: Engine, kind?: AssetKind) {
  return specFromBrief(brief, engine, kind);
}
