"""Crate family: a framed pine shipping crate and a hard-surface military supply crate.

crate: six plank faces (5 boards a side, 4 underneath) over a core box, so the gaps read as
dark seams; corner posts and top and bottom frame rails a few millimetres proud of the
planks; two steel strapping hoops around the sides, taut over the posts and floating over
the recessed boards as real strapping does; angle-iron corner brackets at the top and
bottom of every vertical edge with nail heads. The bounding box is the outermost steel
(bands and nail heads) in X and Y and the frame rails in Z. Nothing moves.

sci_crate: a hull with rounded vertical edges and chamfered top and bottom perimeters on
four skid feet, two recessed panels on each long side and a recessed grab handle in each
end, a stepped lid whose chamfered seam reads as a groove, chamfered corner armour blocks,
two latch levers on the front with an emissive lock plate and status lights on a lock
housing, and hinge barrels at the back. Moving parts: "lid" (the slab and everything on
it rotates open about the hinge line at the back, axis X) and "latch" (both levers swing
out about their pin line, axis X); demo clips "open" and "unlatch".

Budget notes: after the 1-segment bevel a box costs 44 triangles, a 12-segment cylinder
92, a rectangular hoop 112 and an L-profile loft 72. `ops.fasteners` heads cost 68 or more
each, so the crate's 32 nail heads are open six-sided domes (6 triangles each, no edge
sharp enough to bevel) from a private helper.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from . import ops

KINDS = ("crate", "sci_crate")
FINISHING = {"bevel": (0.0015, 1), "smooth_angle": 35}
CORNERS = ((-1, -1, "lf"), (1, -1, "rf"), (-1, 1, "lb"), (1, 1, "rb"))  # x sign, y sign, name (left/right, front/back)


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/trim/emissive to slot indices."""
    if kind == "sci_crate":
        parts, rig = _build_sci_crate(dim, roles)
    else:
        parts, rig = _build_crate(dim, roles)
    return parts, dict(FINISHING), rig


# --- private helpers ------------------------------------------------------------------------------

def _mesh_object(name, bm, slot):
    """Link a bmesh as a part in the active collection, every face on `slot` (like ops does)."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.view_layer.active_layer_collection.collection.objects.link(ob)
    for poly in me.polygons:
        poly.material_index = slot
    return ob


def _spread(a, b, n, gap):
    """ops.ribs bounds and board width for n boards between a and b with `gap` between the
    boards and at both ends."""
    w = (b - a - (n + 1) * gap) / n
    return a + gap / 2, b - gap / 2, w


def _hoop(name, x0, x1, y0, y1, z0, z1, t, slot):
    """Rectangular hoop: the wall `t` thick just inside the box x0..x1, y0..y1, between z0
    and z1, as one closed shell (frame rails, strapping bands)."""
    bm = bmesh.new()

    def loop(z, i):
        return [bm.verts.new((x, y, z)) for x, y in ((x1 - i, y0 + i), (x1 - i, y1 - i), (x0 + i, y1 - i), (x0 + i, y0 + i))]

    ob, ot, ib, it = loop(z0, 0.0), loop(z1, 0.0), loop(z0, t), loop(z1, t)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((ob[i], ob[j], ot[j], ot[i]))  # outer wall
        bm.faces.new((ib[j], ib[i], it[i], it[j]))  # inner wall
        bm.faces.new((ot[i], ot[j], it[j], it[i]))  # top
        bm.faces.new((ob[j], ob[i], ib[i], ib[j]))  # bottom
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _mesh_object(name, bm, slot)


def _studs(name, items, radius, height, slot, sink=0.0003):
    """Nail or rivet heads as open six-sided domes: `items` are (position, outward normal)
    pairs with the position on the plate surface. Six triangles each and no edge sharper
    than the bevel limit, so they cost nothing after finishing; the rim sits `sink` inside
    the plate so no crack shows."""
    bm = bmesh.new()
    for pos, normal in items:
        n = Vector(normal).normalized()
        u = n.cross(Vector((0.0, 0.0, 1.0)))
        if u.length < 1e-6:
            u = n.cross(Vector((0.0, 1.0, 0.0)))
        u.normalize()
        v = n.cross(u)  # (u, v, n) is right-handed, so the ring runs counter-clockwise seen from outside
        base = Vector(pos) - n * sink
        apex = bm.verts.new(base + n * (height + sink))
        ring = [bm.verts.new(base + (u * math.cos(a) + v * math.sin(a)) * radius) for a in (2 * math.pi * i / 6 for i in range(6))]
        for i in range(6):
            bm.faces.new((ring[i], ring[(i + 1) % 6], apex))
    return _mesh_object(name, bm, slot)


def _angle_bracket(name, sx, sy, cx, cy, leg, t, z0, z1, slot):
    """Angle iron wrapping the vertical edge at the outer corner (cx, cy) of the (sx, sy)
    corner: two plates `leg` long and `t` thick, lofted from z0 to z1."""
    pts = [
        (cx - sx * leg, cy), (cx - sx * leg, cy - sy * t), (cx - sx * t, cy - sy * t),
        (cx - sx * t, cy - sy * leg), (cx, cy - sy * leg), (cx, cy),
    ]
    return ops.loft_shape(name, [((0.0, 0.0, z0), 1.0, 1.0), ((0.0, 0.0, z1), 1.0, 1.0)], lambda w, h: pts, slot, True, "Z")


def _corner_block(name, sx, sy, x_in, y_in, size, chamfer, z0, z1, slot):
    """Square armour block of `size` whose inner corner is at (x_in, y_in), growing towards
    the (sx, sy) corner, with its outer vertical edge chamfered; lofted from z0 to z1."""
    local = [(0.0, 0.0), (size, 0.0), (size, size - chamfer), (size - chamfer, size), (0.0, size)]
    pts = [(x_in + sx * px, y_in + sy * py) for px, py in local]
    return ops.loft_shape(name, [((0.0, 0.0, z0), 1.0, 1.0), ((0.0, 0.0, z1), 1.0, 1.0)], lambda w, h: pts, slot, True, "Z")


def _chamfered_body(name, w, d, z0, z1, r, ch_bottom, ch_top, slot, corner_segments=4):
    """Box w by d with rounded vertical edges (radius r) and 45-degree chamfers around the
    bottom and top perimeters, lofted along Z from z0 to z1. Four corner segments keep the
    rounded edges below the bevel's angle limit."""
    u, v = ops.PLANE["Z"]
    frames = []

    def frame(z, inset):
        frames.append((Vector((0.0, 0.0, z)), u, v, w - 2 * inset, d - 2 * inset, max(r - inset, ops.MIN_RADIUS)))

    if ch_bottom > 0:
        frame(z0, ch_bottom)
        frame(z0 + ch_bottom, 0.0)
    else:
        frame(z0, 0.0)
    if ch_top > 0:
        frame(z1 - ch_top, 0.0)
        frame(z1, ch_top)
    else:
        frame(z1, 0.0)
    return ops.loft(name, frames, slot, corner_segments)


