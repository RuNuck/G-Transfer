# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.9.2] - 2026-09-14

### Fixed

- The inspector's LOD row counts the forged GLB when the viewport is showing one. It rebuilt the spec's blockout and printed that mesh's triangles next to a forged preview, so the forged oil lantern read `LOD0 · 392 / 3000` while the viewport drew 2,856. The viewport now reports the triangles per LOD of the file it loaded, and a level the file does not carry, such as LOD1 and LOD2 of a Godot export (Godot builds its own on import), shows `—` instead of borrowing a blockout number. Back on the blockout, the row shows the blockout's counts again. `tools/studio-check/test-forged.mjs` checks both directions.

## [2.9.1] - 2026-09-14

### Added

- The Node tools read machine-specific settings (`ANVIL_BLENDER`, `ANVIL_GODOT`, `ANVIL_KIT_DIR`) from a `.env` at the project root, so Blender and Godot are found on a machine where neither is on the PATH without setting anything user- or system-wide. `tools/load-env.mjs` loads it for the forge runners (through `tools/forge-run/find-dcc.mjs`) and for `tools/godot-check/check-import.mjs` and `open-project.mjs`; the processes they spawn inherit the values. A value already set in the shell wins and a missing file is ignored. `.env` stays gitignored and `.env.example` lists the keys. It is a module rather than npm config because Node refuses `--env-file` in `NODE_OPTIONS`.

## [2.9.0] - 2026-09-05

### Added

- The studio previews the asset Blender actually forged, instead of always drawing its own blockout. When a GLB whose mesh name matches the current asset exists under `exports/`, the viewport loads it with its baked textures; a picker in the corner lists every forged file so any of them can be shown, and Rescan looks again without a page reload. The overlay says which is on screen and names the mesh, so a hand-picked file is never mistaken for the asset the panels describe. Without a matching file, or in a deployed copy with no `exports/` folder, it falls back to the blockout exactly as before.
- `/api/forged` lists the GLBs under `exports/` and serves their bytes. It is read-only, refuses anything that resolves outside that folder or is not a `.glb`, skips engine projects so their copies are not listed twice, and reports nothing at all when there is no exports folder.
- `tools/studio-check/test-forged.mjs` covers the endpoint (listing, byte-for-byte serving, four path-escape attempts, non-GLB paths) and the viewport (blockout by default, switching to a forged file, switching back, LOD selection inside a file that has a LOD chain, and a manual pick being dropped when the asset changes).

### Fixed

- The viewport reads the glTF node name behind each primitive. A mesh with several materials loads as a group of one mesh per material named `<node>_0`, `<node>_1`, which moved the `_LOD1` and collision suffixes off the name being tested: every LOD drew at once and the rifle reported 9,787 triangles instead of 6,340.
- Collision proxies are hidden in the preview whatever engine named them, including Godot's `-convcolonly` suffix, which otherwise drew a plain box over the whole asset.
- The camera frames what is on screen rather than the spec's dimensions, so a hand-picked file of a different size is not left tiny in the corner.

## [2.8.2] - 2026-09-05

### Fixed

- The dev server no longer dies when an engine project is built under `exports/`. Vite watched everything outside `node_modules`, including a Godot project's `.godot` import cache, which rewrites and briefly locks files as it imports; the watcher hit `EBUSY` on a half-written texture and took the whole server down. `exports/` and any `.godot` folder are now excluded from the watcher, and they hold forged assets and their bakes rather than source, so nothing needs reloading when they change.

## [2.8.1] - 2026-09-05

### Fixed

- Godot exports no longer carry the manual LOD chain. Godot builds its own LODs at import and has no notion of an exported one, so `_LOD1` and `_LOD2` arrived as ordinary sibling meshes and drew three copies of the asset on top of each other. The LOD objects still exist in the scene and the other engines still get them in the file; only the Godot export omits them. `tools/blender-check/check-build.py` checks both sides of that rule.
- The armature is put back to its rest pose after a glTF export. The exporter evaluates each NLA track as it writes that clip and leaves the last one applied, so a forged asset was left deformed in the open file: the chest sat with its hasp swung 90 degrees out, its measured depth 0.83 m instead of 0.70 m, and the next clip comparison saw no movement because its baseline was already posed.
- `tools/godot-check/build-showcase.gd` hides what is not the render mesh: LOD copies, and the collision proxies that an Unreal or Unity export brings in as ordinary meshes (`UBX_`, `UCX_`, `USP_`, `UCP_`, `COL_`). The nodes stay in the tree so they can be switched back on. It marks each instance editable first, without which Godot silently drops the change on save.

