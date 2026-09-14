# forge_weapon M4 smoke — 2026-09-14 ET

**Box:** `/workspace/project` (Bill)  
**When:** 9/14/2026, 8:28:40 AM ET  
**Job:** `job_20260914122819_b9a02a`

## Goal

Agent cold path: `forge_weapon` preset `m4_carbine` → `jobId` → poll `forge_job_status` → ready GLB (~0.84 m, grip pivot, convcol, clips, Godot import ok).

## Commands

```bash
node tools/forge-run/enqueue-weapon.mjs --preset m4_carbine --bake --json
node tools/forge-run/worker.mjs --once --json
# or:
npm run forge:smoke:weapon-m4
```

## Result

```json
{
  "ok": true,
  "smokeOk": true,
  "jobId": "job_20260914122819_b9a02a",
  "enqueue": {
    "ok": true,
    "enqueued": true,
    "jobId": "job_20260914122819_b9a02a",
    "status": "queued",
    "type": "weapon",
    "preset": "m4_carbine",
    "paths": {
      "weaponGraph": ".anvil/weapon-graphs/enq_1789388899774.weapon.json",
      "artifactDir": "exports/forge/job_20260914122819_b9a02a"
    },
    "workerKicked": false,
    "workerPid": null,
    "poll": "node tools/forge-run/status.mjs job_20260914122819_b9a02a --json"
  },
  "workerExit": 0,
  "worker": {
    "ok": true,
    "workerPid": 391636,
    "reconciled": [],
    "processed": true,
    "jobId": "job_20260914122819_b9a02a",
    "status": "published",
    "type": "weapon",
    "hardFail": null,
    "paths": {
      "weaponGraph": "exports/forge/job_20260914122819_b9a02a/weapon.graph.json",
      "artifactDir": "exports/forge/job_20260914122819_b9a02a",
      "buildScript": "tools/blender-check/out/gen/weapon_m4_carbine_godot.py",
      "bakeScript": "tools/blender-check/out/gen/weapon_m4_carbine_godot.bake.py",
      "mesh": "exports/forge/job_20260914122819_b9a02a/m4_carbine.glb",
      "textures": "exports/forge/job_20260914122819_b9a02a/textures",
      "index": "exports/index.json",
      "indexStatus": "ready"
    }
  },
  "jobStatus": "published",
  "shipGate": "ready",
  "hardFail": null,
  "honesty": "kit_carbine_via_rifle_family",
  "buildSource": "part kit",
  "mesh": "exports/forge/job_20260914122819_b9a02a/m4_carbine.glb",
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
        }
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
    "claimed by worker pid 391636",
    "forge path: rifle kit → m4_carbine.glb @ 0.84m (kit carbine, not CAD M4 parts)",
    "weapon Blender build: /home/box/tools/blender-5.2.1-linux-x64/blender",
    "weapon bake (pid 391647): /workspace/project/tools/blender-check/out/gen/weapon_m4_carbine_godot.bake.py",
    "injected grip pivot node @ [0, -0.02, 0.01]",
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
| Durable enqueue `type=weapon` | **Real** — `.anvil/jobs/<id>.json` queued → worker claim |
| MCP `forge_weapon` | **Real** — calls enqueue-weapon + `--kick-worker` |
| WeaponGraph preset `m4_carbine` | **Real** — example JSON + `check:weapon-graph` |
| Mesh forge | **Real** — parametric rifle-family kit sized to `overallLengthM` (kit carbine; **not** CAD-accurate M4 parts) |
| Clips / rig | `ANVIL_RIG=1` + kit demo actions; gated when graph claims clips |
| Validate + Godot ship gate | Fail closed (same as asset forge; never published+ok without Godot import when Godot present) |
| Kill-mid queue | Unchanged (shared single-worker claim / reconcile / quarantine) |
| CAD-accurate M4 part kit | **Stubbed / out of scope** — WeaponGraph parts/sockets drive validation intent; mesh is rifle kit assembly |

## GLB

- `exports/forge/job_20260914122819_b9a02a/m4_carbine.glb`

## Agent path

1. `forge_weapon({ preset: "m4_carbine" })` → `{ jobId, status: "queued" }`
2. Poll `forge_job_status` until `published` or `failed`
3. Ready only after weapon gates + Godot import ok
