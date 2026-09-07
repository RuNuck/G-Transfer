"""Chest family: a banded wooden loot chest and a pressed-steel ammo can.

chest: a stylized iron-banded storage chest. Horizontal planks on all four faces of a thin
core box, so the gaps read as dark seams; a barrel-vault lid lofted along X from a flat
bottomed dome section, overhanging the body by 5 mm; three iron bands that run up the front,
over the lid and down the back (the lid half is a slightly larger copy of the lid section, so
it stays a constant offset proud of the wood); a strap capping each end of the lid; corner
bosses under the lid overhang, four foot blocks, a lock plate with a keyhole boss and a hinged
hasp at the front centre, and a ring-and-plate drop handle on each end. The lid sections and
the handle bails set the bounding box: the straps reach the top and the front and back of the
box, the bails its ends. Moving parts: "lid" (the lid, its bands and its end straps swing open
about the back of the seam, clip "open") and "hasp" (swings out from its hinge, clip "unhasp").

ammo_can: an M2A1-style pressed steel can. A body lofted along Z with rounded vertical edges
and a rolled lip at the top, a lid whose skirt overhangs the lip by 3 mm with two pressed ribs
on it, three hinge knuckles and two hinge leaves at the back, a latch lever assembly on the
front, a folding wire bail on two brackets on the lid, two stiffening ribs on each long side
and rivet heads. The latch reaches the front of the box, the knuckles its back and the folded
bail its top. Moving parts: "lid" (lid, leaf, keeper, brackets, outer knuckles; clip "open"),
"latch" (lever and cam swing out about the pin; clip "unlatch") and "handle" (the wire alone
stands up about its pin line; clip "lift") -- the wire carries its own bone, so it does not
follow the lid.

Budget notes, after the 1-segment bevel: a box costs 44 triangles, a 12-segment cylinder 92,
a two-frame dome loft about 120 and the four-corner-segment body loft about 400. Rivet and
nail heads are open six-sided domes from a private helper (6 triangles each, no edge sharp
enough to bevel), which is why there can be twenty of them.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from . import ops

KINDS = ("chest", "ammo_can")
FINISHING = {
    "chest": {"bevel": (0.0015, 1), "smooth_angle": 35},
    "ammo_can": {"bevel": (0.0012, 1), "smooth_angle": 38},
}
# demo clips: fraction of each part's angle per frame (24 fps)
ACTIONS = {
    "chest": [
        {"name": "open", "parts": ["lid"], "keys": [(1, 0.0), (20, 1.0)]},
        {"name": "unhasp", "parts": ["hasp"], "keys": [(1, 0.0), (10, 1.0)]},
    ],
    "ammo_can": [
        {"name": "open", "parts": ["lid"], "keys": [(1, 0.0), (20, 1.0)]},
        {"name": "unlatch", "parts": ["latch"], "keys": [(1, 0.0), (10, 1.0)]},
        {"name": "lift", "parts": ["handle"], "keys": [(1, 0.0), (12, 1.0)]},
    ],
}
CORNERS = ((-1, -1, "lf"), (1, -1, "rf"), (-1, 1, "lb"), (1, 1, "rb"))  # x sign, y sign, name


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/trim to material slot indices;
    `variant` is accepted for later options and unused."""
    parts, bones = (_ammo_can if kind == "ammo_can" else _chest)(dim, roles)
    present = {b["bone"] for b in bones}
    actions = [a for a in ACTIONS.get(kind, ACTIONS["chest"]) if all(p in present for p in a["parts"])]
    return parts, dict(FINISHING.get(kind, FINISHING["chest"])), {"bones": bones, "actions": actions}


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


def _studs(name, items, radius, height, slot, sink=0.0003):
    """Nail or rivet heads as open six-sided domes: `items` are (position, outward normal)
    pairs with the position on the plate surface. Six triangles each and no edge sharper than
    the bevel limit, so they survive finishing for free; the rim sits `sink` inside the plate
    so no crack shows."""
    bm = bmesh.new()
    for pos, normal in items:
        n = Vector(normal).normalized()
        u = n.cross(Vector((0.0, 0.0, 1.0)))
        if u.length < 1e-6:
            u = n.cross(Vector((0.0, 1.0, 0.0)))
        u.normalize()
        v = n.cross(u)  # (u, v, n) is right-handed, so the ring runs counter-clockwise from outside
        base = Vector(pos) - n * sink
        apex = bm.verts.new(base + n * (height + sink))
        ring = [bm.verts.new(base + (u * math.cos(a) + v * math.sin(a)) * radius) for a in (2 * math.pi * i / 6 for i in range(6))]
        for i in range(6):
            bm.faces.new((ring[i], ring[(i + 1) % 6], apex))
    return _mesh_object(name, bm, slot)


