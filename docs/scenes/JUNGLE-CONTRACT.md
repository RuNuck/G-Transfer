# Jungle scene export contract

**Status:** Hand contract (composer not required yet)  
**Applies to:** `exports/scenes/<id>/`  
**Related:** `docs/schemas/scene-spec.schema.json`, Phase 3–4 in `docs/DESIGN-AND-ROADMAP.md`

A jungle (or any biome scene) is a **composition of kit instances**, never a single generative mega-mesh. This document defines what a valid scene export directory must contain so agents and humans can author or validate layouts before `forge_scene` exists.

---

## Directory layout

```
exports/scenes/<id>/
  scene.json          # SceneSpec (schemaVersion 1), canonical input
  scene.tscn          # Godot 4.x packed scene (instance-only)
  manifest.json       # Instance list + budgets + hashes (see below)
  validation.json     # ValidationReport stub or full gates
  lights/             # Optional: per-setup notes or probe renders
    overcast.md
    god_rays.md
  README.md           # Optional human note (seed, intent)
```

`<id>` matches `SceneSpec.id` with dots as underscore form for portability, e.g. `scene.jungle.clearing_01` → `scene_jungle_clearing_01`.

---

## `scene.tscn` shape

Hard rules:

1. **Root** is a `Node3D` named `SceneRoot` (or the `displayName` slug).
2. **Children are instances or lightweight helpers only:**
   - `Ground` — terrain tile / path instances + ground collision proxies
   - `Water` — river bank + water plane kit instances (no fused river mesh)
   - `Canopy` / `Undergrowth` / `Rocks` / `Landmarks` — one `Node3D` per layer
   - `Lighting_overcast`, `Lighting_god_rays` (or equivalent) — **at least two** named setups
   - `Navigation` — optional `NavigationRegion3D` stub
3. **Every visual prop** is a Godot scene/GLB instance referencing a kit piece (`biome.jungle.*`). Inline unique meshes that are not kit pieces are **forbidden** except collision proxies and thin helpers.
4. **Transforms** in meters; scale `(1,1,1)` unless SceneSpec landmark sets uniform scale in `[0.5, 2]`.
5. **No `_LOD*` sibling draw bombs** in the packed scene for Godot.

Suggested instance naming: `{kitIdShort}_{index}` e.g. `tree_trunk_a_017`.

---

## Instance budgets (defaults)

| Layer | Soft density | Hard max instances | Min spacing |
|---|---|---|---|
| Canopy (trunk+canopy+root groups) | ~0.03–0.04 / m² | 120 | 3.0 m |
| Undergrowth | ~0.1–0.15 / m² | 400 | 0.5 m |
| Rocks / logs | ~0.02 / m² | 80 | 1.0 m |
| Landmarks | explicit list | 16 | n/a |
| **Scene total** | — | **1200** (SceneSpec may lower) | — |

A scene **fails** validation if any hard max or `constraints.maxTotalInstances` is exceeded.

---

## `manifest.json` (minimum)

```json
{
  "schemaVersion": 1,
  "sceneId": "scene.jungle.clearing_01",
  "seed": 20260906,
  "engine": "godot",
  "instanceCount": 0,
  "byLayer": {
    "ground": 0,
    "water": 0,
    "canopy": 0,
    "undergrowth": 0,
    "rocks": 0,
    "landmarks": 0
  },
  "kitRefsUsed": ["biome.jungle.tree_trunk_a"],
  "lightSetups": ["overcast", "god_rays"],
  "contentHash": "sha256:…",
  "megaMeshRejected": true
}
```

`contentHash` covers the ordered instance list (kit id + rounded transform). **Same SceneSpec seed ⇒ same hash.**

---

## Validation rules (fail closed)

| Gate | Fail when |
|---|---|
| **Schema** | `scene.json` fails SceneSpec schema |
| **Bounds** | Any instance origin outside `aabb` (with small epsilon) |
| **Kits resolve** | kit refs / instance paths missing from index or files absent |
| **Mega-mesh** | A single mesh/GLB claims to be the whole jungle |
| **Instance budget** | Layer or total caps exceeded |
| **Lights ≥ 2** | Fewer than two named setups in `.tscn` / manifest |
| **Collision** | Ground layer has no collision proxies when required |
| **River/path** | Polylines leave `aabb` when `*MustStayInsideAabb` |
| **Godot import** | Headless open of `scene.tscn` fails (when Godot available) |
| **Scale surgery** | Non-uniform scale on kit instances |

Soft (warn): TD mismatch across kit pieces, overlapping trunks closer than `minSpacingM`, landmark scale ≠ 1.

---

## Explicitly forbidden

- `jungle.glb` / `clearing_merged.glb` as playable scene content
- Embedding full tree geometry that duplicates kit meshes instead of instancing
- Claiming `ready` without `validation.json` artifact gates (once tooling lands)
- Wind foliage, fluid sim water, or perfect navmesh as Phase 4 blockers

---

## Hand-built sample (pre-composer)

Until `forge_scene` exists:

1. Copy `docs/schemas/examples/jungle-clearing.scene.json` → `exports/scenes/<id>/scene.json`
2. Assemble `scene.tscn` in Godot by instancing ready `biome.jungle.*` GLBs
3. Fill `manifest.json` counts by hand or script
4. Keep `validation.json` as a checklist stub listing the gates above

Phase 3 exit: ≥12 jungle pieces `ready` snap into a hand-built sample `.tscn` with **no scale fixes**. Phase 4 replaces hand assembly with the composer; this contract stays law.

---

*End of jungle scene contract.*
