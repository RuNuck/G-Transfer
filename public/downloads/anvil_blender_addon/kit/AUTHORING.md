# Writing a kit family

A family is one module in this package that turns an Anvil spec into real parts for one or
more kinds. The generated build script does the rest: it joins the parts, bevels, smooths,
unwraps, makes LODs and collision, names everything for the engine, exports, and (in the
bake script) surfaces the result with the procedural recipes. A family only has to make
clean geometry with the right slots, and describe what moves.

## Contract

```python
KINDS = ("crate", "sci_crate")           # kinds this module serves

def build(kind, dim, roles, variant=None):
    ...
    return parts, finishing, rig
```

- `dim` is a `Vector` in metres, Z up: `dim.x` is the spec's X, `dim.y` the spec's depth
  (spec Z) and `dim.z` the height (spec Y). A rifle is long along X; a sword stands along Z.
- **The bounding box of all parts together must equal `(dim.x, dim.y, dim.z)`** within 3 %
  or 6 mm. Rest the asset on `z = 0`; placement in X and Y does not matter, the script
  re-pivots. The QC promise is "real-world size", so a part that sticks out breaks it.
- `roles` maps `primary`, `secondary`, `trim`, `emissive`, `glass` to material slot indices
  (missing roles fall back sensibly). Every builder takes a `slot`; give each part the role
  that matches the spec's material list (read the case JSON to see which names exist).
  Every slot in the spec must end up on some faces, or the material is dropped at export.
- `parts` is the list of objects the builders returned, in the active collection, all with
  their origin at the world origin. Never scale objects; build geometry at size.
- `finishing` is a dict of hints: `{"bevel": (width_m, segments), "smooth_angle": degrees}`.
  The script bevels every edge sharper than 30 degrees with these values, which is what
  turns boxes into believable hard-surface parts. Optional `sockets`: a list of
  `{"name": "grip", "location": [x, y, z]}` in **build coordinates**. The build script
  emits Empty objects (parented after re-pivot) so weapon GLBs keep an intentional grip /
  hand_socket node after parts are joined — never patch the GLB after export.
- `rig` is `{"bones": [...], "actions": [...]}` (see Moving parts) or `{"bones": [], "actions": []}`.
- `variant` is an optional dict for options a brief may select later (`{"stock": "fixed"}`).

## Budget

The spec's `triangleBudget.lod0` applies **after** the bevel modifier, which roughly doubles
a box's triangle count and adds more on cylinders. Keep the raw geometry at about 40 % of
the budget and check the real number with the harness. Spend triangles on the silhouette and
on details the camera sees at first-person distance; a 12-triangle box reads as a rivet from
a metre away. Use 8 to 16 segments on small cylinders, 24 on big ones.

LOD2 has a floor the full regression will catch: decimation collapses edges but never merges
separate shells, so an asset made of many small loose pieces (louvres, rivets, slats) cannot
go below roughly four triangles per shell however hard it is decimated. If
`tools/blender-check/check-build.py` reports LOD2 over budget while LOD0 is comfortable, the
family has too many loose pieces for that budget: merge some into the body, or say so and the
catalog budget gets the headroom.

## Helpers (`ops.py`)

Profiles: `rounded_rect(w, h, r, corner_segments)`, `ellipse(w, h, n)`, `diamond(w, h)`,
`lens(w, h, n)`. Lofts: `loft_points(name, rings)`, `loft(name, frames)` (rounded
rectangles, frames of `(center, u, v, w, h, r)`), `loft_x(name, sections)`, `loft_shape(name,
frames, shape, axis=...)` for any profile. Primitives: `box`, `rounded_box(..., axis=)`,
`cylinder`, `cone`, `sphere`, `torus`, `revolve(name, [(t, radius), ...], axis=)`. Repeats:
`rail`, `ribs(..., axis=)`, `fasteners`. Edits: `mirror(ob, axis)`, `rotate_about_center`,
`translate`, `boolean_cut(target, cutter or [cutters])` (exact solver; a few cuts per part
are fine, dozens are slow). Rig: `tag_part(ob, bone)`.

Cutting holes: give `boolean_cut` a list with one cutter object per hole rather than a single
cutter made of many loose shells. The exact solver copes with separate cutters far more
reliably, and `ops.fasteners` in particular builds one mesh of many cones, which makes a poor
cutter. A cut that empties its target is rolled back with a printed warning, so a failed
boolean leaves the part uncut instead of deleting it, but the warning means the hole is missing.

Rules: do not edit `ops.py`, `rig.py` or `__init__.py` from a family; put private helpers in
the family module. Do not create materials, use `bpy.ops` directly, or leave extra objects
behind: the cutters are removed by `boolean_cut`, everything else you make must be in
`parts`. Rings passed to a loft must all have the same point count and never collapse to a
point (use a tiny size instead of zero).

## Moving parts

Tag each moving part's objects with `ops.tag_part(ob, "bone_name")` (several objects may
share a bone) and describe the motion:

```python
bones.append({"bone": "lid", "group": "lid", "motion": "rotate", "pivot": [x, y, z],
              "axis": [1, 0, 0], "angle": -95.0, "label": "open", "length": 0.05})
# or "motion": "slide" with "travel": metres along the axis
bones.append({"bone": "handle", "group": "handle", "motion": "rotate", "pivot": [x, y, z],
              "axis": [1, 0, 0], "angle": -90.0, "label": "lift", "parent": "lid"})
actions = [{"name": "open", "parts": ["lid"], "keys": [(1, 0.0), (12, 1.0)]}]
```

Add `"parent": "<other bone>"` when a part is mounted on another moving part, so it rides
along: a handle bolted to a lid swings away with the lid. Without it every bone hangs off
root and the handle would stay behind.

The pivot is the hinge or the part's centre in build coordinates; the bone points along the
axis. A rotation follows the right-hand rule about the axis; a slide moves along it. Sign
mistakes are normal: run the harness with `--rig` and look at the clip render. Keys are
`(frame, fraction of travel or angle)` at 24 fps.

## Checking a family

Fetch the generated scripts once (`node tools/blender-check/fetch-scripts.mjs`, dev server
running), then iterate:

```
blender --background --python tools/kit-check/check-kit.py -- tools/blender-check/out/gen crate_unreal out/crate --rig --surface
```

Read `out/crate/report.json` (dimensions, LOD0 triangles against the budget, slots used,
moving parts, clip vertex counts) and look at `view-a.png`, `view-b.png`, the `clip-*.png`
renders and the `surfaced-*.png` renders. A family is done when the report has no problems
and the renders read as the object from both sides. The full regression is
`tools/blender-check/check-build.py` with `ANVIL_KIT_DIR` set.

In a running Blender, reload an edited family with `importlib.reload(module)`; the build
script imports the package fresh in every headless run.