# --- crate ----------------------------------------------------------------------------------------

def _build_crate(dim, roles):
    W, D, H = float(dim.x), float(dim.y), float(dim.z)
    wood = roles.get("primary", 0)
    steel = roles.get("trim", wood)
    parts = []
    add = parts.append
    k = min(W, D, H)

    steel_t = 0.003                 # strapping bands, proud of the frame
    proud = 0.004                   # frame proud of the planks
    plank_t = 0.02
    gap = 0.005
    post_w = max(0.03, 0.06 * k)    # corner posts and frame rails, square section
    rail_h = max(0.03, 0.05 * k)
    band_w = max(0.03, 0.05 * k)
    leg = post_w - 0.005            # bracket plates stay on the post faces
    brk_h = max(0.06, 0.12 * k)
    nail_h = 0.0015
    plate_t = 0.003
    boards = 5

    ex, ey = W / 2, D / 2                       # bands and nail heads reach the bounding box
    fx, fy = ex - steel_t, ey - steel_t         # frame (posts, rails) outer faces
    px, py = fx - proud, fy - proud             # plank outer faces on the sides

    # core: 2 mm behind the backs of the planks, so every gap shows a dark seam
    inset = plank_t + 0.002
    add(ops.box("core", (2 * (px - inset), 2 * (py - inset), H - 2 * (proud + inset)), (0.0, 0.0, H / 2), wood))

    # frame: rails as hoops at the top and bottom, posts between them
    add(_hoop("rail_top", -fx, fx, -fy, fy, H - rail_h, H, post_w, wood))
    add(_hoop("rail_bottom", -fx, fx, -fy, fy, 0.0, rail_h, post_w, wood))
    for sx, sy, name in CORNERS:
        add(ops.box("post_" + name, (post_w, post_w, H - 2 * rail_h), (sx * (fx - post_w / 2), sy * (fy - post_w / 2), H / 2), wood))

    # planks: horizontal boards front and back, vertical boards on the ends, boards along X
    # on top and along Y underneath; the ends of every board are tucked 5 mm into the frame
    z0, z1, w = _spread(rail_h, H - rail_h, boards, gap)
    length = 2 * (fx - post_w + 0.005)
    for sy, name in ((-1, "front"), (1, "back")):
        add(ops.ribs("planks_" + name, z0, z1, 0.0, sy * (py - plank_t / 2), boards, (length, plank_t, w), wood, axis="Z"))
    y0, y1, w = _spread(-(fy - post_w), fy - post_w, boards, gap)
    for sx, name in ((-1, "left"), (1, "right")):
        add(ops.ribs("planks_" + name, y0, y1, sx * (px - plank_t / 2), H / 2, boards, (plank_t, w, H - 2 * rail_h + 0.01), wood, axis="Y"))
    add(ops.ribs("planks_top", y0, y1, 0.0, H - proud - plank_t / 2, boards, (length, w, plank_t), wood, axis="Y"))
    x0, x1, w = _spread(-(fx - post_w), fx - post_w, boards - 1, gap)
    add(ops.ribs("planks_bottom", x0, x1, 0.0, proud + plank_t / 2, boards - 1, (w, 2 * (fy - post_w + 0.005), plank_t), wood, axis="X"))

    # two strapping hoops around the sides, taut over the posts
    for name, zc in (("band_lower", H * 0.3), ("band_upper", H * 0.7)):
        add(_hoop(name, -ex, ex, -ey, ey, zc - band_w / 2, zc + band_w / 2, steel_t + 0.0005, steel))

    # angle-iron brackets at the top and bottom of every vertical edge, nailed on
    margin = 0.015
    nails = []
    for sx, sy, name in CORNERS:
        cx, cy = sx * (ex - nail_h), sy * (ey - nail_h)   # plate surface; the nail heads reach the box
        for level, (za, zb) in (("bottom", (margin, margin + brk_h)), ("top", (H - margin - brk_h, H - margin))):
            add(_angle_bracket("bracket_%s_%s" % (name, level), sx, sy, cx, cy, leg, plate_t + 0.0015, za, zb, steel))
            for fz in (0.3, 0.7):
                z = za + (zb - za) * fz
                nails.append(((cx, cy - sy * leg * 0.6, z), (sx, 0.0, 0.0)))
                nails.append(((cx - sx * leg * 0.6, cy, z), (0.0, sy, 0.0)))
    add(_studs("bracket_nails", nails, 0.004, nail_h, steel))
    return parts, {"bones": [], "actions": []}


