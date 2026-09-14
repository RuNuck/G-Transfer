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
| `forge_run_asset` Blender build/bake | **Real** headless part-kit via `--kind` / `dcc:smoke` (file-only mode still skips rebuild) |
| Scene compose jungle example | **Scaffold** — instances .tscn + report; placeholder kit refs, no mega-mesh (good), but not full biome kits |
| WeaponGraph | Schema + **M4 example** + check:weapon-graph (Phase 2 forge_weapon still not implemented) |
| Godot headless import check | **Runnable** — Godot 4.7.2 on PATH; `check-import.mjs exports/forge` ok |
| Blender kit/surface forge | **Real smoke passed** (lantern part kit + optional bake); see section below |

---

## Blockers

- ~~**No Blender**~~ / ~~**No Godot**~~ — installed on this box Mon Sep 7 morning (see `docs/DCC-SETUP.md`).
- Phase 1 exit ("brief → ready with zero script paste") can now use local Blender; still needs a real `forge_run_asset` end-to-end smoke with Anvil add-on.
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

---

## DCC install (Mon Sep 7, 2026 ~7:48am ET)

Official binaries under `/home/box/tools` (not apt). Symlinks in `/home/box/.local/bin`.

| Tool | Version | Absolute path | Symlink |
|---|---|---|---|
| Blender | **5.2.1 LTS** | `/home/box/tools/blender-5.2.1-linux-x64/blender` | `~/.local/bin/blender` |
| Godot | **4.7.2.stable** | `/home/box/tools/godot-4.7.2/Godot_v4.7.2-stable_linux.x86_64` | `~/.local/bin/godot` (+ `godot4`) |

**Env:** `ANVIL_GODOT=/home/box/tools/godot-4.7.2/Godot_v4.7.2-stable_linux.x86_64` (also in `~/.bashrc`). `ANVIL_BLENDER` set similarly.

**Smoke:**
- `blender --background --python-expr "import bpy; print(bpy.app.version_string)"` → `5.2.1 LTS`
- `node tools/godot-check/check-import.mjs exports/forge` → `"ok": true`, `"godot": "4.7.2.stable.official.ed1daf0bf"`, `problems: []`

**Disk:** ~1.2 GiB Blender + ~140 MiB Godot. Full detail: `docs/DCC-SETUP.md`.



---

## Real Blander smoke (Mon Sep 7, 2026 ~8:00am ET)

Wired headless forge on this box (tools/forge-run + dcc:smoke).

### What actually ran in Blender

