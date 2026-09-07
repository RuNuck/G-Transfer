# Anvil — Design & Roadmap

**Product:** Anvil (in-house game-asset MCP + Blender forge)  
**Baseline:** 2.9.0 (2026-09-05)  
**Audience:** Kevin + anyone shipping Anvil toward agent-driven, Godot-ready content  
**Stance:** Skeptical. Checkable exit criteria beat slideware. Scenes are compositions of kits, not one AI jungle blob.  
**Related:** `README.md`, `CHANGELOG.md`, `REVIEW-2026-09-05.md`, research brief `production-ready-assets-brief.md`

---

## North star

Claude Code / Cowork can ask for either:

1. an **M4-class detailed modular weapon** (receiver, barrel, handguard, stock, mag, rails, sights; moving parts + clips), or  
2. a **full jungle scene** (trees, understory, rivers, rocks, path, light, collision),

…and receive **Godot-ready production content** through the Anvil pipeline — without a human re-scaling pivots, rewiring materials, or hand-building collision.

Constraints that do not move:

| Constraint | Meaning |
|---|---|
| **In-house only** | No marketplace packaging as a goal. No Fab/Unity Store compliance theater. Ship what *we* drop into Godot. |
| **Godot-first** | Default engine is Godot. glTF/GLB is the contract. Unreal/Unity remain secondary profiles, not the design center. |
| **Grounded / realistic** | Real-world meters, believable mass, wear from use, materials that hold under gameplay lights. Not stylized toy packs. |
| **Rigs & clips matter** | Hero weapons and interactive props are not “done” as static meshes. Bones + named demo clips are first-class. |
| **Genre undecided** | Pipeline must not bake in fantasy-or-sci-fi exclusivity. Jungle and M4 are *stress tests*, not the product identity. |

Success looks like: an agent brief in → validated GLB(s) + Godot scene/prefab stubs out → import check green → human opens `main.tscn` and plays without surgery.

---

## 1. Problem & non-goals

### Problem

Anvil 2.9.0 can already turn a brief into a kit-built, surfaced GLB for 22 prototype kinds, with optional rigs/clips, Godot import checks, and an MCP surface for Claude. That is a strong forge. It is **not** yet a reliable *agent production loop* for:

- **Hero modular weapons** at M4 fidelity (attachments, rail contracts, interchangeable parts, first-person pivot).
- **Environment kits** dense enough for a jungle (biome pieces, shared trim/texel, snap rules).
- **Scene composition** (place many assets, rivers as spline/mesh kits, lighting ≥2 setups, collision layers) without the agent inventing one mega-mesh.

Today the agent still stitches too many manual steps (`forge_create_asset` → copy script → `blender_run_python` → bake → hope paths exist → import). Jobs are not durable. Validation often certifies the *spec*, not the *forged file*. There is no scene composer. There is no weapon graph. Jungle as a single generative blob would be the wrong product.

### Non-goals (explicit)

- Not a Meshy/Tripo-style AI topology dump into Godot.
- Not one-shot “entire jungle mesh” from a prompt.
- Not Unreal Nanite / Unity Store / Fab milestones.
- Not character performance, faces, or locomotion systems.
- Not SaaS, cloud Blender farms, or public API productization.
- Not picking the game genre or shipping a game vertical slice.
- Not film VFX photoreal — grounded under engine lights is enough.
- Not re-exporting Godot LOD siblings (learned in 2.8.x).

If it only prettifies a screenshot without improving meters, pivot, collision, PBR, clips, or agent reliability — it waits.

---

## 2. Definition of production-ready

Borrowed and tightened from research (`production-ready-assets-brief.md`). Anvil’s hard bar:

> Another developer (or agent) can drop the asset into Godot, place it next to a **2 m human reference**, collide/interact with it, and get correct PBR response — **with no manual scale / pivot / material / collision surgery**.

### Hard requirements (fail = not ship)