# --- sci_crate ------------------------------------------------------------------------------------

def _build_sci_crate(dim, roles):
    W, D, H = float(dim.x), float(dim.y), float(dim.z)
    hull = roles.get("primary", 0)
    trim = roles.get("trim", hull)
    lamp = roles.get("emissive", trim)
    parts = []

    def add(ob, part=None):
        if part:
            ops.tag_part(ob, part)
        parts.append(ob)
        return ob

    cap = 0.003                   # corner blocks proud of the hull
    cap_s = min(0.08, W * 0.1, D * 0.1)
    r = 0.025                     # hull corner radius
    foot_h = 0.03
    front_reach = 0.018           # the latch levers stand this far off the front face
    hinge_r = 0.008
    step = 0.004                  # lid stepped in from the hull
    hx = W / 2 - cap
    hy = D / 2 - front_reach
    lid_top = H - cap
    lid_z = lid_top - H * 0.15
    hinge_y = hy + 0.002 + hinge_r   # barrel centre; the barrel reaches the back of the box

    # hull with recessed side panels and end handle pockets
    body = _chamfered_body("hull", 2 * hx, 2 * hy, foot_h, lid_z, r, 0.010, 0.008, hull)
    pocket_d = 0.007
    px1 = hx - cap_s - 0.012
    pw = (2 * px1 - 0.05) / 2
    pxc = px1 - pw / 2
    pz0, pz1 = foot_h + 0.06, lid_z - 0.16
    handle_w, handle_h, handle_d, handle_z = 0.18, 0.07, 0.025, foot_h + (lid_z - foot_h) * 0.55
    cutters = []
    for sy in (-1, 1):
        for sx in (-1, 1):
            cutters.append(ops.box("panel_cut", (pw, 2 * pocket_d, pz1 - pz0), (sx * pxc, sy * hy, (pz0 + pz1) / 2), hull))
    for sx in (-1, 1):
        cutters.append(ops.box("handle_cut", (2 * handle_d, handle_w, handle_h), (sx * hx, 0.0, handle_z), hull))
    ops.boolean_cut(body, cutters)
    add(body)
    for sx, name in ((-1, "left"), (1, "right")):
        add(ops.box("handle_bar_" + name, (0.012, handle_w + 0.02, 0.018), (sx * (hx - 0.014), 0.0, handle_z), trim))

    # skid feet: the bottom of the bounding box
    for sx, sy, name in CORNERS:
        add(ops.box("foot_" + name, (0.10, 0.09, foot_h + 0.002), (sx * (hx - 0.14), sy * (hy - 0.135), (foot_h + 0.002) / 2), trim))

    # corner armour: chamfered blocks, the lower four on the hull, the upper four on the lid
    for sx, sy, name in CORNERS:
        add(_corner_block("corner_lower_" + name, sx, sy, sx * (hx + cap - cap_s), sy * (hy + cap - cap_s), cap_s, 0.02, foot_h - cap, foot_h - cap + cap_s, trim))
        add(_corner_block("corner_upper_" + name, sx, sy, sx * (hx - step + cap - cap_s), sy * (hy - step + cap - cap_s), cap_s, 0.02, H - cap_s, H, trim), "lid")

    # lid: stepped in, chamfered top and bottom, a recessed top panel with two ribs
    lid = _chamfered_body("lid", 2 * (hx - step), 2 * (hy - step), lid_z, lid_top, r - step, 0.008, 0.014, hull)
    top_w, top_d = 2 * (hx - step - cap_s - 0.015), 2 * (hy - step - cap_s - 0.015)
    ops.boolean_cut(lid, ops.box("lid_panel_cut", (top_w, top_d, 0.010), (0.0, 0.0, lid_top), hull))
    add(lid, "lid")
    for sx, name in ((-1, "left"), (1, "right")):
        add(ops.box("lid_rib_" + name, (0.03, top_d + 0.02, 0.006), (sx * W * 0.15, 0.0, lid_top - 0.002), trim), "lid")

    # hinges at the back: barrels on the pivot line, a leaf on the lid and one on the hull
    for sx, name in ((-1, "left"), (1, "right")):
        xh = sx * W * 0.28
        add(ops.cylinder("hinge_barrel_" + name, hinge_r, 0.10, (xh, hinge_y, lid_z), "X", 12, trim))
        y_in = hy - step - 0.012
        add(ops.box("hinge_leaf_lid_" + name, (0.08, hinge_y - y_in, 0.006), (xh, (hinge_y + y_in) / 2, lid_z + 0.010), trim), "lid")
        y_in = hy - 0.012
        add(ops.box("hinge_leaf_hull_" + name, (0.08, hinge_y - y_in, 0.006), (xh, (hinge_y + y_in) / 2, lid_z - 0.010), trim))

    # latches on the front: base block on the hull, lever and hook swing about the pin
    # line, keeper on the lid
    pin_y = -(hy + 0.010)
    pin_z = lid_z - 0.10
    for sx, name in ((-1, "left"), (1, "right")):
        xl = sx * W * 0.25
        add(ops.box("latch_base_" + name, (0.05, 0.014, 0.024), (xl, -(hy + 0.007), pin_z), trim))
        add(ops.box("latch_lever_" + name, (0.04, 0.006, 0.16), (xl, -(hy + 0.015), pin_z + 0.072), trim), "latch")
        add(ops.box("latch_hook_" + name, (0.04, 0.014, 0.012), (xl, -(hy + 0.011), lid_z + 0.046), trim), "latch")
        add(ops.box("latch_keeper_" + name, (0.05, 0.010, 0.02), (xl, -(hy - step + 0.005), lid_z + 0.03), trim), "lid")

    # lock housing with the emissive lock plate strip and two status lights
    add(ops.box("lock_housing", (0.20, 0.010, 0.07), (0.0, -(hy + 0.005), lid_z - 0.075), trim))
    add(ops.box("lock_plate", (0.16, 0.004, 0.024), (0.0, -(hy + 0.012), lid_z - 0.062), lamp))
    for sx, name in ((-1, "left"), (1, "right")):
        add(ops.box("status_light_" + name, (0.018, 0.004, 0.012), (sx * 0.05, -(hy + 0.012), lid_z - 0.094), lamp))

    bones = [
        {"bone": "lid", "group": "lid", "motion": "rotate", "pivot": [0.0, hinge_y, lid_z], "axis": [1.0, 0.0, 0.0], "angle": -70.0, "label": "open", "length": 0.06},
        {"bone": "latch", "group": "latch", "motion": "rotate", "pivot": [0.0, pin_y, pin_z], "axis": [1.0, 0.0, 0.0], "angle": 60.0, "label": "unlatch", "length": 0.04},
    ]
    actions = [
        {"name": "open", "parts": ["lid"], "keys": [(1, 0.0), (18, 1.0)]},
        {"name": "unlatch", "parts": ["latch"], "keys": [(1, 0.0), (8, 1.0)]},
    ]
    return parts, {"bones": bones, "actions": actions}
