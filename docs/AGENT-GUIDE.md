# Anvil agent guide (Claude Code / Cowork)

Operational rules for driving Anvil over MCP. Prefer **jobs + validate** over pasting Blender scripts. Godot is the default engine. Read schemas before inventing structure.

**Resources:** `anvil://guide/agent` (this doc), `anvil://schemas/weapon-graph`, `anvil://schemas/scene-spec`, plus pipeline/naming/addon URIs under `anvil://`.

---

## Plan vs Run

| Mode | What it is | When |
|---|---------|----|
| **Plan** | Spec / script / layout only. Studio **Plan** button and `forge_create_asset` build an `AssetSpec` + Blender Python — they do **not** write a production GLB. | Exploring briefs, naming, budgets, kits. |
| **Run** | Job tools that touch `exports/` and the job store: `forge_run_asset`, `forge_scene`, then poll `forge_job_status`. | Shipping artifacts an agent can hand to Godot. |

Never treat a green Plan / `forge_qc_checklist` (spec-only) as "forged." **Ready means artifact gates passed.**

---

## Tool map

| Tool | Does | Does not |
|---|---|--------|
| `forge_create_asset` | Brief -> AssetSpec, naming, PBR/LOD notes, full Blender build script. | Run Blender; write GLB; mark ready. |
| `forge_run_asset` | Job over an **existing** `exports/**/*.glb` (stages → validate → index). Blender build/bake is simulated when `blender` is missing. | Invent new mesh topology from a brief alone. |
| `forge_scene` | Job from SceneSpec / brief / `specPath` → `exports/scenes/<id>/` (.tscn, report, manifest). **Compose kit instances.** | Author one mega-mesh jungle; invent missing kit GLBs. |
| `forge_validate` | Artifact gates (`godot_prod`) on a path or folder; fail closed. CLI twin: `npm run validate -- <paths> --json`. | Rubber-stamp from the brief. |
| `forge_job_status` | Poll job id from run/scene; status, paths, validation summary, errors. | Start work. |

Supporting (debug / escape hatch): `forge_blender_script`, `forge_bake_plan`, `forge_engine_export`, `forge_list_prototypes`, `forge_pipeline`, `forge_qc_checklist`. HTTP `blender_execute` **never** runs code — use local **anvil-blender** stdio (`blender_run_python`) with the add-on.

---

## Happy paths

### Existing GLB → ready

1. `forge_run_asset({ file: "exports/forge/….glb" })` → `jobId`
2. `forge_job_status({ jobId })` until `published` / `failed`
3. Confirm with `forge_validate({ path: "…" })` (or trust job validation only if report lists hard gates)
4. Check `exports/index.json` entry `status: "ready"`

### New brief (no Blender on host)

1. `forge_create_asset` for spec + script (Plan)
2. Stop claiming success — queue human/Blender forge, **or** only run jobs against GLBs already under `exports/`

### Scene (jungle / environment)

1. Read `anvil://schemas/scene-spec` (and `docs/scenes/JUNGLE-CONTRACT.md`)
2. `forge_scene({ sceneSpec })` or brief (scaffold may use the jungle example fixture)
3. Poll `forge_job_status`
4. Inspect `exports/scenes/<id>/` — instances only; **reject** fused mega-meshes
5. Validate kits via index / `forge_validate` on referenced GLBs when present

### Weapon (Phase 2 target)

1. Read `anvil://schemas/weapon-graph`
2. Prefer future `forge_weapon`; until then Plan with rifle kit + graph JSON offline
3. Validate meters, **grip pivot**, collision, named clips — not beauty shots

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
A jungle is trunk/canopy/root, understory, bank, path, rocks, lights — placed by SceneSpec. Never ship one editable blob as the scene product.

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

On disk: `docs/schemas/`, example SceneSpec `docs/schemas/examples/jungle-clearing.scene.json`.

---

## Hard blockers on this forge host

- **No Blender** and **No Godot** on the overnight box — real kit build/bake/import cannot run here; jobs simulate/skip DCC stages.
- Prefer documenting the gap over installing heavy DCC stacks into the shared agent box.

---

## CLI cheatsheet

```bash
npm run validate -- exports/forge --json
npm run forge:index
npm run forge:run -- --file exports/forge/us_ammo_can.glb --json
npm run forge:scene -- --brief "jungle clearing" --json
npm run scene:compose
npm run typecheck && npm test
```