- Blender **5.2.1 LTS** `--background` + `tools/forge-run/headless-run.py`
- `ANVIL_KIT_DIR=public/downloads` – part kit loaded (`noil_lantern` built as **part kit**, not blockout)
- LOD0: 2856 tris (budget 3000); Godot collision `oil_lantern_col-convcolonly`
- Build-only GLB ~164 KiB; with `--bake`: 2048px surface (~(0s) – albedo/normal/ORM + re-export _6.2 MiB

### Artifact paths

| Path |
|---|
---|
| `exports/forge-smoke/oil_lantern.glb` |
| `exports/forge-smoke/textures/tex_oil_lantern_{albedo,normal,orm}.png` (when baked) |
| `exports/forge-smoke/dcc-smoke-report.json` |
| scripts `emit-script` – `tools/blender-check/out/gen/lantern_godot.{py,bake.py}` (ignored) |

### Validate / Godot

- validate exports/forge-smoke/oil_lantern.glb: ok true, hardFails none
- `ANVIL_GODOT=... node tools/godot-check/check-import.mjs exports/forge-smoke/oil_lantern.glb` – `ok: true`, problems: []; with bake, all three mats get albedo+normal+ORM textures

### NPM scripts added

- `dcc:smoke` / `dcc:smoke:bake`
- `forge:emit` – emit build/bake python from catalog kind (jiti → `src/`)
- `forge:run` now accepts `--kind` / `--script` for real Blender (falls back to simulate on `--file` only when Blender is missing)

### Scaffold vs real (updated)

| Area | Real? |
| ---|----|
| GLB validate | Real |
| Index builder | Real |
| `forge_run_asset` / `--kind` Blender build/bake | **Real on this box** (headless part kit + optional bake) |
| Godot headless import | **Real** |
| Scene compose jungle | Scaffold |
| WeaponGraph / `forge_weapon` | Schema + example only |

### Remaining gaps to hardened roadmap

1. Wire MCP `forge_run_asset` args for `kind` (not only `existing file`) so agents don't need the CLI.
2. Run full `check-build.py` catalog regression on 5.2.1.
3. Phase 2 `forge_weapon` + M4 preset.
4. Phase 3 jungle kit families before treating scene compose as production.
5. Durable job queue (today: sync fs job store).

Docs: `docs/DCC-SETUP.md`.

---

## Reed PR checklist A-C (+D) — Mon Sep 7 ~8:30am ET

- A: forge-run finish runs godot-check; index ready only after import ok; else validated_glb_only/blocked.
- B: godot_prod hard-fails missing PBR texture refs + out-of-range meters; weapon/rigged pivot heuristic; fixtures no-textures-pbr + bad-scale.
- C: MCP forge_run_asset accepts kind/bake/brief/engine; file/mesh validate-only; AGENT-GUIDE DCC truth.
- D: scene compose/run-scene do not publish/ok when kits unresolved (scaffold/failed).


---

## Decision log — Pack A–C gate (`a9f99fe`) — Mon Sep 7, 2026 ~9:05am ET — Sy (Scribe)

**Decision:** Pack A–C **NOT CLOSED** / **HOLD SHIP**. Owner of close: Bill (re-open when veto remediations smoke green).  
**Commit gated:** `a9f99fe` (tree later at `2bba0f2` AGENT-GUIDE follow-up; gate evidence below is against `a9f99fe` artifacts + current sources that still show the holes).

| Gate | Owner | Outcome | Evidence link |
|---|---|---|---|
| Security path jail / MCP file | Sage (Dex reproduced) | **VETO** — `resolveMesh` accepts absolute + `../` / repo-root paths; not exports-only | `tools/forge-run/run-asset.mjs` `resolveMesh`; probe: `package.json` → `/workspace/project/package.json` (`insideExports: false`); `/etc/passwd` resolves. MCP `forge_run_asset` file/mesh still hits runner. |
| Implementer tsc/test / kind wiring | Dex | **Partial clear** — `npx tsc --noEmit` 0; stdio protocol ok; `validate:fixtures` expect-fail 4/4 harness 0; kind+handler/doc wired. File/mesh path **still stubbed** until jail fix + reject smoke | Dex gate notes + same `resolveMesh` probe |
| Render ready/publish PBR | Remy | **VETO** — `exports/forge-smoke/oil_lantern.glb` indexed `ready` / job `published` with `bake: false`, untextured Principled BSDF, no albedo+normal+ORM / multi-light proof | `exports/forge-smoke/dcc-smoke-report.json` (`bake: false`, bake stage note, `paths.indexStatus: ready`, `status: published`); `exports/index.json` entry `forge-smoke.oil_lantern` `status: ready` |
| DevOps headless / fail-closed | Nova | **Partial clear host** (Blender 5.2.1 / Godot 4.7.2 absolute `ANVIL_*`; lantern used real headless import). **VETO soft paths** — `dcc-smoke` can `SKIP godot-check` when Godot missing; `run-asset` simulates build/bake without Blender; publish can advance on `validated_glb_only` | `tools/dcc-smoke.mjs` SKIP line; `tools/forge-run/run-asset.mjs` simulate + `validated_glb_only` notes; `tools/forge-run/ship-gate.mjs` |

**Clears that stand (narrow):** `blender_execute` refuse-only; addon bind `127.0.0.1`+token untouched; no Kevin-PC creep in pack; `/api/forged` still jails to `exports/` + `.glb` (Sage); host binaries present (Nova).

**Not locked:** ready/publish/MCP file-path clear, or pack A–C checkbox. Re-log only after Dex jail patch + Remy hard-gate maps/lights + Nova fail-closed smokes land with linked smoke command **and** result.

Evidence mirror: `docs/evidence/pack-ac-gate-2026-09-07.md`.

### Amendment — mesh jail (`8978d20`) — Mon Sep 7, 2026 ~9:10am ET — Sy

**Decision:** Sage path-jail **VETO remediated in tree** (pending Sage re-clear). Pack A–C remains **HOLD SHIP** (Remy ready/PBR + Nova fail-closed still open).  
**Evidence:** commit `8978d20`; smoke `node tools/forge-run/smoke-mesh-jail.mjs` → exit 0 (`package.json`, `../package.json`, absolute outside `exports/` all exit 2). Sy re-ran smoke same day. Positive `exports/forge-smoke/oil_lantern.glb` still resolves per Dex. Mirror: `docs/evidence/pack-ac-gate-2026-09-07.md`.

### Decision — Pack A–C re-clear + must-fix `3bbb854` — Mon Sep 7, 2026 ~9:25am ET — Sy

**Decision:** Pack A–C remains **HOLD SHIP**. Owner of close: Bill (after Remy + Nova bars clear).

| Item | Owner | Outcome | Evidence |
|---|---|---|---|
| MCP `file`/`mesh` jail (abs/`../`) | Sage | **CLEARED** | `8978d20`; `node tools/forge-run/smoke-mesh-jail.mjs` exit 0 (Sage + Sy) |
| Symlink realpath residual | Dex → Sage re-probe | **Closed in tree** at `ea3b3f4`; smoke includes `exports/_jail-smoke/escape.glb` → exit 2 (Sy re-ran full jail smoke exit 0) | Pending Sage verbal re-clear of trap; Sy evidence green |
| Must-fix Vale fixtures / scene | Bill | **Landed** (not an A–C close) | `3bbb854` (+ tip `c4560fc` forge_scene Godot-absent) |
| Godot-absent shipGate refuse publish | Nova | **Partial clear** | Sy probe: `ANVIL_GODOT=/no/such/godot PATH=/usr/bin:/bin node tools/forge-run/run-asset.mjs --file exports/forge-smoke/oil_lantern.glb --json` → job `status: failed`, note `hardFail godot_absent`, `indexStatus: validated_glb_only` |
| `dcc-smoke` SKIP + Blender-absent simulate publish | Nova | **VETO HOLDS** | `tools/dcc-smoke.mjs` still SKIP; Sy probe `ANVIL_BLENDER=/no/such/blender` existing-GLB → `status: published`, notes simulated build/bake, exit 0 |
| Ready/publish without packed maps / ≥2 lights | Remy | **VETO HOLDS** | Index still `ready` on `forge-smoke.oil_lantern`; validate `ok` / empty `hardFails`; bake-skip path still in `run-asset.mjs`; `3bbb854` is meters/pivot fixtures not maps/lights |

**Not locked:** pack A–C checkbox, ready/publish clear. Re-log only when Remy hard-gates + Nova fail-closed DCC smokes land with command+result.

Mirror: `docs/evidence/pack-ac-gate-2026-09-07.md`.

### Amendment — Sage symlink clear — Mon Sep 7, 2026 ~9:30am ET — Sy

**Decision:** Mesh-jail bar **CLOSED** on Sage’s side (`8978d20` + `ea3b3f4`). Sage re-probed trap `exports/_sage_probe/escape.glb` → exit 2 at resolve; smoke exit 0. Pack A–C still **HOLD** (Remy + Nova; Dex in-flight must-fixes, no commit hash yet — Remy NO EVIDENCE until hash+smoke).
