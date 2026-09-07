# Anvil morning brief — for Kevin at 7am

**As of** Sun Sep 6 / Mon Sep 7, 2026 — ~11:20pm ET (overnight on `/workspace/project` only). Baseline **2.9.0**.

---

## Timeline (commits on main)

| ET | Commit | What |
|---|---|---|
| 10:30pm Sep 6 | `ef0edb7` | Phase 0: `godot_prod` validate CLI, forge index, version align 2.9.0 |
| 10:39pm Sep 6 | `589429c` | Phase 0 leftovers + Phase 1 job scaffold + WeaponGraph schema |
| 10:49pm Sep 6 | `472dd89` | Phase 3/4 prep: SceneSpec schema, jungle contract, Probe UX, Plan copy |
| 11:04pm Sep 6 | `115627d` | Phase 4 scaffold: SceneSpec types, scene-compose, example export |
| ~11:15pm Sep 6 | `077a856` | Agent guide + MCP resources + `forge_validate` + morning brief |
| ~11:20pm Sep 6 | (this commit) | M4 WeaponGraph example, forged picker filter, `check:weapon-graph` |

---

## What works now (commands)

| Command / tool | Notes |
|---|---|
| `npm run validate` / `forge_validate` | Godot-first GLB artifact gates (GLB JSON + naming heuristics without Godot); fail closed. Fixtures expect fail. |
| `npm run forge:index` | Rebuilds `exports/index.json` (~10 ready / 4 failed on last build). |
| `npm run forge:run` / `forge_run_asset` | Job store under `.anvil/jobs/` over an **existing** exports GLB. |
| `npm run forge:scene` / `forge_scene` | SceneSpec/brief → `exports/scenes/<id>/  .tscn + report (jungle example scaffold). |
| `forge_job_status` | Poll job id. |
| `forge_create_asset` | Plan: AssetSpec + Blender script (does not forge a GLB). |
| `npm run scene:compose` | Direct compose from `docs/schemas/examples/jungle-clearing.scene.json`. |
| `npm run typecheck` / `npm test` | npm test = stdio MCP protocol (Blender relay). |

MCP resources (HTTP `/api/mcp`): `anvil://guide/agent`, `anvil://schemas/weapon-graph`, `anvil://schemas/scene-spec`, plus pipeline/naming/addon. See `docs/AGENT-GUIDE.md`.

---

## Scaffold vs real

| Area | Real? |
|---|---|
| GLB validate (glTF parse + godot_prod heuristics) | Real on this box |
| Index builder | Real |
| Job store + run/scene status | Real (sync scaffold worker; not a durable queue) |
| `forge_run_asset` Blender build/bake | **Simulated** when blender missing — no new kit GLBs |
| Scene compose jungle example | **Scaffold** — instances .tscn + report; placeholder kit refs, no mega-mesh (good), but not full biome kits |
| WeaponGraph | Schema + **M4 example** + check:weapon-graph (Phase 2 forge_weapon still not implemented) |
| Godot headless import check | Not runnable here (no godot binary) |
| Blender kit/surface forge | Not runnable here (no blender binary) |

---

## Blockers

- **No Blender** on the forge/agent box (`command -v blender` empty). Did not attempt a heavy apt install overnight.
- **No Godot** on the box. Godot-import gates and showcase open cannot run here.
- Phase 1 exit ("brief → ready with zero script paste") still needs a real Blender worker host.
- Phase 3 jungle biome kit families not authored; scene scaffold references placeholder kits.

---

## Recommended next (when you're back)

1. Install Blender 4.2+ + Anvil add-on on a machine you control; point anvil-blender stdio MCP at it.
2. Install Godot 4 there (and/or set `ANVIL_GODOT`); run `node tools/godot-check/check-import.mjs exports/`.
3. Run one real `forge_run_asset` smoke with Blender present; confirm `forge_validate` + index ready.
4. Read `docs/AGENT-GUIDE.md` + wire Claude Code to HTTP `/api/mcp` and anvil-blender.
5. Phase 2 next: `forge_weapon` + M4 preset from WeaponGraph schema.
6. Phase 3: author jungle kit families before treating scene compose as production.

Docs: `docs/DESIGN-AND-ROADMAP.md`, `docs/AGENT-GUIDE.md`, `docs/scenes/JUNGLE-CONTRACT.md`.

## Overnight note (11:20pm ET)

- M4 WeaponGraph example + check:weapon-graph script.
- Forged picker filter by kind / mesh substring.
- DCC worker still unavailable on this box image (needs host refresh).
- Kevin machine (when authorized) or future box image needs Blender 4.2+ or 5.x for real forge.
