# Jungle kits — first-3 smoke WITH bake — Mon Sep 14, 2026 (ET) — Bill

**Tip:** `440be4b`  
**Box:** `/workspace/project`  
**Scope:** first 3 manifest pieces only — **not** claiming full ≥12 ready.

## Commands

```bash
export ANVIL_KIT_DIR=/workspace/project/public/downloads
# ANVIL_BLENDER / ANVIL_GODOT already on box
# npm run forge:biome:jungle:smoke has --limit 3 --json but NOT --bake
node tools/forge-run/forge-biome.mjs \
  --manifest docs/schemas/examples/jungle.biome-kits.json \
  --all --limit 3 --bake --json

node tools/validate/run.mjs \
  exports/forge/biome/jungle/terrain_tile_mud.glb \
  exports/forge/biome/jungle/path_dirt_a.glb \
  exports/forge/biome/jungle/tree_trunk_a.glb

npm run forge:index
```

## Results (Quinn early style-check)

| piece | GLB path | bytes | AABB (m) | materials | shipGate | hardFails | job |
|---|---|---|---|---|---|---|---|
| terrain_tile_mud | `exports/forge/biome/jungle/terrain_tile_mud.glb` | 1 600 432 | 4.230×0.130×4.010 | mat_soil, mat_moss, mat_wet | **ready** | [] | job_20260914125127_1d559e |
| path_dirt_a | `exports/forge/biome/jungle/path_dirt_a.glb` | 1 182 348 | 2.210×0.090×4.010 | mat_soil, mat_moss, mat_wet | **ready** | [] | job_20260914125137_57cb02 |
| tree_trunk_a | `exports/forge/biome/jungle/tree_trunk_a.glb` | 1 023 584 | 0.745×7.370×0.745 | mat_bark, mat_moss, mat_wet_bark | **ready** | [] | job_20260914125147_79c8b7 |

- forge-biome: `bake=true`, `present=3/3`, `buildSource=part kit`, all `jobStatus=published`, hardFails=[]
- validate godot_prod: **3/3 PASS** (incl. `pbr_textures_resolve`)
- index after rebuild: these 3 entries `status=ready`, `ready=true`, Godot import ok
- PBR maps under `exports/forge/biome/jungle/textures/` (albedo/normal/orm per piece)
- Elapsed: ~10.8s / ~9.4s / ~18.1s (build+bake+validate+ship-gate)

## Not claimed

- Full biome ≥12 ready (only first-3 baked)
- Remaining 10 jungle GLBs still prior no-bake / not re-baked here
- No tooling code changes; no commit (GLBs gitignored)

JSON summary: `docs/evidence/jungle-kits-forge-2026-09-14.json` (overwritten by this bake smoke run).
