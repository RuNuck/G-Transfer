# Anvil agent guide (Claude Code / Cowork)

Operational rules for driving Anvil over MCP. Prefer **jobs + validate** over pasting Blender scripts. Godot is the default engine. Read schemas before inventing structure.

**Resources:** `anvil://guide/agent` (this doc), `anvil://schemas/weapon-graph`, `anvil://schemas/scene-spec`, plus pipeline/naming/addon URIs under `anvil://`.

---

## Plan vs Run

| Mode | What it is | When |
|---|---------|----|
| **Plan** | Spec / script / layout only. Studio **Plan** button and `forge_create_asset` build an `AssetSpec` + Blender Python — they do **not** write a production GLB. | Exploring briefs, naming, budgets, kits. |
| **Run** | **Asset / weapon:** durable enqueue — `forge_run_asset` / `forge_weapon` return `jobId` as `queued`; worker advances stages; poll `forge_job_status`. **Scene:** `forge_scene` is still **sync** (returns after compose/ship-gate; not queued). | Shipping artifacts an agent can hand to Godot. |

Never treat a green Plan / `forge_qc_checklist` (spec-only) as "forged." **Ready means artifact gates passed.**

---

## Tool map

| Tool | Does | Does not |
|---|---|--------|
| `forge_create_asset` | Brief -> AssetSpec, naming, PBR/LOD notes, full Blender build script. | Run Blender; write GLB; mark ready. |
| `forge_run_asset` | **Enqueue** durable job (returns `jobId` immediately). Kind = Blender forge; file/mesh = validate-only. Worker runs async; poll status. Ship gate ready needs Godot import ok. Kill-mid → `failed`/`worker_interrupted`. | Claim ready from Plan alone; sync publish without gates. |
| `forge_weapon` | **Enqueue** durable weapon job (`type=weapon`). Preset `m4_carbine` or WeaponGraph + overrides → `jobId` queued. Worker: rifle kit Blender + rig clips + bake → validate (meters/grip/convcol/clips) → Godot ship gate. Poll `forge_job_status`. | Fake a ready CAD M4; claim ready without poll/gates. |
| `forge_scene` | **Sync** job from SceneSpec / brief / `specPath` → `exports/scenes/<id>/` (.tscn with **PackedScene kit instances**, report, manifest). Returns after kits + **0 placeholders** + Godot ship-gate (not durable `queued`). Rewrites `validation.json` `godot_import` on finish. | Author one mega-mesh jungle; invent missing kit GLBs; publish placeholders / Godot absent; treat kit-index ready as playable jungle; treat as durable enqueue. |
| `forge_validate` | Artifact gates (`godot_prod`) on a path or folder; fail closed. CLI twin: `npm run validate -- <paths> --json`. | Rubber-stamp from the brief. |
| `forge_job_status` | Poll job id from run/weapon/scene; status, paths, validation summary, errors. | Start work. |

Supporting (debug / escape hatch): `forge_blender_script`, `forge_bake_plan`, `forge_engine_export`, `forge_list_prototypes`, `forge_pipeline`, `forge_qc_checklist`. HTTP `blender_execute` **never** runs code — use local **anvil-blender** stdio (`blender_run_python`) with the add-on.

---

## Happy paths

### Kind Run (forge from catalog)

1. `forge_run_asset({ kind: "lantern", bake?: true, engine?: "godot", brief?: "…" })` → `{ jobId, status: "queued" }` immediately
2. poll `forge_job_status` until **published** or **failed** (worker runs Blender off-request)
3. ship-gate ready = validate + godot-check when Godot present
4. `exports/index.json` status ready
5. CLI twin: `npm run forge:enqueue -- --kind lantern --kick-worker --json` then `npm run forge:worker -- --once` / `forge:doctor`

### File validate-only

1. `forge_run_asset({ file or mesh })` re-validates an existing GLB — does NOT Blender-forge a new mesh
2. poll job; may become ready only after ship-gate (godot-check)

### Plan-only brief (spec/script; no GLB)

1. `forge_create_asset` for spec + script (Plan)
2. Stop claiming success — you CAN Run with kind (catalog Blender forge), not only existing exports GLBs

### Scene (jungle / environment)

1. Read `anvil://schemas/scene-spec` (and `docs/scenes/JUNGLE-CONTRACT.md` / `docs/scenes/JUNGLE-KITS.md`)
2. **Kit forge (MCP, durable):** missing jungle pieces → `forge_run_asset({ kind: "jungle_tree_trunk_a", bake: true })` (any `jungle_*` kind from the piece list) → poll `forge_job_status` until published/failed. Repeat per missing kit. Ship-gate ready needs Godot import ok.
3. **Kit forge (CLI-only batch):** bulk `node tools/forge-run/forge-biome.mjs --all --bake --json` / `npm run forge:biome:jungle` is **CLI-only** (not an MCP tool). Prefer MCP `forge_run_asset` for cold agent sessions; use CLI for Kevin/G-Transfer long bakes.
4. **Honesty:** kit pieces indexed `ready` (or biome forge exit) is **not** a playable jungle scene. Do **not** claim playable jungle / product exit until compose emits real PackedScene instances and `forge_scene` publishes with Godot open — specialist re-clears (Reed/Quinn/Vale/Ori) still required for board exit.
5. `forge_scene({ sceneSpec })` or brief (jungle-clearing fixture if omitted) — **sync**; returns after compose + ship-gate (not durable `queued`)
6. Optional: `forge_job_status` on that `jobId` (already terminal published or failed)
7. Inspect `exports/scenes/<id>/` — **PackedScene / GLB instances only** (`instance=ExtResource`, kits under `kits/`); **reject** `anvil_placeholder` Node3Ds and fused mega-meshes
8. Publish requires kits resolved, **0 `anvil_placeholder`**, **and** Godot headless-open of `scene.tscn`. Finish path rewrites `validation.json` `godot_import` to true/false (never leave null after publish/fail). Godot absent / open skipped => `status=failed`, `validation.ok=false`, hardFail `godot_absent` (never published+ok). Open fail => hardFail `godot_scene_open`. Placeholders left => hardFail `real_instances`.
9. Validate kits via index / `forge_validate` on referenced GLBs when present

