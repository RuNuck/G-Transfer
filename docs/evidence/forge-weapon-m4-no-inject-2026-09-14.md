# forge_weapon M4 — no post-export grip inject — 2026-09-14 ET

**Box:** `/workspace/project` (Bill)  
**When:** 9/14/2026, 8:39:26 AM ET  
**Job:** `job_20260914123843_4bd62b`  
**Commit target:** Vale (no inject) + Quinn (intentional pistol-grip placement)

## Goal

Kit/Blender **emits** a `grip` Empty at the real pistol-grip (trigger/mag region). Finish path must **not** patch the GLB via `ensureGripPivotInGlb`. Gates: published + Godot ok + meters ~0.84 + grip present with Quinn placement + clips + convcol.

## Commands

```bash
npm run forge:smoke:weapon-m4
# or:
node tools/forge-run/enqueue-weapon.mjs --preset m4_carbine --bake --json
node tools/forge-run/worker.mjs --once --json
```

## Inject removed (Vale)

```bash
rg ensureGripPivotInGlb tools src public/downloads/anvil_blender_addon
# → no matches
test ! -f tools/forge-run/ensure-grip-pivot.mjs && echo FILE_GONE
```

- `tools/forge-run/ensure-grip-pivot.mjs` **deleted**
- `execute-weapon.mjs` no longer imports or calls inject
- Job notes contain **`grip pivot: kit/Blender Empty emit (no post-export GLB inject)`** — do **not** say "injected grip"

## Grip origin (Quinn)

| Source | Detail |
|---|---|
| Kit family | `public/downloads/anvil_blender_addon/kit/rifle.py` → `finishing["sockets"]` palm on pistol-grip (`grip_x`, `z_bore - H*0.36`) |
| Blender emit | `src/lib/assets/blender-script.ts` `make_sockets()` → Empty parented after re-pivot; bake re-export includes `EMPTY` |
| Finish path | note only — **no** GLB byte patch |

### Placement vs inject scaffold

