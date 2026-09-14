# Jungle kits — remaining 10 bake + full ≥12 shipGate — Mon Sep 14, 2026 (ET) — Bill

**Box:** `/workspace/project`  
**Scope:** bake remaining kits from `docs/schemas/examples/jungle.biome-kits.json` (all except first-3 already ready). Prefer skip already-ready via `--piece` (tool has no `--skip-ready`).

## Commands (Kevin)

```bash
cd /workspace/project
export ANVIL_KIT_DIR=/workspace/project/public/downloads
# ANVIL_BLENDER / ANVIL_GODOT already on box

# Prefer skip first-3 (already shipGate ready). Equivalent to --all --bake but avoids re-bake:
for p in tree_trunk_b tree_canopy_a tree_root_a fern_card_a shrub_a \
         river_bank_a water_plane_a rock_scatter_a fallen_log_a mud_decal_a; do
  node tools/forge-run/forge-biome.mjs \
    --manifest docs/schemas/examples/jungle.biome-kits.json \
    --piece "$p" --bake --json
done

# Or full remanifest (re-bakes first 3 too — ok):
# node tools/forge-run/forge-biome.mjs \
#   --manifest docs/schemas/examples/jungle.biome-kits.json --all --bake --json

node tools/validate/run.mjs --profile godot_prod exports/forge/biome/jungle --json
npm run forge:index
npm run scene:compose
```

## Counts

| gate | result |
|---|---|
| forge-biome remaining 10 | **10/10** present, `jobStatus=published`, `buildSource=part kit`, hardFails=[] |
| validate godot_prod (all jungle GLBs) | **13/13 PASS** (failed=0) |
| index jungle entries shipGate | **13 ready / 0 fail** |
| scene:compose `jungle-clearing` | **ok** `kits_present` · 157 instances · layoutOnly |
| overall index (all assets) | ready=19, validated_glb_only=11, blocked=0, failed=12 |

**≥12 shipGate ready: YES (13/13 jungle kits).** Not claiming full catalog exit (non-jungle failed=12 remain).

## Results (all 13)

| piece | GLB path | bytes | AABB (m) | materials | shipGate | hardFails | job |
|---|---|---|---|---|---|---|---|
| fallen_log_a | `exports/forge/biome/jungle/fallen_log_a.glb` | 124,084 | 2.81×0.427×2.81 | mat_bark, mat_moss, mat_wet_bark | **ready** | [] | job_20260914125517_d348fd |
| fern_card_a | `exports/forge/biome/jungle/fern_card_a.glb` | 152,924 | 0.91×1.01×0.142 | mat_foliage, mat_stem, mat_vein | **ready** | [] | job_20260914125446_5f2d6f |
| mud_decal_a | `exports/forge/biome/jungle/mud_decal_a.glb` | 320,272 | 1.61×0.04×1.61 | mat_soil, mat_moss, mat_wet | **ready** | [] | job_20260914125523_cc911a |
| path_dirt_a | `exports/forge/biome/jungle/path_dirt_a.glb` | 1,182,348 | 2.21×0.09×4.01 | mat_soil, mat_moss, mat_wet | **ready** | [] | job_20260914125137_57cb02 |
| river_bank_a | `exports/forge/biome/jungle/river_bank_a.glb` | 112,236 | 2.5×0.7×1.629 | mat_soil, mat_moss, mat_wet | **ready** | [] | job_20260914125457_cbb0e6 |
| rock_scatter_a | `exports/forge/biome/jungle/rock_scatter_a.glb` | 253,060 | 0.9×0.566×0.702 | mat_stone, mat_dirt, mat_wet_stone | **ready** | [] | job_20260914125511_f94687 |
| shrub_a | `exports/forge/biome/jungle/shrub_a.glb` | 262,548 | 1.157×1.078×1.157 | mat_foliage, mat_stem, mat_vein | **ready** | [] | job_20260914125452_520ada |
| terrain_tile_mud | `exports/forge/biome/jungle/terrain_tile_mud.glb` | 1,600,432 | 4.23×0.13×4.01 | mat_soil, mat_moss, mat_wet | **ready** | [] | job_20260914125127_1d559e |
| tree_canopy_a | `exports/forge/biome/jungle/tree_canopy_a.glb` | 1,163,892 | 4.674×2.32×4.6 | mat_foliage, mat_stem, mat_vein | **ready** | [] | job_20260914125430_c3ccf0 |
| tree_root_a | `exports/forge/biome/jungle/tree_root_a.glb` | 239,672 | 2.112×0.4×2.125 | mat_bark, mat_moss, mat_wet_bark | **ready** | [] | job_20260914125440_3e8caa |
| tree_trunk_a | `exports/forge/biome/jungle/tree_trunk_a.glb` | 1,023,584 | 0.745×7.37×0.745 | mat_bark, mat_moss, mat_wet_bark | **ready** | [] | job_20260914125147_79c8b7 |
| tree_trunk_b | `exports/forge/biome/jungle/tree_trunk_b.glb` | 1,356,612 | 0.587×5.99×0.587 | mat_bark, mat_moss, mat_wet_bark | **ready** | [] | job_20260914125412_cde2df |
| water_plane_a | `exports/forge/biome/jungle/water_plane_a.glb` | 722,012 | 4.01×0.07×4.01 | mat_water, mat_depth | **ready** | [] | job_20260914125503_5b8657 |

- First-3 left from prior bake smoke (`jungle-kits-smoke-bake-3-2026-09-14.md`): terrain_tile_mud, path_dirt_a, tree_trunk_a — not re-baked here.
- Remaining 10 baked this run (~5.2–18.0s each build+bake+validate+ship-gate).
- PBR maps: 39 PNGs under `exports/forge/biome/jungle/textures/` (albedo/normal/orm × 13).
- GLBs gitignored; compose resolves via file presence.

## Not claimed

- Full repo catalog exit (index still has failed=12 non-jungle)
- Scene Godot ship gate (`scene:compose` is kits layout only; `forge:scene` / run-scene owns Godot)
- Tooling code changes

JSON: `docs/evidence/jungle-kits-forge-2026-09-14.json`
