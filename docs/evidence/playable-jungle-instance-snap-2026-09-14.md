# Playable jungle instance snap — Mon Sep 14, 2026 (ET) — Bill

**Box:** `/workspace/project`  
**Bars:** Reed / Quinn / Vale / Ori (engineering land; **not** product exit)

## Goal

Compose must emit real kit GLB/PackedScene instances — **no** `anvil_placeholder` Node3Ds. Godot opens playable layout. Finish-path rewrites `validation.json` `godot_import` honestly. AGENT-GUIDE: kit exit ≠ scene/playable jungle until this lands.

## Before → after (jungle-clearing fixture)

| Metric | Before | After |
|---|---|---|
| `metadata/anvil_placeholder = true` | **157** | **0** |
| `instance=ExtResource(...)` | **0** | **157** |
| PackedScene `ext_resource` | 0 | **13** |
| `validation.json` `godot_import` | `ok: null` | `ok: true` (rewritten on forge_scene finish) |
| `forge_scene` status | (placeholders / not playable) | **published** · shipGate `ready` |

## Smoke commands

```bash
export ANVIL_GODOT=/home/box/tools/godot-4.7.2/Godot_v4.7.2-stable_linux.x86_64
npm run scene:compose -- --json
# → status=instanced, realInstances=157, placeholderInstances=0

npm run forge:scene -- --spec docs/schemas/examples/jungle-clearing.scene.json --json
# → job status=published, packedSceneInstances=157, placeholderInstances=0
# godotScene.note: ANVIL_SCENE_OK res://scene.tscn root=Node3D …
```

## Artifacts

- `exports/scenes/scene_jungle_clearing_01/scene.tscn` — ExtResource PackedScenes → `res://kits/*.glb`
- `exports/scenes/scene_jungle_clearing_01/kits/` — symlinks to forge biome GLBs (**gitignored**)
- `exports/scenes/scene_jungle_clearing_01/project.godot` — openable scene project
- `exports/scenes/scene_jungle_clearing_01/validation.json` — `godot_import.ok=true` after finish

## Code

- `tools/scene-compose/compose.mjs` — stage kits + emit PackedScene instances
- `tools/scene-compose/run-scene.mjs` — `real_instances` hardFail; rewrite `godot_import` on finish
- `tools/godot-check/check-scene.mjs` — copy sibling `kits/` into throwaway project
- `docs/AGENT-GUIDE.md` / `docs/scenes/JUNGLE-KITS.md` — kit exit ≠ playable jungle

## Still soft / not claimed

- **Product / board exit** still needs Reed/Quinn/Vale/Ori specialist re-clears — do not claim playable-jungle product exit from this land alone.
- Cold MCP HTTP `forge_scene` not re-probed this run (CLI twin `npm run forge:scene`); tool remains **sync**.
- Lighting setups remain DirectionalLight helpers (not kit meshes).
- Kit symlinks are absolute paths on this box; check-scene materializes file copies for headless open.

## Follow-on: relative kits/ (Reed nit)

Compose now `symlinkSync(relative(kitsDir, srcAbs), dest)` — no box-absolute targets. Recompose `npm run scene:compose` after `ad612f5`/this commit. Sample: `kits/fallen_log_a.glb -> ../../../forge/biome/jungle/fallen_log_a.glb`. Not a playable-jungle reopen.