## [2.8.0] - 2026-09-05

### Added

- `tools/godot-check/open-project.mjs` with `build-showcase.gd`: turns exported GLBs into a real Godot project and opens the editor on it. It copies the assets in, imports them, and builds `main.tscn` with every asset laid out in a row on the ground, lit by a sun and a procedural sky, with the camera framed on the set. `--no-open` builds the project without launching the editor. The existing `check-import.mjs` still does the headless verification; this one is for looking at the assets in the engine.

## [2.7.1] - 2026-09-05

### Fixed

- Animation clips leaked between assets forged in the same Blender session. The glTF exporter defaults to exporting every action in the file that fits the armature, so a helmet came out of the engine carrying the chest's `open` and `unhasp` clips. The export now names `NLA_TRACKS`, which writes only the stashed clips of the armature being exported.
- Clip names are stable across a session. Blender uniquifies an action name that is already taken, so a second asset's `open` became `open_001` and no longer matched what an engine would look for. The clip takes its name from the rig spec's track rather than from the uniquified action datablock.

Both were found by forging five assets back to back in one live Blender session and importing the results into Godot, not by the headless checks, which build one asset per process.

## [2.7.0] - 2026-09-05

### Added

- Part-kit families for the whole catalog: all 22 prototypes are now built from real parts instead of a blockout. `crate.py` (shipping crate, sci-fi supply crate), `chest.py` (banded loot chest, ammo can), `barrel.py` (oil drum, potion flask), `blade.py` (longsword, dagger), `pistol.py`, `armour.py` (kite shield, closed helm), `masonry.py` (fluted pillar, running-bond wall), `passage.py` (stair module, bulkhead door), `industrial.py` (pipe T-junction, ceiling vent), `lantern.py`, `hoverbike.py` and `mannequin.py` join the rifle family. Moving parts and demo clips come with them: chest and crate lids, latches and hasps, the ammo can's folding bail, a potion cork, the pistol's slide, trigger, magazine and hammer, the helmet's visor, the door leaf and its pressure wheel, the vent grille, the lantern's bail and wick knob, the hover bike's handlebars and thrust nozzles.
- Bones can name a `parent` in the rig spec, so a part mounted on another moving part rides along: the ammo can's carry handle now swings away with its lid instead of hanging in the air. Every bone still defaults to the root, and an unknown or circular parent falls back to it with a printed warning rather than dropping the bone.
- Families are discovered, not registered: any module in `kit/` that declares `KINDS` and `build(kind, dim, roles, variant)` is picked up, and one broken module cannot take the kit down. `kit/AUTHORING.md` is the contract.
- `ops.py` grew the vocabulary the new families needed: `ellipse`, `diamond` and `lens` profiles, `loft_points` and `loft_shape`, `cone`, `sphere`, `torus`, a general `revolve` around any axis, `rounded_box` on any axis, `ribs` along any axis, `mirror`, `translate`, `tag_part`, and `boolean_cut` taking several cutters.
- `tools/kit-check/check-kit.py`: the authoring loop for a family. Builds one case through the kit, checks dimensions, budget, slots, moving parts and clips, writes `report.json`, and renders the rest pose from two sides, every demo clip and the surfaced result.
- `tools/godot-check/check-import.mjs` with `report.gd`: imports exported GLBs into a throwaway Godot 4 project headless and reports the nodes, meshes, surfaces, triangle counts, materials and their textures, LODs, collision body, skeleton and animation clips that the engine actually built.
- A `moss` surfacing recipe (moss, lichen, grass, ivy and similar material names): clumped organic growth broken up by noise, thickest in cavities and on upward faces, thinning to a stain of its own colour. The stone kit's Moss slot used to bake as flat green paint.

### Fixed

