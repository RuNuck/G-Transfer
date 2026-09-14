# Run long Anvil jobs on your machine

Handoff repo: https://github.com/RuNuck/G-Transfer (`main`).

Generated GLBs/PNGs are gitignored — clone, `npm install`, then forge locally. Point env at **your** Blender 4.2+ / Godot 4.x (Windows paths are fine).

```bat
set ANVIL_BLENDER=C:\Path\To\blender.exe
set ANVIL_GODOT=C:\Path\To\Godot.exe
set ANVIL_KIT_DIR=%CD%\public\downloads
```

```bash
export ANVIL_BLENDER=/path/to/blender
export ANVIL_GODOT=/path/to/godot
export ANVIL_KIT_DIR="$PWD/public/downloads"
npm install
```

## Long jobs (these are what stall Bill’s box)

| Command | What / wall |
|---|---|
| `npm run dcc:smoke:bake` | Lantern part-kit + bake (~40s+ CPU) |
| `npm run forge:enqueue -- --kind lantern --bake --kick-worker --json` | Durable enqueue + worker forge |
| `npm run forge:worker -- --once` | Drain one queued job |
| `npm run forge:smoke:kill-mid` | Fake-long kill-mid (queue reconcile only) |

After a bake/forge:

```bash
npm run validate -- exports/forge-smoke --json
node tools/godot-check/check-import.mjs exports/forge-smoke/oil_lantern.glb
```

`forge_scene` is still **sync** (not a durable queue). `forge_weapon` / real Blender kill-mid smoke are in flight — pull `main` again before those land.

Do **not** treat Plan / spec-only as ready. Kill-mid must leave jobs `failed`, never corrupt `ready`.

## Jungle biome kits (Phase 3 — long forges)

Definitions live in-repo (`docs/schemas/examples/jungle.biome-kits.json`, addon `kit/jungle.py`). GLBs are gitignored — forge locally.

```bash
export ANVIL_BLENDER=/path/to/blender   # 4.2+ / 5.x
export ANVIL_GODOT=/path/to/godot
export ANVIL_KIT_DIR="$PWD/public/downloads"

# Build-only all 13 (~15s CPU on a warm box; no PBR maps)
npm run forge:biome:jungle

# First 3 smoke
npm run forge:biome:jungle:smoke

# Full bake all 13 (wall time: minutes — this is what stalls Bill’s overnight box)
node tools/forge-run/forge-biome.mjs --all --bake --json

# Or durable enqueue per kind:
npm run forge:enqueue -- --kind jungle_rock_scatter_a --bake --kick-worker --json
```

After forge:

```bash
npm run scene:compose
# Expect status kits_present, 13/13 kitNotes present (not ship-ready without bake+Godot)
```

Honesty: smoke GLBs make compose resolve; they are **not** indexed `ready` until bake clears PBR gates. Never claim a fused `jungle.glb`.

