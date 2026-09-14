# Jungle biome kits (Phase 3 MVP)

**Target:** ≥12 pieces for `scene.jungle.clearing_01` (Kevin north star: clearing with trees/rivers via kits, not mega-mesh).

**Manifest:** `docs/schemas/examples/jungle.biome-kits.json`  
**Schema:** `docs/schemas/biome-kit.schema.json`  
**Part kit:** `public/downloads/anvil_blender_addon/kit/jungle.py`  
**Expected GLB root:** `exports/forge/biome/jungle/<piece>.glb` (gitignored)

## Piece list (13)

| Layer | kitId | kind | Role |
|---|---|---|---|
| ground | `biome.jungle.terrain_tile_mud` | `jungle_terrain_tile_mud` | terrain_tile |
| ground | `biome.jungle.path_dirt_a` | `jungle_path_dirt_a` | path_dirt |
| canopy | `biome.jungle.tree_trunk_a` | `jungle_tree_trunk_a` | tree_trunk |
| canopy | `biome.jungle.tree_trunk_b` | `jungle_tree_trunk_b` | tree_trunk |
| canopy | `biome.jungle.tree_canopy_a` | `jungle_tree_canopy_a` | tree_canopy |
| canopy | `biome.jungle.tree_root_a` | `jungle_tree_root_a` | tree_root |
| undergrowth | `biome.jungle.fern_card_a` | `jungle_fern_card_a` | understory |
| undergrowth | `biome.jungle.shrub_a` | `jungle_shrub_a` | understory |
| undergrowth | `biome.jungle.mud_decal_a` | `jungle_mud_decal_a` | mud_decal |
| water | `biome.jungle.river_bank_a` | `jungle_river_bank_a` | river_bank |
| water | `biome.jungle.water_plane_a` | `jungle_water_plane_a` | water_plane |
| rocks | `biome.jungle.rock_scatter_a` | `jungle_rock_scatter_a` | rock_scatter |
| landmarks | `biome.jungle.fallen_log_a` | `jungle_fallen_log_a` | fallen_log |

## Honesty labels

| Label | Meaning |
|---|---|
| **pending** | Definition only; no GLB |
| **smoke** | Real Blender part-kit GLB on disk; **not** indexed `ready` (no bake / PBR maps yet) |
| **stub** | Explicit STUB definition — never claim ready |
| **ready** | Indexed `shipGate`/`status` ready: validated + baked + Godot import ok on this box |

**Current (2026-09-14):** all **13/13** `biome.jungle.*` pieces are **ready** on G-Transfer evidence (`6293905`+). Compose + `forge_scene` jungle example published/Godot-open. Phase (3) **product exit** still needs specialist clears (Quinn TA / Reed / Vale / Ori) — that is board exit, not index honesty. Ops (Remy/Nova) bars are separate from shipGate ready.

## Texel density (Quinn)

Jungle env pieces intentionally target **~256 px/m** at typical bake (kit budget), not the generic env ~512 mid-prop bar. Document as kit-tier TD; raise later if Remy/Quinn want denser ground. Trunk canopy pieces may read thinner/flatter than ground tiles — style consistency check on the full set.

Unbaked / build-only CLI runs still produce **smoke** GLBs — those must not be indexed ready. Prefer `--bake` (or MCP `forge_run_asset` with `bake: true`) before claiming ready.

## Forge

```bash
export ANVIL_BLENDER=/path/to/blender
export ANVIL_GODOT=/path/to/godot
export ANVIL_KIT_DIR="$PWD/public/downloads"

# All 13 build-only (~15s on Bill’s box)
npm run forge:biome:jungle

# First 3 smoke
npm run forge:biome:jungle:smoke

# One piece
node tools/forge-run/forge-biome.mjs --piece rock_scatter_a --json

# Long bake (Kevin / G-Transfer machine)
node tools/forge-run/forge-biome.mjs --all --bake --json
```

Then:

```bash
npm run scene:compose
# Expect kits_present, kits_resolve true, 13/13 present
```

See `docs/RUN-ON-YOUR-MACHINE.md` for bake wall-time notes.