### Weapon (Phase 2 — cold path)

1. Read `anvil://schemas/weapon-graph` (example: `docs/schemas/examples/m4-carbine.weapon.json`)
2. `forge_weapon({ preset: "m4_carbine", overrides?: { … } })` **or** `{ weaponGraph }` → `{ jobId, status: "queued" }` immediately
3. Poll `forge_job_status` until **published** or **failed** (one Blender job at a time on the durable worker)
4. Ready = validate (`godot_prod`) + weapon gates (meters ≈ `overallLengthM`, grip/root pivot, `*-convcolonly`, claimed clips) + Godot import ok
5. Artifact: `exports/forge/<jobId>/m4_carbine.glb` (kit carbine via rifle family — real GLB, not CAD-accurate M4 parts). Fail closed if Blender/kit absent (never fake ready).
6. CLI twin: `npm run forge:weapon -- --preset m4_carbine --kick-worker --json` then poll `node tools/forge-run/status.mjs <jobId> --json`

---

## Quality gates (Godot-first)

Fail closed. Do **not** declare success unless:

- [ ] Meters (1 unit = 1 m); sane category bounds; scale (1,1,1)
- [ ] Intentional pivot (weapons: grip / hand socket)
- [ ] Collision proxy when required (Godot `*-convcolonly` / engine equivalent)
- [ ] PBR maps present / bindable on import (albedo not lit; ORM sane)
- [ ] Rigs + **named clips** when the asset needs them
- [ ] `forge_validate` / job ValidationReport hard-fails empty
- [ ] Godot import check green when Godot is installed (`node tools/godot-check/…`)

Spec QC alone is insufficient. Viewport-cool ≒ production-ready.

---

## Scene rule

**Scene = compose kits, not a mega-mesh.**
A jungle is trunk/canopy/root, understory, bank, path, rocks, lights — placed by SceneSpec as **real kit GLB/PackedScene instances**. Never ship one editable blob as the scene product. Never ship `anvil_placeholder` Node3Ds as a playable layout.

**Kit exit ≠ scene / playable jungle.** Having ≥12 biome kits `ready` on disk/index does **not** mean the jungle is playable until `forge_scene` emits instanced `.tscn`, Godot opens it fail-closed, and `validation.json` `godot_import` is rewritten honestly. Do not claim product exit without specialist re-clears.

---

## Schemas & resources

| URI | Content |
|---|-------|
| `anvil://guide/agent` | This guide |
| `anvil://schemas/weapon-graph` | `docs/schemas/weapon-graph.schema.json` |
| `anvil://schemas/scene-spec` | `docs/schemas/scene-spec.schema.json` |
| `anvil://pipeline/godot` | Godot import / ORM / collision notes |
| `anvil://pipeline/unreal` / `unity` | Secondary engine notes |
| `anvil://conventions/naming` | SM/Godot suffixes |
| `anvil://blender/addon` | Add-on + stdio bridge install |

On disk: `docs/schemas/`, example SceneSpec `docs/schemas/examples/jungle-clearing.scene.json`, biome kits `docs/schemas/examples/jungle.biome-kits.json` + `docs/scenes/JUNGLE-KITS.md`. Forge pieces with `npm run forge:biome:jungle` (GLBs gitignored; compose resolves on file presence).

---

## DCC on this forge host

- Blender 5.2.1 and Godot 4.7.2 installed. See docs/DCC-SETUP.md.
- Asset index: validate-ok alone is never ship-ready — forge-run refuses published+ok without Godot import (`hardFail godot_absent` / `godot_import`; index may still label `validated_glb_only` when Godot is missing).
- Scenes (`forge_scene`): fail-closed like forge — placeholders => `real_instances`; Godot absent or scene open skipped => `failed` + `godot_absent`, never published+ok. `validation.json` `godot_import` is rewritten on finish (not left null after publish). Do not treat scenes as validated_glb_only soft-pass. Kit-ready alone is not playable jungle.

---

## CLI cheatsheet

```bash
npm run validate -- exports/forge --json
npm run forge:index
npm run forge:run -- --kind lantern [--bake] --json   # primary: catalog Blender forge
npm run forge:run -- --file exports/forge/us_ammo_can.glb --json  # validate-only existing GLB
npm run forge:scene -- --brief "jungle clearing" --json
npm run scene:compose
npm run typecheck && npm test
```
