# Quinn HOLD — jungle trio handoff (2026-09-14)

Kevin bakes on his machine (G-Transfer). Box does **not** bake these.

## Authoring delta (pushed)

- `fallen_log_a`: collision `capsule` → `convex` (capsule made ~2.8×2.8 XZ pad around ~0.43m log)
- `tree_root_a`: root ball/arms raised toward spec height ~0.70m
- `shrub_a`: crown/clumps expanded toward footprint ~1.4×1.4m

Files: `public/downloads/anvil_blender_addon/kit/jungle.py`, `docs/schemas/examples/jungle.biome-kits.json`, `src/lib/assets/catalog.ts`

## Bake (Kevin)

```bash
git pull
export ANVIL_BLENDER=/path/to/blender
export ANVIL_GODOT=/path/to/godot
export ANVIL_KIT_DIR="$PWD/public/downloads"

node tools/forge-run/forge-biome.mjs --piece fallen_log_a --bake --json
node tools/forge-run/forge-biome.mjs --piece tree_root_a --bake --json
node tools/forge-run/forge-biome.mjs --piece shrub_a --bake --json

# optional: reindex / validate
node tools/validate/run.mjs exports/forge/biome/jungle/fallen_log_a.glb exports/forge/biome/jungle/tree_root_a.glb exports/forge/biome/jungle/shrub_a.glb --json
```

GLBs stay gitignored. After bake, ping Bill with measured AABB / col extents (or push evidence numbers) so Quinn can re-clear.