| Gate | Rule |
|---|---|
| **Meters** | 1 unit = 1 meter. Category bounds vs reference (door ~2 m, rifle length ~0.7–1.0 m, tree trunk diameters sane). Transforms applied; scale (1,1,1). |
| **Pivot** | Intentional by category: floor props bottom-center; weapons **grip / hand socket**; modular kit pieces snap corner or documented grid; doors at hinge. |
| **Collision** | Separate proxy preferred (`-convcolonly` / primitives). Never “visual mesh as only collider” for interactive/dynamic props. Hull budget enforced. |
| **PBR** | Metallic-roughness: albedo (no baked lighting), normal, roughness, metallic, AO/ORM. Albedo/metallic histograms in sane ranges. Materials auto-bind on Godot import. |
| **Clips / rig** | When `needs_rig`: skeleton present; named clips survive GLB → Godot; no cross-asset clip leakage; rest pose restored after export. |
| **≥2 lights** | Asset/scene must be reviewed (automated render or checklist) under **at least two lighting setups** + gameplay-ish FOV — not a single beauty HDRI. |
| **LODs** | Policy explicit: Godot auto-LOD vs exported chain for other engines. No triple-draw from leftover `_LOD*` siblings in Godot. |
| **Naming** | Godot suffixes respected; mesh/material names stable and non-vague. |
| **Self-contained** | GLB embeds or relatives resolve; forge index records paths, tri counts, map list, validation status. |

### Soft requirements (warn)

Style drift vs kit palette; uniform generator edge-wear; high TD CV within a kit; material-slot sprawl; aggressive LOD silhouette collapse.

Viewport-cool ≠ production-ready. A green `forge_qc_checklist` that never opened the GLB ≠ production-ready.

---

## 3. Current state — Anvil 2.9.0 baseline + gaps

### What works (keep)

- **Spec → kit → bake → GLB** path for 22 kinds; Godot default engine.
- Part-kit families with authoring contract (`kit/AUTHORING.md`) + `tools/kit-check/`.
- Surfacing recipes (incl. moss) with wear/dirt controls; high-poly bake path when add-on present.
- Optional rigs + demo clips (`ANVIL_RIG=1`); Godot headless import check; showcase project builder.
- Studio can preview forged GLBs from `exports/` via `/api/forged`.
- Dual MCP: HTTP script generation + local stdio Blender execution (contracts clarified post-review).
- Substantial verification under `tools/` (blender-check, godot-check, mcp-check, studio-check, stdio-check).

### Gaps vs north star (honest)

| Area | Gap |
|---|---|
| **Agent loop** | Fragile multi-step; no durable **jobs**; agent babysits Blender. |
| **Validation** | Spec QC can rubber-stamp; need **file-level** GLB + Godot import as truth. |
| **Weapons** | Rifle kits exist; not **M4-class modular** (graph, rails, interchangeable parts). |
| **Environments** | No **biome kit** (trees, roots, river bank, foliage, mud). |
| **Scenes** | No composer → no instance `.tscn` for “jungle + river”. |
| **Index / batch** | `exports/` dump; no `index.json`; batch runner not productized. |
| **Lighting proof** | Showcase sun+sky only; ≥2-light gate not ship-blocking. |

Prettier rifle shots without jobs + validation + index will not unlock the north-star demos.

---

## 4. Architecture

```
┌─────────────────────────────────────────────┐
│  Agent layer (Claude Code / Cowork + MCP)   │
│  briefs, job tools, status, validate        │
└─────────────────────┬───────────────────────┘
                      │
          ┌───────────▼───────────┐
          │  Scene composer (new) │  SceneSpec → instances, lights, colliders
          │  biome kits, layout   │  NEVER one mega jungle mesh
          └───────────┬───────────┘
                      │ asset requests / kit refs
          ┌───────────▼───────────┐
          │  Asset forge (deepen) │  AssetSpec → Blender kit/bake → GLB
          │  WeaponGraph (new)    │  modular M4-class assemblies
          └───────────┬───────────┘
                      │ validated artifacts + index.json
          ┌───────────▼───────────┐
          │  Godot                │  import check, .tscn stubs, playable drop-in
          └───────────────────────┘
```