| | Inject (VETO'd) | This GLB |
|---|---|---|
| Local/world (glTF Y-up) | `[0, -0.02, 0.01]` | `[-0.12835198640823364, -0.05241600051522255, 0]` |
| Distance from origin | ~0.022 m | **0.1386 m** |
| AABB frac (min→max) | ~(0.50, 0.41, 0.64) mid-receiver | **[0.347, 0.26, 0.5]** lower-rear |
| Near trigger/mag bones | no (origin) | grip≈trigger/mag cluster (trigger ~[-0.087,-0.043,0], mag ~[-0.048,-0.046,0]) |
| `placementOk` | would FAIL new gate | **True** |

Mesh AABB (centered): size ≈ [0.8401352167129517, 0.21844924241304398, 0.0714000016450882] m (length **0.8401352167129517** vs overallLengthM 0.84).

## Smoke result

- **status:** `published` · **shipGate:** `ready` · **buildSource:** `part kit`
- **mesh:** `exports/forge/job_20260914123843_4bd62b/m4_carbine.glb`
- **weaponGates.ok:** True
- **clips:** cock_back, trigger_pull, magazine_release, selector_toggle, stock_collapse
- **collision:** `m4_carbine_col-convcolonly`
- Job notes (no inject wording):

```json
[
  "weapon enqueue source=preset:m4_carbine preset=m4_carbine lengthM=0.84",
  "claimed by worker pid 402554",
  "forge path: rifle kit \u2192 m4_carbine.glb @ 0.84m (kit carbine, not CAD M4 parts)",
  "weapon Blender build: /home/box/tools/blender-5.2.1-linux-x64/blender",
  "weapon bake (pid 402568): /workspace/project/tools/blender-check/out/gen/weapon_m4_carbine_godot.bake.py",
  "grip pivot: kit/Blender Empty emit (no post-export GLB inject)",
  "weapon artifact gates (meters/pivot/collision/clips)",
  "running tools/validate godot_prod",
  "running tools/godot-check (ship gate)",
  "validated + godot import ok + index ready"
]
```

## Full smoke payload

```json
{
  "ok": true,
  "smokeOk": true,
  "jobId": "job_20260914123843_4bd62b",
  "enqueue": {
    "ok": true,
    "enqueued": true,
    "jobId": "job_20260914123843_4bd62b",
    "status": "queued",
    "type": "weapon",
    "preset": "m4_carbine",
    "paths": {
      "weaponGraph": ".anvil/weapon-graphs/enq_1789389523917.weapon.json",
      "artifactDir": "exports/forge/job_20260914123843_4bd62b"
    },
    "workerKicked": false,
    "workerPid": null,
    "poll": "node tools/forge-run/status.mjs job_20260914123843_4bd62b --json"
  },
  "workerExit": 0,
  "worker": {
    "ok": true,
    "workerPid": 402554,
    "reconciled": [],
    "processed": true,
    "jobId": "job_20260914123843_4bd62b",
    "status": "published",
    "type": "weapon",
    "hardFail": null,
    "paths": {
      "weaponGraph": "exports/forge/job_20260914123843_4bd62b/weapon.graph.json",
      "artifactDir": "exports/forge/job_20260914123843_4bd62b",
      "buildScript": "tools/blender-check/out/gen/weapon_m4_carbine_godot.py",
      "bakeScript": "tools/blender-check/out/gen/weapon_m4_carbine_godot.bake.py",
      "mesh": "exports/forge/job_20260914123843_4bd62b/m4_carbine.glb",
      "textures": "exports/forge/job_20260914123843_4bd62b/textures",
      "index": "exports/index.json",
      "indexStatus": "ready"
    }
  },
  "jobStatus": "published",
  "shipGate": "ready",
  "hardFail": null,
  "honesty": "kit_carbine_via_rifle_family",
  "buildSource": "part kit",
  "mesh": "exports/forge/job_20260914123843_4bd62b/m4_carbine.glb",
  "meshExists": true,
  "weaponGates": {
    "ok": true,
    "hardFails": [],
    "details": {
      "meters": {
        "overallLengthM": 0.84,
        "aabbMaxM": 0.8401352167129517,
        "aabb": [
          0.8401352167129517,
          0.21844924241304398,
          0.0714000016450882
        ],
        "toleranceM": 0.168,
        "ok": true
      },
      "pivot": {
        "gripNode": "grip",
        "rootNearOrigin": null,
        "gripTranslation": [
          -0.12835198640823364,
          -0.05241600051522255,
          0
        ],
        "gripWorld": [
          -0.12835198640823364,
          -0.05241600051522255,
          0
        ],
        "gripDistOriginM": 0.13864223571823706,
        "gripAabbFrac": [
          0.34714411999037964,
          0.26016680354249816,
          0.5
        ],
        "placementOk": true,
        "ok": true,
        "claimed": {
          "kind": "grip",
          "part": "grip",
          "localTranslation": [
            0,
            -0.02,
            0.01
          ],
          "toleranceM": 0.02
        },
        "note": "kit/Blender Empty at pistol-grip (trigger/mag region)"
      },
      "collision": {
        "ok": true,
        "style": "godot_convcolonly",
        "nodes": [
          "m4_carbine_col-convcolonly"
        ]
      },
      "clips": {
        "claimed": [
          "cock_back",
          "trigger_pull",
          "magazine_release",
          "selector_toggle",
          "stock_collapse"
        ],
        "present": [
          "cock_back",
          "trigger_pull",
          "magazine_release",
          "selector_toggle",
          "stock_collapse"
        ],
        "ok": true
      }
    }
  },
  "validationHardFails": [],
  "notes": [
    "weapon enqueue source=preset:m4_carbine preset=m4_carbine lengthM=0.84",
    "claimed by worker pid 402554",
    "forge path: rifle kit \u2192 m4_carbine.glb @ 0.84m (kit carbine, not CAD M4 parts)",
    "weapon Blender build: /home/box/tools/blender-5.2.1-linux-x64/blender",
    "weapon bake (pid 402568): /workspace/project/tools/blender-check/out/gen/weapon_m4_carbine_godot.bake.py",
    "grip pivot: kit/Blender Empty emit (no post-export GLB inject)",
    "weapon artifact gates (meters/pivot/collision/clips)",
    "running tools/validate godot_prod",
    "running tools/godot-check (ship gate)",
    "validated + godot import ok + index ready"
  ]
}
```

## Real vs stubbed

| Piece | Status |
|---|---|
| Grip Empty | **Real** — rifle kit socket + Blender Empty emit |
| Post-export GLB inject | **Removed** |
| Mesh | kit carbine via rifle family (not CAD M4) |
| Kill-mid / lantern | Untouched |