def _dome(straight, arc_points=11):
    """Chest-lid section: a flat bottom, straight sides `straight` metres tall and an elliptical
    dome over them, as a shape(w, h) for ops.loft_shape. `straight` is absolute, so lofting the
    same shape one size up gives a strap that stays a constant offset proud of the lid. An odd
    arc point count puts a vertex on the apex, so the loft reaches the top of the bounding box;
    eleven of them keep every crease under 25 degrees, below the bevel's 30 degree limit."""
    def shape(w, h):
        a = w / 2
        s = min(straight, h * 0.6)
        b = h - s
        pts = [(a, -h / 2)]
        for i in range(arc_points):
            t = math.pi * i / (arc_points - 1)
            pts.append((a * math.cos(t), -h / 2 + s + b * math.sin(t)))
        pts.append((-a, -h / 2))
        return pts
    return shape


def _bail(name, x, half_y, z_top, z_bot, bar, slot):
    """Drop handle: a square-section bar swept round a U in the YZ plane at x, hanging from
    (+-half_y, z_top) down to z_bot. Seven stations keep it to 52 raw triangles."""
    knee = z_bot + (z_top - z_bot) * 0.35
    path = [
        (half_y, z_top), (half_y, knee), (half_y * 0.78, z_bot + (knee - z_bot) * 0.30),
        (0.0, z_bot), (-half_y * 0.78, z_bot + (knee - z_bot) * 0.30), (-half_y, knee), (-half_y, z_top),
    ]
    rings = []
    for i, (py, pz) in enumerate(path):
        a, b = path[max(i - 1, 0)], path[min(i + 1, len(path) - 1)]
        t = Vector((b[0] - a[0], b[1] - a[1]))
        t = t.normalized() if t.length > 1e-9 else Vector((0.0, 1.0))
        n = Vector((-t.y, t.x))
        c = Vector((x, py, pz))
        rings.append([c + Vector((sx * bar / 2, sn * n.x * bar / 2, sn * n.y * bar / 2))
                      for sx, sn in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
    return ops.loft_points(name, rings, slot)


# --- chest ----------------------------------------------------------------------------------------

def _chest(dim, roles):
    L, D, H = float(dim.x), float(dim.y), float(dim.z)
    wood = roles.get("primary", 0)
    iron = roles.get("trim", wood)
    parts, bones = [], []

    def add(ob, bone=None):
        if bone:
            ops.tag_part(ob, bone)
        parts.append(ob)
        return ob

    k = min(L / 1.1, D / 0.7, H / 0.7)      # detail sizes below are given for a 1.1 x 0.7 x 0.7 chest
    proud = 0.004 * k                        # ironwork proud of the wood
    over = 0.005 * k                         # lid overhang
    reach = 0.024 * k                        # the handle bails stand this far off the end panels
    plank_t = 0.018 * k
    gap = 0.006 * k
    foot_h = 0.050 * k
    band_w = 0.030 * k
    boss = 0.070 * k
    y_lid = D / 2 - proud                    # the lid bands reach the front and back of the box
    y_body = y_lid - over
    x_body = L / 2 - reach                   # the handle bails reach the ends of the box
    x_lid = x_body + over
    z_seam = H * 0.60
    lid_top = H - proud                      # the lid bands reach the top of the box
    body_z0 = foot_h * 0.84
    body_z1 = z_seam - 0.002 * k             # a shadow gap under the lid
    lid_shape = _dome(0.18 * (H - z_seam))
    band_x = (-L * 0.30, 0.0, L * 0.30)

    # --- body: four courses of planks over a recessed core box --------------------------------------
    add(ops.box("core", (2 * (x_body - plank_t - 0.002 * k), 2 * (y_body - plank_t - 0.002 * k), body_z1 - body_z0 - 0.004 * k),
                (0.0, 0.0, (body_z0 + body_z1) / 2), wood))
    z0, z1, pw = _spread(body_z0, body_z1, 4, gap)
    run = 2 * (x_body - plank_t) + 0.002 * k
    for sy, tag in ((-1, "front"), (1, "back")):
        add(ops.ribs("planks_" + tag, z0, z1, 0.0, sy * (y_body - plank_t / 2), 4, (run, plank_t, pw), wood, axis="Z"))
    for sx, tag in ((-1, "left"), (1, "right")):
        add(ops.ribs("planks_" + tag, z0, z1, sx * (x_body - plank_t / 2), 0.0, 4, (plank_t, 2 * y_body, pw), wood, axis="Z"))

    # --- lid: a barrel vault lofted along X, and the ironwork that rides on it -----------------------
    add(ops.loft_shape("lid", [((-x_lid, 0.0, (z_seam + lid_top) / 2), 2 * y_lid, lid_top - z_seam),
                               ((x_lid, 0.0, (z_seam + lid_top) / 2), 2 * y_lid, lid_top - z_seam)],
                       lid_shape, wood, True, "X"), "lid")
    strap_c, strap_w, strap_h = (z_seam + H) / 2, 2 * (y_lid + proud), H - z_seam
    for sx, tag in ((-1, "left"), (1, "right")):
        # inboard of the lid's end face, so the strap reads as a rim round bare wood
        xa, xb = sorted((sx * (x_lid - 0.030 * k), sx * (x_lid - 0.004 * k)))
        add(ops.loft_shape("lid_end_strap_" + tag, [((xa, 0.0, strap_c), strap_w, strap_h), ((xb, 0.0, strap_c), strap_w, strap_h)],
                           lid_shape, iron, True, "X"), "lid")
    for i, xb in enumerate(band_x):
        add(ops.loft_shape("lid_band_%d" % (i + 1), [((xb - band_w / 2, 0.0, strap_c), strap_w, strap_h), ((xb + band_w / 2, 0.0, strap_c), strap_w, strap_h)],
                           lid_shape, iron, True, "X"), "lid")

    # --- the same three bands running down the front and back of the body ---------------------------
    band_t = 2 * proud
    for i, xb in enumerate(band_x):
        for sy, tag in ((-1, "front"), (1, "back")):
            add(ops.box("body_band_%s_%d" % (tag, i + 1), (band_w, band_t, body_z1 - body_z0 + 0.002 * k),
                        (xb, sy * y_body, (body_z0 + body_z1) / 2), iron))

    # --- feet and the corner bosses under the lid overhang -------------------------------------------
    foot = 0.10 * k
    for sx, sy, tag in CORNERS:
        add(ops.box("foot_" + tag, (foot, foot, body_z0 + 0.008 * k),
                    (sx * (x_body - foot / 2 + 0.002 * k), sy * (y_body - foot / 2 + 0.002 * k), (body_z0 + 0.008 * k) / 2), iron))
        add(ops.box("corner_boss_" + tag, (boss, boss, 0.055 * k),
                    (sx * (x_body - boss / 2 + proud), sy * (y_body - boss / 2 + proud), body_z1 - 0.029 * k), iron))

    # --- lock plate, keyhole boss and the hinged hasp over them --------------------------------------
    face = -y_body
    hasp_y = face - 0.0065 * k
    hinge_z = z_seam - 0.014 * k
    add(ops.box("lock_plate", (0.165 * k, 0.006 * k, 0.160 * k), (0.0, face - 0.001 * k, z_seam - 0.140 * k), iron))
    add(ops.box("keyhole_boss", (0.030 * k, 0.006 * k, 0.048 * k), (0.0, face - 0.0045 * k, z_seam - 0.185 * k), iron))
    add(ops.box("hasp_plate", (0.120 * k, 0.008 * k, 0.048 * k), (0.0, face - 0.002 * k, z_seam - 0.028 * k), iron))
    add(ops.box("hasp_strap", (0.062 * k, 0.005 * k, 0.110 * k), (0.0, hasp_y, z_seam - 0.066 * k), iron), "hasp")
    add(ops.box("hasp_foot", (0.092 * k, 0.005 * k, 0.038 * k), (0.0, hasp_y, z_seam - 0.132 * k), iron), "hasp")

    # --- ring-and-plate drop handles on the end panels ------------------------------------------------
    z_handle = body_z1 - 0.055 * k
    for sx, tag in ((-1, "left"), (1, "right")):
        add(ops.box("handle_plate_" + tag, (0.012 * k, 0.190 * k, 0.032 * k), (sx * (x_body + 0.004 * k), 0.0, z_handle), iron))
        add(_bail("handle_bail_" + tag, sx * (x_body + 0.015 * k), 0.085 * k, z_handle, z_handle - 0.130 * k, 0.018 * k, iron))

    # --- nail heads on the bands, the bosses and the lock plate ---------------------------------------
    nails = []
    for xb in band_x:
        for sy in (-1, 1):
            for z in (body_z0 + 0.045 * k, body_z1 - 0.045 * k):
                nails.append(((xb, sy * (y_body + proud), z), (0.0, sy, 0.0)))
    for sx, sy, _tag in CORNERS:
        nails.append(((sx * (x_body - boss / 2 + proud), sy * (y_body + proud), body_z1 - 0.029 * k), (0.0, sy, 0.0)))
    for sx in (-1, 1):
        nails.append(((sx * 0.062 * k, face - 0.004 * k, z_seam - 0.075 * k), (0.0, -1.0, 0.0)))
        nails.append(((sx * 0.062 * k, face - 0.004 * k, z_seam - 0.200 * k), (0.0, -1.0, 0.0)))
    add(_studs("iron_nails", nails, 0.007 * k, 0.003 * k, iron))

    bones = [
        {"bone": "lid", "group": "lid", "motion": "rotate", "pivot": [0.0, y_lid, z_seam],
         "axis": [1.0, 0.0, 0.0], "angle": -100.0, "label": "open", "length": 0.08 * k},
        {"bone": "hasp", "group": "hasp", "motion": "rotate", "pivot": [0.0, face - 0.004 * k, hinge_z],
         "axis": [1.0, 0.0, 0.0], "angle": -90.0, "label": "unhasp", "length": 0.05 * k},
    ]
    return parts, bones


# --- ammo can -------------------------------------------------------------------------------------

def _ammo_can(dim, roles):
    L, D, H = float(dim.x), float(dim.y), float(dim.z)
    olive = roles.get("primary", 0)
    steel = roles.get("trim", olive)
    parts, bones = [], []

    def add(ob, bone=None):
        if bone:
            ops.tag_part(ob, bone)
        parts.append(ob)
        return ob

    k = min(L / 0.28, D / 0.18, H / 0.20)   # detail sizes below are for a 0.28 x 0.18 x 0.20 can
    x_lid = L / 2                            # the lid ends are the ends of the box
    y_out = D / 2                            # the latch reaches the front, the knuckles the back
    y_lid = y_out - 0.0095 * k
    x_lip = x_lid - 0.002 * k                # rolled lip and foot, just inside the lid skirt
    y_lip = y_lid - 0.002 * k
    x_body = x_lip - 0.004 * k               # the pressed wall, one lip thickness in
    y_body = y_lip - 0.004 * k
    r = 0.014 * k                            # rounded vertical edges
    base_z = H * 0.04
    wall_z = H * 0.71                        # the wall flares into the lip from here
    bead_z = H * 0.74
    body_top = H * 0.78
    lid_z0 = H * 0.75                        # the skirt covers the top of the bead, not all of it
    lid_top = H * 0.94
    wire_r = 0.005 * k
    wire_z = H - wire_r                      # the folded bail is the top of the box
    pivot_y = 0.025 * k
    hinge_y = y_out - 0.006 * k
    hinge_z = H * 0.80

    # --- body: rounded box lofted along Z, rolled foot at the bottom and rolled lip at the top --------
    u, v = ops.PLANE["Z"]
    add(ops.loft("body", [
        (Vector((0.0, 0.0, 0.0)), u, v, 2 * x_lip, 2 * y_lip, r + 0.002 * k),
        (Vector((0.0, 0.0, base_z)), u, v, 2 * x_body, 2 * y_body, r),
        (Vector((0.0, 0.0, wall_z)), u, v, 2 * x_body, 2 * y_body, r),
        (Vector((0.0, 0.0, bead_z)), u, v, 2 * x_lip, 2 * y_lip, r + 0.002 * k),
        (Vector((0.0, 0.0, body_top)), u, v, 2 * x_lip - 0.001 * k, 2 * y_lip - 0.001 * k, r + 0.002 * k),
    ], olive, 4))
    for sy, tag in ((-1, "front"), (1, "back")):
        add(ops.ribs("side_ribs_" + tag, 0.042 * k, wall_z - 0.012 * k, 0.0, sy * (y_body - 0.001 * k), 2,
                     (2 * x_body - 0.030 * k, 0.008 * k, 0.016 * k), olive, axis="Z"))

    # --- lid: skirt over the lip, two pressed ribs on the top ----------------------------------------
    add(ops.rounded_box("lid", (2 * x_lid, 2 * y_lid, lid_top - lid_z0), (0.0, 0.0, (lid_z0 + lid_top) / 2),
                        r + 0.002 * k, olive, corner_segments=4, axis="Z"), "lid")
    for sy, tag in ((-1, "front"), (1, "back")):  # a pressed rectangle, clear of the folded bail
        add(ops.box("lid_rib_" + tag, (2 * x_lid - 0.050 * k, 0.020 * k, 0.005 * k),
                    (0.0, sy * 0.066 * k, lid_top + 0.0015 * k), olive), "lid")
    for sx, tag in ((-1, "left"), (1, "right")):
        add(ops.box("lid_rib_end_" + tag, (0.020 * k, 2 * y_lid - 0.009 * k, 0.005 * k),
                    (sx * 0.105 * k, 0.0, lid_top + 0.0015 * k), olive), "lid")

    # --- hinge: leaves below and above the seam, three knuckles on the pivot line ---------------------
    add(ops.box("hinge_leaf_body", (2 * x_body - 0.090 * k, 0.006 * k, 0.024 * k), (0.0, y_body + 0.003 * k, hinge_z - 0.022 * k), steel))
    add(ops.box("hinge_leaf_lid", (2 * x_body - 0.090 * k, 0.006 * k, 0.018 * k), (0.0, y_lid + 0.001 * k, hinge_z + 0.014 * k), steel), "lid")
    add(ops.cylinder("hinge_knuckle_mid", 0.006 * k, 0.034 * k, (0.0, hinge_y, hinge_z), "X", 12, steel))
    for sx, tag in ((-1, "left"), (1, "right")):
        add(ops.cylinder("hinge_knuckle_" + tag, 0.006 * k, 0.034 * k, (sx * 0.075 * k, hinge_y, hinge_z), "X", 12, steel), "lid")

    # --- latch: bracket on the body, lever and cam swing out about the pin ----------------------------
    latch_z = lid_z0 + 0.002 * k             # the pin sits just under the lid skirt
    pin = (0.0, -(y_body + 0.006 * k), latch_z)
    add(ops.box("latch_bracket", (0.058 * k, 0.010 * k, 0.048 * k), (0.0, -(y_body + 0.005 * k), latch_z - 0.026 * k), steel))
    add(ops.box("latch_keeper", (0.038 * k, 0.010 * k, 0.014 * k), (0.0, -(y_lid + 0.0035 * k), latch_z + 0.012 * k), steel), "lid")
    add(ops.box("latch_cam", (0.050 * k, 0.014 * k, 0.016 * k), (0.0, -(y_body + 0.0045 * k), latch_z + 0.007 * k), steel), "latch")
    add(ops.box("latch_lever", (0.030 * k, 0.007 * k, 0.062 * k), (0.0, -(y_out - 0.0035 * k), latch_z - 0.034 * k), steel), "latch")

    # --- folding wire bail on two brackets on the lid --------------------------------------------------
    span = 0.085 * k
    fold = -0.050 * k
    for sx, tag in ((-1, "left"), (1, "right")):
        add(ops.box("handle_bracket_" + tag, (0.014 * k, 0.022 * k, 0.018 * k), (sx * span, pivot_y, wire_z - 0.005 * k), steel), "lid")
        add(ops.cylinder("handle_leg_" + tag, wire_r, pivot_y - fold, (sx * span, (pivot_y + fold) / 2, wire_z), "Y", 12, steel), "handle")
    add(ops.cylinder("handle_bar", wire_r, 2 * span + 0.005 * k, (0.0, fold, wire_z), "X", 12, steel), "handle")

    # --- rivets on the latch bracket, the hinge leaf and the brackets ----------------------------------
    rivets = []
    for sx in (-1, 1):
        rivets.append(((sx * 0.021 * k, -(y_body + 0.010 * k), latch_z - 0.042 * k), (0.0, -1.0, 0.0)))
        rivets.append(((sx * 0.045 * k, -y_body, latch_z - 0.026 * k), (0.0, -1.0, 0.0)))
        for x in (sx * 0.040 * k, sx * 0.075 * k):
            rivets.append(((x, y_body + 0.006 * k, hinge_z - 0.022 * k), (0.0, 1.0, 0.0)))
    add(_studs("rivets", rivets, 0.0035 * k, 0.0015 * k, steel))

    bones = [
        {"bone": "lid", "group": "lid", "motion": "rotate", "pivot": [0.0, hinge_y, hinge_z],
         "axis": [1.0, 0.0, 0.0], "angle": -110.0, "label": "open", "length": 0.05 * k},
        {"bone": "latch", "group": "latch", "motion": "rotate", "pivot": [pin[0], pin[1], pin[2]],
         "axis": [1.0, 0.0, 0.0], "angle": -90.0, "label": "unlatch", "length": 0.03 * k},
        {"bone": "handle", "group": "handle", "motion": "rotate", "pivot": [0.0, pivot_y, wire_z],
         "axis": [1.0, 0.0, 0.0], "angle": -90.0, "label": "lift", "length": 0.05 * k,
         "parent": "lid"},  # the bail is bolted to the lid, so it swings away with it
    ]
    return parts, bones