### Agent layer

- Speaks only in **schemas** (AssetSpec, WeaponGraph, SceneSpec, Job).
- Prefers **job tools** over raw script pasting once Phase 1 lands.
- Reads `index.json` + validation reports; does not claim success from a Python print alone.

### Scene composer (new)

- Input: SceneSpec (biome, bounds, seed, density, required landmarks, light profiles).
- Output: Godot scene (or intermediate SceneIR → `.tscn`) referencing **kit instances**.
- Layout: rules + constrained random (paths, river spline, canopy density), not a single generative mesh.
- Collision: ground + blocker proxies from kit metadata.
- Lighting: emits ≥2 named light setups (e.g. `overcast`, `golden_shafts`) for validation.

### Asset forge (deepen)

- Existing kit/bake pipeline remains the heart.
- Add **Godot export profile** as the strict default validation target.
- **WeaponGraph**: declarative modular weapon — nodes (receiver, barrel, handguard, stock, magazine, optic, underbarrel) + sockets (rail segments, thread, lockup) + constraints (length envelopes, material roles) → assembled kit build + rig clips.
- Batch runner: enqueue many AssetSpecs; isolate Blender sessions to avoid clip leakage / rest-pose bugs already fixed once.

### Scenes as compositions, not mega-meshes

Hard product rule:

- A “jungle” is a **set of biome kit pieces** (trunk A/B/C, canopy clusters, fern cards, root balls, river bank modular, rock scatter, mud decals) placed by the composer.
- AI/procedural may help **author kit pieces** or scatter parameters — it must not replace the kit with one uneditable blob.
- Reason: Godot streaming, LODs, collision, reuse, art direction control, and agent debuggability all die on mega-meshes.

### Biome kits (jungle first)

Minimum jungle kit families (illustrative, not final art list):

- `tree_canopy` / `tree_trunk` / `tree_root` (snap trunks to roots; canopy LOD aggressive).
- `understory` (fern, shrub — card or low-card hybrid; wind later, not Phase 3 blocker).
- `river_bank` + `water_plane` or spline mesh segments (meters, flow axis documented).
- `terrain_tile` / `path_dirt` (texel-locked, grid snap).
- `rock_scatter`, `fallen_log`, `mud_decal`.

Shared: dirt/moss/wet recipes, biome TD target, collision primitives per piece.

### WeaponGraph for M4-class

- Graph YAML/JSON → kit assembly + attachments.
- Sockets: name, local transform, allowed children, rail length budget.
- Clips: charging handle, bolt, trigger, mag release, selector, stock collapse if present.
- Pivot: grip for FPS; metadata for world drop. Validate bounds, sockets, clips, Godot skeleton.

---

## 5. Technical systems

### Schemas

Versioned JSON Schema (or Zod mirrors in-repo) for:

| Schema | Purpose |
|---|---|
| `AssetSpec` | Existing; tighten pivot/collision/rig/engine profile fields. |
| `WeaponGraph` | Modular weapon declaration. |
| `BiomeKitManifest` | Piece list, snap, TD, material roles. |
| `SceneSpec` | Biome, bounds, seed, instance intents, lights. |
| `ForgeJob` | id, type (`asset`\|`weapon`\|`scene`), status, inputs, artifact URIs, validation. |
| `ValidationReport` | Hard/soft gate results; Godot import excerpt. |
| `IndexEntry` | Stable id, kind, paths, hashes, version, status. |

Breaking schema changes bump a `schemaVersion` integer; agents pass it explicitly.

### Validation gates

Two layers:

1. **Spec gates** — cheap, early (tris budget, required fields, engine profile).
2. **Artifact gates** — mandatory before `status=ready`:
   - GLB parse: meters/bounds, materials, textures present.
   - Collision node present when required.
   - Rig/clips when required; rest pose sane.
   - Godot headless import (`tools/godot-check`) green.
   - Lighting proof: two renders or probe metrics hooked to job (Phase 0 may stub with checklist + showcase lights; Phase 5 hardens automation).