- Hard black bands where two parts of an assembly meet. A face that straddles an intersection gets no valid bake sample, because its ray leaves into the neighbouring part and finds only backfaces, and the bake was clearing unreached texels to black. Each pass now pre-fills its own neutral instead of clearing (white for AO, the slots' average colour, roughness and metalness for those channels, a flat normal for the normal map), and the normal map's pathological texels are replaced afterwards. On the mannequin this took the black area from 3 % of the surface to none. It affected every part-assembled asset, most visibly the ones with interpenetrating pieces.
- `ops.boolean_cut` rolls back a cut that returns an empty mesh and says so, so a family cannot silently ship a part the exact solver deleted. Blender's exact boolean can fail this way on awkward input; a cutter made of many loose shells is the usual trigger, and the authoring guide now tells families to pass one cutter object per hole.
- `ops.mirror` actually mirrors. It duplicated the geometry in place and then mirrored only the vertices, so a part came back with a coincident copy of itself plus a cloud of loose points and no mirrored faces. Loose vertices still count toward a bounding box, so the size check passed while the asset was one-sided: the hover bike was missing a thruster nacelle and half its repulsor pods. `bmesh.ops.mirror` duplicates what it is given, so the whole geometry is passed and the new faces are wound back the right way. The triangle count is unchanged, because the wasted coincident copy is replaced by the real mirrored half.
- The high-poly for a mesh with no bevel subdivides once rather than twice, so it stays closer to the low-poly it is baked onto.
- `tools/blender-check/check-bake.py` measures atlas use from the UV islands rather than from painted texels, which the pre-fill would otherwise make meaningless.
- The generated build script no longer crashes on convex collision: `bmesh.ops.convex_hull` returns overlapping interior and unused geometry, and deleting a vertex twice raised `ValueError: geom: found the same (BMVert/BMEdge/BMFace) used multiple times`. This hit any asset with `convex` collision once its geometry was dense enough.
- Godot's collision node is named `<mesh>_col-convcolonly`, so the imported StaticBody3D is `<mesh>_col` instead of taking the render mesh's own name and forcing Godot to rename one of them.
- Cavity grime is a dark brown rather than near-black, so deep crevices read as dirt instead of holes.
- Triangle budgets across the catalog are raised to what a part-built asset needs while staying inside the QC envelope for its category (props and weapons 3000, architecture 4000, vehicles and hero 8000): the door at 4000 and the shotgun at 8000 were the two that a kit build exceeded. The vent's LOD2 budget goes to 220, because decimation collapses edges but never merges separate shells and its louvres, screws and frame pieces floor out at about 163 triangles however hard they are reduced.
- `tools/blender-check/check-build.py` and `check-bake.py` purge a stale `anvil_blender_addon` module before importing, and take `ANVIL_NO_ADDON=1` to force the blockout and plain-bake paths on a machine where the add-on is installed (Blender keeps the user add-ons folder importable even under `--factory-startup`).

## [2.6.0] - 2026-09-05

### Changed

- Godot is the default engine: the studio opens on Godot, the MCP tools use it when a call names no engine and the brief mentions none, and the engine list starts with it. `DEFAULT_ENGINE` in `src/lib/assets/types.ts` is the single place to change it. Existing saved studio state keeps whatever engine it had. The three browser and inference checks that assumed the Unreal default were updated with it; `test-geometry` now asks the MCP for the same default the page uses instead of naming an engine, and `test-engine-sync` still covers Unreal and Unity naming.

## [2.5.0] - 2026-09-05

### Added

- Animatable parts. The rifle family tags its moving parts (charging handle, bolt carrier, trigger, magazine, selector, and the stock when it is collapsible) with vertex groups that survive the join, and describes each motion (pivot, axis, travel or angle) in a rig spec that the build script stores on the mesh as `anvil_parts` for later rigging. `kit/rig.py` turns that spec into an armature `RIG_<mesh>` (a root bone plus one bone per moving part, its Y axis along the motion, rigid skinning with every other vertex on root, the LOD copies skinned too, meshes parented to the armature) with demo clips stashed on muted NLA tracks: `cock_back` (handle and bolt), `trigger_pull`, `magazine_release`, `selector_toggle`, `stock_collapse`. The glTF export carries the skin and the clips. The rig is off by default; set `ANVIL_RIG=1` in the environment (or `RIG_PARTS` in the script) to build it, and the bake script includes the armature when it re-exports.
- New rifle parts: a bolt carrier visible through the ejection port and a selector lever on the left of the lower receiver, both inside the spec's bounding box.

### Changed

- `kit.build_parts()` returns `rig` next to `parts` and `finishing`; kit families return that third value. Re-running a build removes the previous armature and its clips along with the collection.

## [2.4.0] - 2026-09-05

### Added

- Part kit. The Blender add-on is now a package (`public/downloads/anvil_blender_addon/`, installed from `anvil_blender_addon.zip`) that ships `kit/`: parametric bmesh parts (lofts of rounded profiles, revolves, boxes, cylinders, Picatinny rails, ribs, fasteners, exact boolean cuts) and a rifle family (stock, receiver with ejection port, magazine well, pins, charging handle, grip with serrations, trigger group, curved magazine with floorplate and ribs, handguard with top and bottom rails and vents, barrel with gas block and muzzle, front and rear sights); the shotgun kind uses the same family with a fixed stock. The generated build script assembles the kit when the add-on is importable, keeps the spec's exact bounding box, material slots by role, bevels, LODs, collision and naming, and reports "(part kit)" in its result; without the add-on, or for kinds with no family yet, it builds the blockout as before.
- Surfacing tool (`anvil_blender_addon/surfacing/`). Bakes AO and an edge map (bevel probe, convexity, concavity) from the high-poly copy, builds one procedural recipe per material slot (painted, blued or bare steel, polymer, rubber, wood, brass, leather, fabric, stone, glass, generic; picked from the material name and metalness or named in the script's `SLOTS`) with 3D noise in object space, edge wear, scratches, cavity grime and dust on upward faces, then bakes albedo, roughness, metallic and a tangent normal that includes the recipe's micro bump, packs ORM or the Unity Mask, saves the PNGs and the mesh maps under `maps/`, wires the textures into the mesh's materials (with the glTF occlusion hook) and keeps each recipe as `<material>_recipe` for editing. The generated bake script calls it when the add-on is installed, exposes `WEAR`, `DIRT`, `SEED` and `SLOTS`, re-exports the GLB with textures when `ANVIL_EXPORT_PATH` is set, and falls back to the plain normal + AO bake otherwise.
- `tools/build-addon-zip.mjs` (`npm run build:addon`, also run before `dev` and `build`) packages the add-on without dependencies; the Connect panel and the `anvil://blender/addon` resource link to the zip and tell users to remove an older single-file install.
- `tools/blender-check/check-build.py` and `check-bake.py` take `ANVIL_KIT_DIR` to run the same checks through the kit and the surfacing, and `ANVIL_NO_ADDON=1` to force the blockout and plain-bake paths on a machine where the add-on is installed; the bake check now verifies UV coverage, channel means against the area-weighted spec, recipe materials, texture wiring and cleanup, and runs at 128 px.

### Changed

- UV island margins drop from 2 % / 3 % to 0.4 % (UV0) and 1.2 % (lightmap UV1) and the islands are repacked with the bounding-box packer (cardinal rotation; the exact-shape packers took 10-30 s on the kit rifle); the rifle's atlas coverage went from roughly a third to two thirds, so bakes get their texel density.
- Rifle triangle budget is 8000 / 2600 / 650 (was 6500 / 2200 / 520) so the kit build fits LOD0 inside the weapons envelope.
- Bake samples default to 16; the surfacing spends them on AO and uses fewer for the emission and normal passes. The add-on's `bl_info` version is 2.4.0.

### Fixed

- Boolean cuts in the kit keep a single material slot (exact solver, index material mode, slots reset after apply), so joined parts no longer carry an empty material slot into the export.

## [2.3.4] - 2026-09-05

### Fixed

- Generated build and bake scripts no longer set `Material.use_nodes` on Blender 5.x, where materials are always node-based and the property is deprecated for removal in 6.0; the assignment is kept for Blender 4.x, which still needs it.

## [2.3.3] - 2026-09-05

### Added

- `tools/studio-check/test-ui.mjs`: mobile log tab, tap-target sizes, label contrast, accessible brief, and the library section.

### Fixed

- On phones the MCP log is reachable from a Log tab in the bottom bar instead of being hidden; engine, catalog, category, view-mode, LOD and library buttons are at least 44 px tall on small screens.
- Small labels use a lighter muted colour that meets the 4.5:1 contrast ratio on the dark surfaces; the brief input has an accessible name.
- The studio subscribes to the slice of state it renders and the log has its own subscriber, so a log line no longer re-renders the whole tree including the viewport.
- The library is usable: a Saved section in the Kit panel lists saved assets with load and remove; re-picking the same prototype replaces its entry instead of adding a duplicate; removing the current asset selects the next saved one.
- The font file host is preconnected alongside the stylesheet host.
- `npm test` runs the stdio server protocol test (no dev server needed); the browser, MCP and Blender checks stay under `tools/` and are documented in the README.

## [2.3.2] - 2026-09-05

### Added

- `tools/mcp-check/test-http.mjs`: transport-level test of the HTTP MCP server.

### Fixed

- HTTP MCP server: a GET with `Accept: text/event-stream` returns 405 (the server has no server-to-client stream) instead of holding a never-ending response open, which on Vercel held a function invocation per connected client.
- One throwing message no longer turns into an HTTP 500 that drops a whole batch: each message is answered on its own, tool argument problems as -32602 and unexpected failures as -32603.
- Tool arguments are validated against their schemas: unknown engines or kinds, missing or non-string briefs and themes, non-numeric grids and briefs over 4000 characters are rejected with -32602 instead of being silently replaced. Unknown tools use -32602; a missing resource uri or prompt name is -32602.
- Notifications are never answered, whatever their method. Session ids are no longer minted or echoed; the server is stateless and says so.
- Request bodies are capped at 1 MB (413) and batches at 50 messages; PUT, PATCH and HEAD reach the handler and get 405 instead of the app's HTML page.
- A loopback server refuses requests whose Origin is another site (DNS-rebinding guard).

## [2.3.1] - 2026-09-05

### Fixed

- Blender add-on (`public/downloads/anvil_blender_addon.py`, version 2.3.1): nothing listens until you press Connect (an opt-in "Start on launch" preference restores the old behaviour); requests must carry the token the add-on writes to `~/.anvil/token`, which the local server reads automatically; each job has its own id and a timed-out job is cancelled instead of handing its result to the next request; scripts may run for the configurable Script timeout (10 minutes by default) while the add-on sends keepalives, so long bakes no longer fail at 15 seconds; requests are newline-framed and decoded once, so multibyte payloads over 4 KB work; print output is captured and returned; scripts run with `__name__ == "__main__"`; `sys.exit()` in a script is contained instead of trying to close Blender; the per-poll timer leak is gone; reads time out, handler threads are bounded, the port is bound exclusively on Windows, an accept-loop error is shown in the panel, and Disconnect then Connect cannot register two drain timers.
- Local MCP server (`anvil-mcp-server.mjs`, 2.3.1): sends the token, tolerates keepalives, reports captured output, waits up to 10 minutes overall with a 30-second idle limit, and explains missing or wrong tokens.

### Changed

- The Connect panel and the `anvil://blender/addon` resource describe the token file and the Connect-first behaviour.

## [2.3.0] - 2026-09-05

### Added

- `tools/mcp-check/test-inference.mjs` (routing, engines, titles, QC, kit, LOD table, normal conventions through the live MCP endpoint) and `tools/studio-check/test-engine-sync.mjs` (header engine switch re-targets the asset and persists).

### Fixed

- Kind inference matches whole words and phrases and lets the longest match win, so "oil lantern" is a lantern, "ammo box" an ammo can, "Sidearm" a pistol, and fragments inside words ("pumpkin", "science", "community") no longer route to unrelated prototypes. Every catalog brief now infers its own kind.
- An explicit engine (the header tab, or the tool's `engine` argument) is never overridden by words in the brief; the engine is inferred from the brief only when none is given.
- Asset names no longer split on decimal points or keep filler ("make me a"), sizes or engine names; "A 1.2 m tall rusted barrel, Unreal" becomes "Tall rusted barrel". Names that would slug to nothing fall back to the prototype name.
- Switching the header engine re-targets the current asset, so the Inspector, pipeline notes and saved state agree with it.
- Default PBR values obey the tool's own rules: paint, rust and olive drab are dielectrics, the emissive lamp is not metal.
- Every weapon-category prototype (blades, guns, shield, helmet) pivots at its centre of mass, matching the QC rule and the Blender script; the shield's texel density is raised to the hero minimum.
- QC computes what it claims: scale sanity, pivot by category, budget envelope by category, texel minimum, engine naming rules, LOD ratios, and dielectric/metal consistency; the two items that are conventions rather than checks (forward axis, UV rules) are shown as notes and no longer count toward "passed". The hover bike and mannequin prototypes pass the envelope legitimately (vehicle budget, hero texel density).
- One LOD screen-size table feeds forge_lod_plan and every engine note; the atlas size the QC quotes is the one the bake script uses.
- Unreal's DirectX normal-map convention is stated in the PBR rules, texture notes and engine notes; Unity and Godot are marked as OpenGL, no flip.
- forge_kit_module honours its grid and theme: the wall script it returns is sized to the grid and named after the theme.
- Material seeds derive from the brief alone, so the same brief gets the same default colours in every engine.

## [2.2.3] - 2026-09-05

### Fixed

- Built assets match the spec dimensions the HUD, QC and Blender script quote: every blockout is fitted to the spec's bounding box and placed per its pivot (bottom kinds rest on the ground, weapons are centred), where previously 12 of 22 prototypes deviated by more than 10% and 9 floated or sank.
- The GLB download carries engine naming (mesh, per-part meshes, materials), all three LODs as `<mesh>`, `<mesh>_LOD1`, `<mesh>_LOD2`, and the spec's collision primitive (box, sphere, capsule or convex hull) under its engine name, so the file agrees with what the QC panel says.
- The Inspector's LOD buttons show the real triangle count next to the budget instead of the budget alone.

## [2.2.2] - 2026-09-05

### Fixed

- Preview materials no longer apply albedo and roughness twice. The colour map carries the albedo and the roughness map carries the roughness, with the material factors at 1, so models render at their real brightness instead of near-black, and exported GLBs carry the right values (previously colour squared and roughness multiplied by itself).
- The roughness map is a linear data texture instead of being tagged sRGB, and both maps tile the same way, in the viewport and in the exported GLB.
- Switching back to Lit after Clay, Wire or Unlit restores the original materials; the viewport captures each material's lit state and reapplies it.
- Unlit is now unlit: it shows the albedo with no lighting instead of a flattened lit render.
- The viewport builds each asset once (the triangle count comes from the same build), keeps one WebGL context across assets with a camera that re-frames itself, renders on demand instead of continuously, and no longer uses the deprecated soft shadow map type. Small assets are framed at their real size and the grid scales with the asset.
- The procedural texture cache is bounded and disposes what it evicts; swapped view-mode materials are disposed with their mesh.

## [2.2.1] - 2026-09-05

### Fixed

- Saved state survives reloads. The studio's mount effect wrote to the store before the persisted state was read back, and the persist middleware saves the whole state on every write, so every reload reset the engine, brief, current asset and library to the defaults. Hydration now runs before the first write, and the store's storage refuses writes until hydration has happened, so no effect ordering can reintroduce the bug.
- Persisted data is validated on load: unknown kinds or engines, malformed dimensions, materials or budgets fall back to catalog values or are dropped instead of being rendered blindly, and the storage entry carries a version for future migrations.

### Added

- `tools/studio-check/test-persist.mjs`: a browser test that reproduces the reload bug and the corrupt-storage cases.

## [2.2.0] - 2026-09-05

### Fixed

- The downloadable local MCP server (`public/downloads/anvil-mcp-server.mjs`) speaks the MCP stdio transport, newline-delimited JSON-RPC, instead of LSP Content-Length framing, so Claude Code can initialise it. Verified with the real Claude Code client and end to end through the Blender add-on running inside Blender.
- Tool failures come back as tool results with `isError` and a remediation message (open Blender, enable the add-on, press Connect) instead of raw socket errors; invalid arguments and unknown tools return JSON-RPC -32602, unknown methods -32601, parse errors -32700, and batches are answered as arrays.
- Every relayed job carries a unique id, so a timed-out script can no longer hand its result to the next request.
- The relay waits 60 s by default (`ANVIL_BLENDER_TIMEOUT_MS`, or `timeout_ms` per call), so the add-on's own limit is reported truthfully instead of blaming the connection after 15 s.
- The Connect panel's probe reports HTTP and JSON-RPC failures instead of "OK undefined vundefined", and the copy buttons no longer throw when the clipboard is unavailable.

### Added

- `tools/stdio-check/`: a protocol test that spawns the stdio server and checks every reply, and an end-to-end test that runs a generated script through the real add-on hosted in headless Blender.

### Changed

- Local tools are `blender_run_python` and `blender_ping`; the weaker local `forge_blender_script` is gone because the HTTP server's forge tools generate the scripts. Local server version 2.2.0.
- The remote `blender_execute` tool no longer pretends to relay anything: it returns an error result pointing at `blender_run_python`. The initialize instructions, prompts, pipeline steps, the `anvil://blender/addon` resource, the Connect panel and the example config now describe the two-server setup, name the add-on exactly, and require Node.js 18+ and the full path to the `.mjs` file.

## [2.1.0] - 2026-09-05

### Fixed

- Generated Blender build scripts compile and run on Blender 4.2+ and 5.2: the material block was indented at module level (a syntax error in every script), `use_auto_smooth` was removed in Blender 4.1 (now `shade_smooth` + `shade_smooth_by_angle`), and the emissive block referenced an undefined variable and a non-existent `Material.emission` (now the Principled BSDF Emission Color / Strength sockets).
- `smart_project` receives radians, not degrees; the unwrap angle is 66 degrees as intended instead of being clamped to 90.
- Pivots are implemented: "bottom" kinds rest on z = 0 with the origin at the ground contact, "center" kinds are centred on the origin.
- Collision meshes match the render mesh bounds (the previous cube was half size and floated above the asset), use the spec's shape (box, sphere, capsule, convex hull) and share the render mesh's pivot.
- All spec materials are assigned under engine-style names and actually placed on faces (parts of multi-part blockouts, bevelled edges for trim, top/bottom/side faces by role), so every slot survives glTF export instead of only the first.
- LOD copies apply the bevel before decimating, only decimate when over budget, sit at the origin instead of being offset on X, and display as wireframe.
- The script ends with the export set (mesh, LODs, collision) selected and exports a GLB when `ANVIL_EXPORT_PATH` is set.
- Briefs and names are embedded as escaped string literals and one-line comments, so quotes, backslashes or newlines in a brief cannot break the script.
- The bake script bakes normal and AO from a denser high-poly copy (selected-to-active with a cage), into Non-Color images, composes the ORM or Unity Mask map, writes a flat albedo placeholder, saves PNGs, and cleans up after itself.
- Godot collision objects use the `-convcolonly` suffix the Godot importer recognises; Unreal collision prefixes follow the shape (UBX_/USP_/UCP_/UCX_). Naming resources and engine notes updated to match, and the Blender note no longer recommends the removed Auto Smooth control.

### Added

- `tools/blender-check/`: fetches every generated script from a running dev server and executes them in headless Blender with assertions on geometry, pivot, names, materials, UVs, LODs, collision, GLB contents and the bake outputs.

### Changed

- Build scripts create everything inside an `Anvil_<mesh>` collection and never delete objects outside it; re-running replaces only the previous Anvil build.
- The Blender add-on receives a `result` summary from generated scripts (mesh, triangle counts, collision, pivot, export path).

## [2.0.0] - 2026-09-05

### Removed

- The xAI "Art direct" feature: the server function that called the xAI chat API (`src/lib/ai/expand-brief.ts`), the Art direct checkbox in the studio, and its persisted setting.
- Grok Build platform scaffolding the app never used: the branding/PWA injector and install page (`scripts/grok-pwa-*`, `server/`, `public/__grok/`), `.grok/`, `AGENTS.md`, `startup.sh`, brand-check and browser-smoke QA scripts, the env wrapper, gate sign-in and Better Auth (`src/lib/auth/`), PGLite/Postgres database helpers (`src/lib/db.ts`, `migrations/`, migrate scripts), the app-data connector client, the multiplayer P2P library, the preview host bridge, Grok QA screenshots and generated images, and all of their tests.
- Dependencies that only the removed scaffolding used: `@electric-sql/pglite`, `better-auth`, `jose`, `kysely`, `pg`, `@types/pg`.

### Changed

- npm scripts call Vite directly (`vite dev`, `vite build`, `vite preview`), so they work on Windows; `db:migrate`, `check:auth`, `preview:restart` and `preview:stop` are gone.
- The dev server listens on localhost:8080 instead of 0.0.0.0:8080.
- Share-card meta tags (`og:*`, `twitter:card`) are now set in the root route instead of being injected by the platform.
- The downloadable example MCP config uses a neutral placeholder host.
- `npm test` now targets `src/**/*.test.ts` (no tests exist yet; see the review for the order of work).

### Added

- `README.md` with the commands and layout.

## [1.0.0] - 2026-09-05

Baseline entry. This is the Anvil workspace as exported from Grok Build (the version constant in `src/lib/mcp/protocol.ts` and the Blender add-on's `bl_info` both report 1.0.0). No source changes were made when this file was created; it exists so that future changes have a place to be recorded.
