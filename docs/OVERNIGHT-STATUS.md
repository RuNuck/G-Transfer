# Anvil overnight status

## As of now — 2026-09-06 ~22:45 ET (continued)

Scope: /workspace/project only. Baseline 2.9.0.

### Phase 3-4 prep (this continuation)

- `docs/schemas/scene-spec.schema.json` — SceneSpec (biome, aabb meters, seed, layers: ground/water/canopy/undergrowth/rocks/landmarks/lighting/nav, constraints, kit refs)
- Example: `docs/schemas/examples/jungle-clearing.scene.json`
- Hand contract: `docs/scenes/JUNGLE-CONTRACT.md` — required `exports/scenes/<id>/` layout, `scene.tscn` shape, instance budgets, validation rules (pre-composer)
- Studio Probe UX: Connect "Probe this MCP" writes success/fail to MCP log + sonner toast (Toaster mounted in Studio)
- Studio Plan copy: Forge button → **Plan** with subtitle "Spec + script · GLB needs local Blender"

### Phase 0 leftovers (earlier this session)

- README Status pointer to docs/DESIGN-AND-ROADMAP.md and docs/OVERNIGHT-STATUS.md
- tools/forge-index/build.mjs runs godot_prod validate per GLB; sets ready true/false and status ready|failed
- Fail-closed fixtures under tools/validate/fixtures + expect-fail.mjs harness
- tools/validate/run.mjs exports validateGodotProd for the index builder

### Phase 1 scaffold (no Blender required)

- Job model: src/lib/jobs/ + tools/forge-run/job-store.mjs
- Persist under .anvil/jobs/*.json
- Stages: queued | building | baking | validating | published | failed
- CLI: tools/forge-run/status.mjs, list.mjs, run-asset.mjs
- MCP tools: forge_run_asset, forge_job_status

### Phase 2 prep

- docs/schemas/weapon-graph.schema.json — M4-class WeaponGraph + example

### Still open vs Phase 0/1 exit

- Batch forge CLI for N catalog kinds (real Blender)
- Two-light proof automation
- 10 kinds batch-forged + godot-check green
- Real Blender invoke in run-asset
- Biome kit pieces + composer implementation (schemas/contracts only so far)

### Checks this continuation

- Typecheck (tsc --noEmit)
- npm test (stdio MCP protocol)
- Local git commit (no remote)

---

## Earlier — Phase 0 foundation (2026-09-06 22:28 ET)

Done: artifact gates, forge-index, version align, DEVIEW banner, reports.
Gate results: PASS 5/5 on exports/forge.
Limits then: GLB JSON heuristics only; no batch forge CLI; no 2-light proof; index lacked ready.
