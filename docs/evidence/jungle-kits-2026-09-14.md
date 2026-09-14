# Jungle biome kits ≥12 — Mon Sep 14, 2026 (ET) — Bill

**Box:** `/workspace/project`  
**After:** `forge_weapon` CLOSED (`376103d` grip Empty / no GLB inject).

## Inventory (before → after)

| | Count |
|---|---|
| SceneSpec kitRefs (`jungle-clearing.scene.json`) | **13** |
| Catalog jungle kinds (before) | **0** |
| GLBs under `exports/forge/biome/jungle/` (before) | **0** (empty dir) |
| Compose `kitNotes` missing (before) | **13/13** |
| Catalog + part-kit kinds (after) | **13** |
| Smoke GLBs forged (after, no bake) | **13/13 present** |
| Compose resolve (after) | **13 present / 0 missing** → `kits_present` |
| Indexed `ready` | **0** (honest: `pbr_textures_resolve` hardFail without `--bake`) |

## What landed

- `docs/schemas/biome-kit.schema.json` + `docs/schemas/examples/jungle.biome-kits.json`
- Addon family `public/downloads/anvil_blender_addon/kit/jungle.py` (13 KINDS)
- Catalog/types/spec/builders: `environments` category + `jungle_*` kinds
- `tools/forge-run/forge-biome.mjs` + `npm run forge:biome:jungle{,:smoke}`
- Compose honesty: `kits_present` when GLBs exist; report writes `kits_resolve`
- Docs: `docs/scenes/JUNGLE-KITS.md`, RUN-ON-YOUR-MACHINE bake commands

## Smoke command + result

```bash
ANVIL_KIT_DIR=$PWD/public/downloads npm run forge:biome:jungle
# → present=13/13, buildSource=part kit each, jobStatus=failed (pbr_textures_resolve, expected without bake)
npm run scene:compose
# → status=kits_present, kits_resolve=true
```

Evidence JSON: `docs/evidence/jungle-kits-forge-2026-09-14.json`

## Stubbed / not claimed

- No fake ready GLBs; no mega-mesh
- Bake+Godot `ready` index not claimed (Remy PBR gate)
- Studio viewport uses simple `junglePiece` stub meshes; Blender kit is SoT
- `forge_scene` publish still requires Godot open of instanced kits