Fail closed: agent-facing tools return `isError` / failed job, never silent ok.

### Forge runner

- Local process (in-house): reads jobs, launches Blender with isolation, writes artifacts under `exports/forge/<jobId>/`, updates index.
- Profiles: `godot_glb` (default), later `unreal_*` / `unity_*` without blocking Godot path.
- Concurrency: prefer one Blender job per process initially (correctness > throughput).
- Idempotency: same job payload hash → reuse artifacts unless `--force`.

### Jobs MCP tools (target surface)

| Tool | Role |
|---|---|
| `forge_run_asset` | Enqueue AssetSpec / brief+kind → job id. |
| `forge_weapon` | Enqueue WeaponGraph or M4 preset + overrides. |
| `forge_scene` | Enqueue SceneSpec (composer). |
| `forge_job_status` | Poll job; return status, logs tail, artifact paths, validation summary. |
| `forge_validate` | Run artifact gates on a path or job id; write ValidationReport. |

Existing tools (`forge_create_asset`, script fetch, etc.) remain for debugging and studio; agents should prefer jobs once Phase 1 exits.

### `index.json`

Authoritative catalog under `exports/index.json` (or sharded with a root pointer):

```json
{
  "schemaVersion": 1,
  "updatedAt": "ISO-8601",
  "entries": [
    {
      "id": "weapon.m4.baseline",
      "kind": "weapon_graph",
      "status": "ready",
      "engine": "godot",
      "glb": "forge/…/weapon.glb",
      "report": "forge/…/validation.json",
      "clips": ["cock_back", "trigger_pull", "magazine_release", "selector_toggle"],
      "hash": "sha256:…"
    }
  ]
}
```

Agents list/filter ready assets; composer resolves kit refs through the index, not freestyle paths.

### Testing

Keep the current `tools/` matrix; add schema fixtures + golden WeaponGraph checks; job state-machine tests (no Blender) plus one Blender smoke job when available; Godot import required for `ready`; composer tests (instance counts, mega-mesh reject, seed stability); regressions for clip leakage, rest pose, and Godot LOD siblings.

---

## 6. Agent experience examples

### Example A — M4-class weapon

**User / agent:** “Forge a detailed M4-style carbine for Godot, modular rails, collapsible stock, full control clips.”

**Happy path (target):**

1. Agent calls `forge_weapon` with preset `m4_carbine` + overrides (rail length, optic none, stock collapsible).
2. Receives `jobId`. Polls `forge_job_status` until `ready` or `failed`.
3. On ready: GLB path + ValidationReport (meters ~0.84 m length, grip pivot, convcol on receiver, clips listed, Godot import ok).
4. Agent optionally drops into showcase project or returns paths to the human.

**Failure path:** socket constraint violated → job `failed` with gate id (never a green bad mesh).

### Example B — Jungle scene

**User / agent:** “Build a Godot jungle clearing with a river, dense trees, and a dirt path — production kits, not a blob.”

**Happy path (target):**

1. `forge_scene` with SceneSpec biome=`jungle_clearing`, bounds 40×40 m, seed, lights=`["overcast","god_rays"]`.
2. Composer batch-forges any missing biome kit pieces via `forge_run_asset`.
3. Job returns `.tscn` + instances + ground collision + two light setups.
4. `forge_validate`: instance budgets, index refs resolve, Godot import opens.

**Forbidden:** a fused `jungle.glb` mega-mesh. Pretty in Blender still fails the product.

---

## 7. Phased roadmap

Checkboxes are the working tracker. **Exit criteria** are mandatory; demos without them do not close a phase.

### Phase 0 — Production foundation

**Goal:** Make “ready” mean something for single Godot assets.

