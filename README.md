# Anvil

Production game asset MCP. A Three.js studio that turns a text brief into a game-asset spec, an MCP server at `/api/mcp` for Claude Code, a Blender add-on, and a local stdio MCP relay that talks to it.

## Commands

| Command | What it does |
|---|---|
| `npm install` | install dependencies |
| `npm run dev` | dev server at http://localhost:8080 |
| `npm run build` | production build (Nitro, Vercel preset) |
| `npm run preview` | serve the production build at http://localhost:8081 |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | protocol test of the local stdio MCP server (no dev server needed) |

## Layout

- `src/components/studio/` UI: studio shell, viewport, panels
- `src/lib/assets/` domain logic: spec inference, catalog, naming, pipeline, procedural builders, generated Blender scripts, glTF export
- `src/lib/mcp/` MCP server (Streamable HTTP) routed by `src/routes/api/mcp.ts`
- `public/downloads/` Blender add-on package (`anvil_blender_addon/`, zipped by `npm run build:addon`), local stdio MCP server, example Claude Code config
- `tools/` checks: generated Blender scripts, stdio server, MCP tools, studio in a browser, add-on packaging, and `tools/kit-check/` for authoring kit families

## How an asset is made

1. **Spec.** The brief becomes an `AssetSpec` (kind, engine, real-world dimensions, materials by role, budgets, naming). Godot is the default engine; a brief that names Unreal, Unity or Blender, or an explicit engine argument, overrides it.
2. **Geometry.** The generated build script runs in Blender. With the add-on installed, `anvil_blender_addon.kit` assembles the kind from parametric parts. All 22 prototypes have a family: the rifle, for instance, is a stock, a receiver with an ejection port and a magazine well, a grip and trigger group, a curved magazine, a handguard with Picatinny rails and vents, a barrel with gas block and sights, and fasteners. Blender without the add-on gets the old blockout instead, and so would any kind added to the catalog before its family is written. Either way the mesh gets bevels, smooth-by-angle, packed UVs, LOD1/LOD2, collision, engine naming and an optional GLB.
3. **Surfacing.** The generated bake script runs next. With the add-on installed, `anvil_blender_addon.surfacing` bakes mesh maps (AO, edges) from a denser high-poly copy, builds one procedural recipe per material slot (painted, blued or bare steel, polymer, rubber, wood, brass, leather, fabric, stone, moss, glass or generic; picked from the material name and metalness, or named in `SLOTS`), bakes albedo, roughness, metallic and a tangent normal, packs ORM or Unity Mask, saves PNGs, wires the textures into the materials and keeps each recipe as `<material>_recipe` for editing. `WEAR` and `DIRT` in the script set the weathering. Without the add-on it bakes a normal + AO with flat channels. Set `ANVIL_EXPORT_PATH` when running it to re-export the GLB with textures.

The studio previews the real thing when it can. If a GLB whose mesh name matches the current asset sits under `exports/`, the viewport loads that file with its baked textures and says so; a picker lists every forged file if you want to look at another one. With no match it draws the blockout from the spec, which is also what a deployed copy does, since it has no `exports/` folder. The kit and the surfacing themselves still run in Blender only.

### Writing a kit family

A family is one module in `public/downloads/anvil_blender_addon/kit/` that declares `KINDS` and a `build(kind, dim, roles, variant)` function; the kit discovers it automatically. `kit/AUTHORING.md` is the contract (exact bounding box, slots by role, budget after bevel, moving parts and clips) and `tools/kit-check/check-kit.py` is the authoring loop:

```
blender --background --python tools/kit-check/check-kit.py -- tools/blender-check/out/gen crate_unreal out/crate --rig --surface
```

It builds the case through the kit, checks dimensions, budget, slots and clips, writes `report.json`, and renders the rest pose from two sides, each demo clip, and the surfaced result.

### Animatable parts

Kit families tag their moving parts with vertex groups and describe the motion; the build script stores that description on the mesh as `anvil_parts` (JSON: bone, group, `slide` or `rotate`, pivot, axis, travel in metres or angle in degrees, and the demo clips). The rifle's moving parts are the charging handle, the bolt carrier behind the ejection port, the trigger, the magazine, the selector lever and, for a collapsible stock, the stock.

Set `ANVIL_RIG=1` when running the build script (or set `RIG_PARTS = True` in it) to get the rig as well: an armature `RIG_<mesh>` with a `root` bone and one bone per moving part (its Y axis along the motion, so a slide is `location.y` and a hinge is `rotation_euler.y` in pose space), rigid skinning, the LOD copies bound to the same armature, and one clip per motion stashed on muted NLA tracks (`cock_back`, `trigger_pull`, `magazine_release`, `selector_toggle`, `stock_collapse`). The GLB then carries the skin and the clips, and the bake script's re-export keeps them. Unreal imports it as a Skeletal Mesh with the clips as animation sequences (rename to the `SK_` prefix on import; the `UBX_` box is only used by static meshes); Unity and Godot get bone transforms to animate. The rig is off by default so the generation output stays a plain static mesh.

