# Jungle lighting pass — Mon Sep 14, 2026 (ET) — Bill

**Box:** `/workspace/project`  
**Parent snap:** playable-jungle instance `4b4ef3e` (157 PackedScene kits, 0 placeholders). **Not a kit-exit reopen.**  
**Job:** `job_20260914140417_5385fb` · published 10:04 AM ET

## Goal

Replace helper identity-transform `DirectionalLight3D`s and empty `WorldEnvironment` with a production-leaning authored Godot lighting setup matching SceneSpec `layers.lighting` (overcast + god_rays).

## Before → after (jungle-clearing fixture)

| Node / property | Before (helper) | After (authored) |
|---|---|---|
| `WorldEnvironment` | empty node, no `environment` | `ProceduralSkyMaterial` + `Sky` + `Environment` (BG_SKY, ambient-from-sky, ACES, SSAO, glow, height fog, volumetric fog) |
| `Lighting_overcast` | 1× `Sun` DirectionalLight, identity rotation, energy 0.85, position-only | **Key / Fill / Rim** oriented to elev 55° / az 140°; Key shadows + soft angular 2.5°; Fill canopy-bounce; Rim warm edge |
| `Lighting_god_rays` | 1× `Sun` identity rotation, energy 1.4 | **Key + Fill**; Key warm 1.4, shadows, `light_volumetric_fog_energy=1.8`; group `visible = false` (default is overcast — no double-sun) |
| `project.godot` | no renderer | `renderer/rendering_method="forward_plus"` (volumetric fog) |
| PackedScene kits | 157 | **157** (unchanged) |
| `anvil_placeholder` | 0 | **0** |
| contentHash | `sha256:a41170cbe0…a41b` | **same** (instance list not touched) |
| Lightmaps / GI bake | none | **none** — authored realtime environment only |

## Smoke

```bash
export ANVIL_GODOT=/home/box/tools/godot-4.7.2/Godot_v4.7.2-stable_linux.x86_64
npm run forge:scene -- --spec docs/schemas/examples/jungle-clearing.scene.json --json
```

Result: `status=published` · `shipGate=ready` · `packedSceneInstances=157` · `placeholderInstances=0`  
`godotScene.note`: `ANVIL_SCENE_OK res://scene.tscn root=Node3D name=Jungle_clearing_with_river_and_dirt_path`  
`validation.json` `godot_import.ok=true` (rewritten on finish).

## Honesty

- Still **not** AAA product / board exit.
- Lighting is **authored environment setup** (ProceduralSky + DirectionalLights + volumetric fog), **not** baked lightmaps, light probes, or GI.
- Kit instances remain real PackedScenes; this pass did not reopen kit exit.

## Quinn should re-check (gameplay lights)

1. Open `exports/scenes/scene_jungle_clearing_01/` in Godot 4.x editor (Forward+).
2. Confirm WorldEnvironment shows a sky (not a black/empty env).
3. **Overcast** (default, visible): soft high sun + green fill + rim; materials should read as PBR albedo (not pre-lit).
4. Toggle **Lighting_god_rays** visible and hide **Lighting_overcast**: warmer low sun, tighter shadows, volumetric shafts through canopy gaps.
5. Confirm 157 kit instances still resolve; 0 `anvil_placeholder`.
6. Do **not** treat this as baked GI or product exit. Vale/Reed/Ori re-clear as needed on this lighting delta only.

## Code / docs

- `tools/scene-compose/compose.mjs` — environment subresources + oriented light rigs
- `docs/AGENT-GUIDE.md` / `docs/scenes/JUNGLE-CONTRACT.md` / `docs/scenes/JUNGLE-KITS.md` — helper lights replaced