- [ ] File-level validation on forged GLBs (not spec-only QC); fail closed on pivot/collision/meters.
- [ ] Godot export/validation profile default; `exports/index.json` updated by forge.
- [ ] Batch forge CLI (N AssetSpecs → isolated runs → index).
- [ ] ≥2-light proof in showcase or validation notes (automation may be thin).

**Exit criteria:** 10 catalog kinds batch-forged, index `ready`, `godot-check` green; broken pivot/scale fixtures fail; README points at index + validate.

### Phase 1 — Reliable agent asset loop (jobs)

**Goal:** Claude forges without babysitting scripts.

- [ ] Job store + worker (filesystem OK); artifacts + ValidationReport + index updates.
- [ ] MCP: `forge_run_asset`, `forge_job_status`, `forge_validate`.
- [ ] Clear `isError` / failed states; protocol tests + one Blender smoke job.

**Exit criteria:** Cold session brief → run → poll → ready GLB with zero script paste; kill Blender mid-job → `failed`, never corrupt `ready`.

### Phase 2 — Hero weapons (M4-class)

**Goal:** Modular weapon graph for the north-star weapon ask.

- [ ] `WeaponGraph` schema + M4 preset; socket/rail contracts in kit assembly.
- [ ] MCP `forge_weapon`; baseline clips; grip pivot verified in Godot.
- [ ] Attachment swap (e.g. stock) without breaking validation.

**Exit criteria:** Agent “M4-style carbine” via `forge_weapon` green; grip pivot usable in Godot; clips play; no material surgery.

### Phase 3 — Environment kits

**Goal:** Jungle biome pieces as production kits (not yet full scenes).

- [ ] BiomeKitManifest + jungle families (trunk/canopy/root, bank, path, rock, understory).
- [ ] Shared moss/dirt/wet recipes; TD lock; collision + snap per piece.
- [ ] Batch-forge into index as `biome.jungle.*`.

**Exit criteria:** ≥12 jungle pieces `ready` with consistent TD/materials; snap into a hand-built sample `.tscn` with no scale fixes.

### Phase 4 — Scene composer

**Goal:** “Jungle scene” returns a composition of kits.

- [ ] SceneSpec + composer IR → Godot `.tscn`; MCP `forge_scene`.
- [ ] River/path rules, density, seed stability; reject mega-meshes; instance budgets.
- [ ] Two light setups in ValidationReport.

**Exit criteria:** Agent jungle brief → ready instance `.tscn` in Godot; same seed ⇒ stable hash; new seed ⇒ new scatter, same kit refs.

### Phase 5 — Hardening

**Goal:** Make the loop boring and trustworthy.

- [ ] Lighting probes / optional screenshot diffs gated.
- [ ] Flake hunt: clip leakage, rest pose, Godot LOD siblings, `/api/forged` path escapes.
- [ ] Job retries, timeouts, disk + scene performance budgets.
- [ ] Agent runbooks for weapon + jungle only.

**Exit criteria:** 3 consecutive clean (M4 + jungle) runs without human patching; failure fixtures never mark `ready`.

---

## 8. Milestones & metrics

| Milestone | Metric |
|---|---|
| M0 | 10/10 batch assets Godot-ready; validation false-negative rate on broken fixtures = 0 for planted faults |
| M1 | Agent median steps to ready asset ≤ 3 tool calls (run/status/validate); script-paste path optional |
| M2 | M4 preset: clips ≥ 4 named; grip pivot error &lt; 2 cm vs spec; Godot import green |
| M3 | Jungle kit: ≥12 ready pieces; TD CV under kit threshold; snap errors = 0 on sample grid |
| M4 | Scene job: instance-only `.tscn`; mega-mesh detector trips on fused outputs; 2 light setups present |
| M5 | Three clean consecutive north-star demos; open P0 forge bugs = 0 |

Leading indicators (watch weekly):

- `% jobs → ready` without human intervention.
- Time Blender occupied per ready asset.
- Count of `ready` entries later reverted (should be ~0).
- Agent retries per success (should fall after Phase 1).

