# Anvil overnight status

## As of now — 2026-09-06 ~22:45 ET

Scope: /workspace/project only. Baseline 2.9.0.

### Phase 0 leftovers (this session)

- README Status pointer to docs/DESIGN-AND-ROADMAP.md and docs/OVERNIGHT-STATUS.md
- tools/forge-index/build.mjs runs godot_prod validate per GLB; sets ready true/false and status ready|failed (--skip-validate keeps indexed-only)
- Fail-closed fixtures under tools/validate/fixtures (malformed-not-glb.glb, no-collision-minimal.glb) + expect-fail.mjs harness
- tools/validate/run.mjs exports validateGodotProd for the index builder

### Phase 1 scaffold (no Blender required)

- Job model: src/lib/jobs/ (TS types/store) + tools/forge-run/job-store.mjs
- Persist under .anvil/jobs/*.json
- Stages: queued | building | baking | validating | published | failed
- CLI: tools/forge-run/status.mjs, list.mjs, run-asset.mjs (--file/--mesh)
- run-asset validates existing exports GLB, simulates build/bake when blender missing, rebuilds index
- MCP tools: forge_run_asset, forge_job_status (blender_execute remains non-executing on HTTP)

### Phase 2 prep

- docs/schemas/weapon-graph.schema.json — M4-class WeaponGraph (parts, sockets, clips, materials, pivot, constraints) + example

### Still open vs Phase 0/1 exit

- Batch forge CLI for N catalog kinds (real Blender)
- Two-light proof automation
- 10 kinds batch-forged + godot-check green (Godot not installed here)
- Real Blender invoke in run-asset (TODO when binary present)

### Checks this session

- Typecheck (tsc --noEmit)
- Protocol test (stdio MCP)
- check:fast (typecheck + validate forge + fixtures harness)
- Local git commit (no remote)

---

## Earlier — Phase 0 foundation (2026-09-06 22:28 ET)

Done: artifact gates, forge-index, version align, REVIEW banner, reports.
Gate results: PASS 5/5 on exports/forge (helm, chest, lantern, hoverbike, ammo can).
Limits then: GLB JSON heuristics only; no batch forge CLI; no 2-light proof; index lacked ready.
