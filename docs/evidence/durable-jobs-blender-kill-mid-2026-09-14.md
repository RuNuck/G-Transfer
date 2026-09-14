# Durable jobs — Blender kill-mid bar (2026-09-14 ET)

**Box:** `/workspace/project` (Bill)  
**Vale context:** `6ccaea0` fake-long-only smoke was VETO'd — need kill during a real `--kind` Blender forge (Blender in the process tree), not sleep.

## What changed

| Piece | Change |
|---|---|
| `tools/forge-run/execute-asset.mjs` | Headless Blender via async `spawn`; records `job.worker.blenderPid` on spawn; stays `building` until Blender live; advances `baking` once bake spawn is live |
| `tools/forge-run/worker.mjs` / `run-asset.mjs` | `await executeAssetJob` |
| `tools/forge-run/smoke-kill-mid.mjs` | `--blender` / `--kind` / `--bake` path + keep `--fake-long` unit |
| npm | `forge:smoke:kill-mid:blender`, `forge:smoke:kill-mid:fake`; bare `forge:smoke:kill-mid` defaults to blender in the script |

## Smoke command (Vale bar)

```bash
export PATH="$HOME/.local/bin:$PATH"
npm run forge:smoke:kill-mid:blender
# equivalent:
node tools/forge-run/smoke-kill-mid.mjs --blender
# or explicit:
node tools/forge-run/smoke-kill-mid.mjs --kind lantern --bake
```

Also kept: `npm run forge:smoke:kill-mid:fake` (sleep unit only — not sufficient alone for Vale).

## Smoke result (this session)

```json
{
  "ok": true,
  "mode": "blender",
  "kind": "lantern",
  "bake": true,
  "jobId": "job_20260914122454_b77461",
  "workerPid": 388171,
  "blenderPid": 388182,
  "blenderSeenVia": "job.worker.blenderPid",
  "blenderPath": "/home/box/tools/blender-5.2.1-linux-x64/blender",
  "stageAtKill": "baking",
  "jobStatus": "failed",
  "hardFail": "worker_interrupted",
  "validationHardFails": ["worker_interrupted"],
  "quarantine": "exports/forge/_quarantine/job_20260914122454_b77461_1789388695469",
  "artifactDirPresent": false,
  "indexReadyHit": false,
  "publishedReadyBefore": {
    "id": "forge-smoke.oil_lantern",
    "status": "ready",
    "ready": true,
    "file": "forge-smoke/oil_lantern.glb"
  },
  "publishedReadyAfter": {
    "id": "forge-smoke.oil_lantern",
    "status": "ready",
    "ready": true,
    "file": "forge-smoke/oil_lantern.glb"
  },
  "publishedStillReady": true,
  "rePoll": {
    "load1": "failed",
    "load2": "failed",
    "statusCli": "failed",
    "hardFail": "worker_interrupted"
  },
  "reconcile": {
    "ok": true,
    "action": "reconcile",
    "interruptedFailed": 1,
    "results": [
      {
        "id": "job_20260914122454_b77461",
        "action": "failed_worker_interrupted",
        "previousStatus": "baking",
        "quarantine": {
          "quarantined": true,
          "from": "exports/forge/job_20260914122454_b77461",
          "to": "exports/forge/_quarantine/job_20260914122454_b77461_1789388695469"
        },
        "hardFail": "worker_interrupted"
      }
    ]
  },
  "baselineRestored": false
}
```

### Gates proven

1. Job ends `failed` with `hardFail: worker_interrupted`
2. Half-written forge dir quarantined under `exports/forge/_quarantine/`; no ready hit in index for that jobId
3. `forge-smoke.oil_lantern` stayed `ready` (was ready before)
4. Re-poll (`loadJob` ×2 + `status.mjs`) stayed `failed` / `worker_interrupted`
5. Kill happened with real Blender PID `388182` in-tree (`job.worker.blenderPid`), stage `baking`

### Non-regression

- `npm run forge:smoke:kill-mid:fake` → ok
- `node tools/forge-run/smoke-mesh-jail.mjs` → ok
- `tsc --noEmit` clean

## Leftover Vale / follow-ups

- Fake-long alone remains insufficient for the durable-jobs clear — blender smoke is the bar.
- Multi-worker / lease heartbeats / retries still out of scope (single local worker).
- `forge_scene` still sync (not on this durable worker).
- Bare `npm run forge:smoke:kill-mid` now defaults to `--blender` inside the script (needs Blender on PATH / `ANVIL_BLENDER`).