Do **not** optimize vanity: polycount flex, texture-res bragging, single beauty shots.

---

## 9. Risks

| Risk | Why it’s real | Mitigation |
|---|---|---|
| **Mega-mesh temptation** | Generative tools make “one jungle” look fast | Product rule + validator rejecting fused scene meshes; composer-only scene path |
| **Rubber-stamp QC** | Already bitten once (spec QC always green) | Artifact + Godot import mandatory for `ready` |
| **Blender session pollution** | Clip leakage / rest pose / orphans across jobs | One job per process; regression tests stay on |
| **Scope fantasy** | Genre undecided + two north stars can explode roadmap | Phases gate features; jungle after weapons; no game vertical slice |
| **Attachment combinatorics** | M4 graphs explode | Curated presets + constraints; not infinite marketplace parts |
| **Foliage performance** | Cards/instances can kill FPS | Budgets in SceneSpec; aggressive canopy LOD; Phase 5 caps |
| **Agent tool sprawl** | Old + new MCP tools confuse models | Job tools preferred in instructions; deprecate gradually, don’t duplicate quietly |
| **False “Godot-ready”** | Showcase hides collision/LOD siblings | Import check asserts; showcase hide rules remain tested |
| **In-house bus factor** | Pipeline knowledge in few heads | Schemas + this doc + runbooks; kit AUTHORING contract stays law |

---

## 10. Decisions & assumptions

### Decisions

1. Godot-first validation. 2. Composed scenes only (no blob scenes). 3. Jobs are the agent API (scripts = escape hatch). 4. Hero weapons require rigs/clips. 5. In-house — marketplace informs quality, not milestones. 6. Fail closed (`ready` only after gates). 7. Genre-neutral schemas (jungle/M4 are fixtures).

### Assumptions

Blender 4.2+/5.2 + kit add-on remain the production DCC; Claude Code/Cowork is the primary MCP client; local hardware only for Phases 0–5; humans art-direct kits while agents assemble/validate; Phase 4 water is kit meshes (no fluid sim); wind foliage is post-Phase 5. If Godot import semantics change, fix the profile/checks before new features.

---

## 11. Immediate next actions

Ordered for leverage, not excitement:

1. **Spec the ValidationReport + IndexEntry schemas** in-repo; write fixtures that fail on purpose.
2. **Implement artifact gates** calling into existing `godot-check` / GLB inspection; stop treating spec QC as ship.
3. **CLI batch forge → index.json** for a short list of catalog kinds (Godot profile only).
4. **Spike ForgeJob + `forge_run_asset` / `forge_job_status`** on filesystem worker (no composer yet).
5. **Draft WeaponGraph** for M4 preset (paper + schema only) against current rifle kit sockets — find gaps before modeling more parts.
6. **List jungle kit MVP pieces** (12 names, bounds, snap, collision intent) without building them yet.
7. **Update agent instructions** (MCP handler text) to prefer upcoming job tools and state Godot-first production bar — after tools exist, not before.

Do not start Phase 4 scene scatter or foliage cards before Phase 0–1 make `ready` trustworthy.

---

## 12. Related docs

| Doc | Role |
|---|---|
| `README.md` | How to run studio, MCP, Blender checks, Godot import |
| `CHANGELOG.md` | What 2.x actually shipped (incl. kit, rigs, Godot defaults, forged preview) |
| `REVIEW-2026-09-05.md` | Historical findings; many fixed — still useful as “what failure looks like” |
| `public/downloads/anvil_blender_addon/kit/AUTHORING.md` | Kit family contract (bounds, slots, clips) |
| Research: `production-ready-assets-brief.md` | Meters, pivot, collision, PBR, ≥2 lights, validation checklist |
| This file | North star, architecture, phased roadmap, exit criteria |

---

*End of design doc. Revisit after Phase 0 exit; resist rewriting the north star when a kit looks ugly — fix the kit.*