## Checking the generated Blender scripts

With `npm run dev` running and Blender 4.2+ installed:

```
node tools/blender-check/fetch-scripts.mjs
blender --background --python tools/blender-check/check-build.py -- tools/blender-check/out/gen tools/blender-check/out/build-report.json
blender --background --python tools/blender-check/check-bake.py -- tools/blender-check/out/gen sci_crate_unreal tools/blender-check/out/bake.json
```

Set `ANVIL_KIT_DIR=public/downloads` (the folder that contains the `anvil_blender_addon` package) to run the same checks through the part kit and the surfacing. Set `ANVIL_NO_ADDON=1` to force the blockout and plain-bake paths: Blender keeps its user add-ons folder importable even with `--factory-startup`, so an installed Anvil add-on would otherwise be picked up. The build check runs all 88 kind/engine scripts twice each next to user objects that must survive, and verifies dimensions, pivots, names, materials, UVs, LODs, collision and the exported GLB. The bake check runs the bake script at 128 px and verifies the images, the packing, the material wiring and the cleanup.

## Checking the engine import (Godot)

Godot is the default target and imports glTF natively, so the exported GLB can be verified in the engine itself, headless:

```
node tools/godot-check/check-import.mjs exports/
```

It creates a throwaway Godot project, imports every GLB it is given, and reports what the engine actually built: nodes, meshes and their surfaces and triangle counts, materials with the textures that reached them, the LOD meshes, the collision body, the skeleton and the animation clips. It finds Godot from `ANVIL_GODOT`, the PATH, or the WinGet package folder, and exits non-zero if an asset lost its textures or a rigged asset lost its clips.

To look at the assets in the engine rather than only check them, build a project and open the editor:

```
node tools/godot-check/open-project.mjs exports/godot-project exports/forge
```

It imports the assets and writes `main.tscn` with the set laid out on the ground under a sun and sky, camera framed on it, then launches the editor. Add `--no-open` to build the project without opening it. LOD copies and the collision proxies of exports aimed at other engines are hidden rather than deleted, so nothing overlaps but everything is still in the tree.

## Checking the local stdio MCP server

```
node tools/stdio-check/test-protocol.mjs public/downloads/anvil-mcp-server.mjs
```

End to end through the real add-on, with Blender installed (the host script drives the add-on's timer loop in background mode):

```
ANVIL_JOB_TIMEOUT=3 blender --background --python tools/stdio-check/addon-host.py -- public/downloads/anvil_blender_addon stop.flag 300
node tools/stdio-check/test-e2e.mjs public/downloads/anvil-mcp-server.mjs tools/blender-check/out/gen/sci_crate_unreal.py stop.flag
```

Or register it with Claude Code and check the connection: `claude mcp add anvil-blender -- node "<full path>/anvil-mcp-server.mjs"` then `claude mcp list`.

## Checking the MCP tools

With `npm run dev` running:

```
node tools/mcp-check/test-inference.mjs
node tools/mcp-check/test-http.mjs
```

`test-inference` checks kind and engine inference, titles, QC for every prototype and engine, the kit tool, the LOD table and the normal-map conventions. `test-http` checks the Streamable HTTP transport: 405 for the event stream, no session header, notifications unanswered, per-message errors in batches, argument validation, size caps and the loopback Origin guard.

## Checking the studio in a browser

With `npm run dev` running (Playwright's Chromium: `npx playwright install chromium` once):

```
node tools/studio-check/test-persist.mjs
node tools/studio-check/test-preview.mjs
node tools/studio-check/test-geometry.mjs
node tools/studio-check/test-engine-sync.mjs
node tools/studio-check/test-ui.mjs
node tools/studio-check/test-forged.mjs
```

`test-persist` changes engine, prototype and brief, reloads, and checks the state survived, then plants corrupt and partial storage entries and checks the app falls back instead of crashing. `test-preview` measures viewport pixels across Lit, Clay, Wire and Unlit, checks Lit restores, that the WebGL context survives asset switches, and inspects the downloaded GLB's material factors and texture tiling. `test-geometry` downloads the GLB for twelve prototypes and checks node and material names, the collision node, and that every LOD's bounds equal the spec dimensions and pivot. `test-forged` checks the `/api/forged` endpoint, including its refusal to serve anything outside `exports/`, and that the viewport shows a forged GLB when one exists and the blockout when it does not.

## Status

See `REVIEW-2026-09-05.md` for the verified findings list and the order of work, and `CHANGELOG.md` for changes.
