# Durable jobs — kill-mid bar (2026-09-14 ET)

**Box:** `/workspace/project` (Bill)  
**Goal:** brief → enqueue → poll → ready survives kill-mid-job (status `failed`, never corrupt published/`ready`).

## What landed

| Piece | Path | Role |
|---|---|---|
| Job store | `tools/forge-run/job-store.mjs` | `.anvil/jobs/<id>.json`; claim; reconcile; quarantine |
| Enqueue | `tools/forge-run/enqueue.mjs` | Creates `queued`, returns `jobId` immediately |
| Worker | `tools/forge-run/worker.mjs` | One job at a time; `--once` / `--loop` / `--reconcile-only` (`forge:doctor`) |
| Execute | `tools/forge-run/execute-asset.mjs` | Shared forge path (kind / existing-glb / fake-long) + ship gates |
| Sync CLI | `tools/forge-run/run-asset.mjs` | Still sync for local smokes; agents prefer enqueue |
| MCP | `src/lib/mcp/tools.ts` `forge_run_asset` | Calls enqueue + `--kick-worker` |
| Smoke | `tools/forge-run/smoke-kill-mid.mjs` | Kill mid-building → reconcile → assert |

npm scripts: `forge:enqueue`, `forge:worker`, `forge:doctor`, `forge:smoke:kill-mid`.

## Smoke commands

```bash
# Automated kill-mid proof
npm run forge:smoke:kill-mid
# or:
node tools/forge-run/smoke-kill-mid.mjs

# Manual sequence
node tools/forge-run/enqueue.mjs --fake-long --sleep-ms 60000 --json
# note jobId from JSON

node tools/forge-run/worker.mjs --once &
WORKER_PID=$!
# wait until: node tools/forge-run/status.mjs <jobId>  → building
kill -9 $WORKER_PID

node tools/forge-run/worker.mjs --reconcile-only --json
# expect: status failed, hardFail worker_interrupted
# half-written exports/forge/<jobId>/ moved under exports/forge/_quarantine/
# index must not show that mesh as ready

# Real enqueue (Blender) — returns immediately; poll until published/failed
node tools/forge-run/enqueue.mjs --kind lantern --kick-worker --json
node tools/forge-run/status.mjs <jobId> --json
```

## Smoke result (this session)

```json
{
  "ok": true,
  "jobId": "job_20260914121737_b815d1",
  "jobStatus": "failed",
  "hardFail": "worker_interrupted",
  "validationHardFails": ["worker_interrupted"],
  "quarantine": "exports/forge/_quarantine/job_20260914121737_b815d1_1789388258524",
  "artifactDirPresent": false,
  "indexReadyHit": false
}
```

Also re-ran `node tools/forge-run/smoke-mesh-jail.mjs` → ok (no mesh-jail regression). `tsc --noEmit` clean.

## Agent path

1. `forge_run_asset` → `{ ok, jobId, status: "queued" }` immediately  
2. Poll `forge_job_status` until `published` or `failed`  
3. Ready only after validate + Godot ship gate (unchanged fail-closed)  
4. Worker crash / kill mid `building|baking|validating` → next worker start or `forge:doctor` marks `failed` + `worker_interrupted` and quarantines `exports/forge/<jobId>/`

## Still stubbed / out of scope

- Multi-worker / Redis / broker (single local worker only)
- Job retries, timeouts, lease heartbeats beyond pid liveness
- Scene jobs (`forge_scene`) still sync compose runner (not on this durable worker yet)
- Bundled `public/downloads/anvil-mcp-server.mjs` not regenerated in this change (HTTP MCP uses `src/lib/mcp`)
- Idempotent payload-hash reuse / `--force` rebuild policy

## Tip context

Prior tip included Quinn `23224ed`, Nova `f5b2d76`, Reed compose nit already on main as Bill `cddfd94`.
