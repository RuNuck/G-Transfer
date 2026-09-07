"""Masonry family: stylized stone architecture as modular kit pieces.

pillar  A square plinth of two stepped slabs, a bulged base ring, a fluted shaft with slight
        entasis (one loft of a fluted profile), an astragal neck ring and a capital that grows
        from a round bell to a square abacus whose top is the requested height exactly.
wall    A plain core slab carrying running-bond stone blocks on the front face (-Y), a
        skirting course along the bottom and a stepped cornice along the top. Blocks stand
        proud of the core by 30 mm minus a deterministic 2-5 mm relief variation, so the
        piece stays inside its nominal thickness and tiles side by side: even courses end in
        full blocks with half a mortar gap, odd courses in half blocks that join across tiles.

Both kinds rest on z = 0 and are centred on the origin in X and Y. The bounding box equals the
requested dimensions exactly, which is what Anvil's QC promises. Stone takes the primary slot;
the base ring, abacus, skirting and cornice take the trim slot (which falls back to stone when
the spec has none); moss (the secondary slot) grows as cushions on the plinth ledge of a pillar,
and on a wall it fills the joints of the lower courses and spreads as lumpy patches over the
blocks near the ground. Nothing moves: the rig is empty.
"""
import math

from mathutils import Vector

from . import ops

KINDS = ("pillar", "wall")
FINISHING = {
    "pillar": {"bevel": (0.01, 1), "smooth_angle": 35},
    "wall": {"bevel": (0.008, 1), "smooth_angle": 35},
}
MORTAR = 0.01            # joint between blocks, and between the courses and the skirting/cornice
BLOCK_RELIEF = 0.030     # nominal depth a block stands proud of the core, before the variation
EMBED = 0.01             # how far a part sinks into its neighbour so no two faces are coplanar
MOSSY_COURSES = 3        # moss fills the joints of this many courses up from the skirting
# moss patches on the wall face: (x, z) centre as fractions of the width and height, size in metres, lump seed
MOSS_PATCHES = (("moss_patch_left", -0.28, 0.12, 0.60, 0.40, 0.7), ("moss_patch_right", 0.31, 0.10, 0.44, 0.28, 2.3))


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/secondary/trim to material slot indices."""
    variant = dict(variant or {})
    X, Y, Z = float(dim.x), float(dim.y), float(dim.z)
    stone = roles.get("primary", 0)
    moss = roles.get("secondary", stone)
    trim = roles.get("trim", stone)
    if kind == "wall":
        parts = _wall(X, Y, Z, stone, moss, trim, variant)
    else:
        parts = _pillar(X, Y, Z, stone, moss, trim, variant)
    return parts, dict(FINISHING.get(kind, FINISHING["pillar"])), {"bones": [], "actions": []}


# --- pillar -------------------------------------------------------------------------------------------

def _fluted(flutes, depth, points_per_flute=4):
    """Profile factory for loft_shape: a circle of diameter w carrying `flutes` concave flutes of
    `depth` metres, `points_per_flute` points per flute (the ridge, then a cosine dip). Every ring
    gets the same flutes * points_per_flute points, so any two rings can be lofted."""
    n = flutes * points_per_flute

    def shape(w, h):
        r = w / 2
        points = []
        for i in range(n):
            k = i % points_per_flute
            dip = depth * math.sin(math.pi * k / points_per_flute)  # 0 at the ridge, `depth` mid-flute
            a = 2 * math.pi * i / n
            points.append(((r - dip) * math.cos(a), (r - dip) * math.sin(a)))
        return points

    return shape


def _pillar(X, Y, Z, stone, moss, trim, variant):
    """Plinth, base ring, fluted shaft, neck ring, capital, abacus and moss on the plinth ledge."""
    parts = []
    s = min(X, Y)                       # the round parts are sized by the narrower footprint side
    u, v = ops.PLANE["Z"]
    flutes = int(variant.get("flutes", 12))

    # plinth: two stepped slabs, the lower one is the full footprint
    h_low, h_up = 0.035 * Z, 0.03 * Z
    up_x, up_y = 0.875 * X, 0.875 * Y
    parts.append(ops.box("plinth_lower", (X, Y, h_low), (0, 0, h_low / 2), stone))
    z_up0 = h_low - EMBED
    parts.append(ops.box("plinth_upper", (up_x, up_y, h_low + h_up - z_up0), (0, 0, (z_up0 + h_low + h_up) / 2), stone))
    z_plinth = h_low + h_up

    # base ring: a bulged revolve sitting on the upper slab, wider than the shaft it receives
    ring_h = 0.0375 * Z
    z_ring = z_plinth - EMBED
    parts.append(ops.revolve("base_ring", [
        (0.0, 0.405 * s), (0.2 * ring_h, 0.43 * s), (0.6 * ring_h, 0.43 * s), (ring_h, 0.36 * s),
    ], "Z", 24, trim, center=(0, 0, z_ring)))
    z_shaft0 = z_ring + ring_h - 0.02

    # neck ring (astragal) and the capital above it decide where the shaft ends
    abacus_h = 0.03 * Z
    z_abacus0 = Z - abacus_h
    cushion_h = 0.015 * Z
    z_cushion0 = z_abacus0 + EMBED - cushion_h
    bell_h = 0.09 * Z
    z_bell0 = z_cushion0 + EMBED - bell_h
    neck_h = 0.02 * Z
    z_neck0 = z_bell0 + EMBED - neck_h
    z_shaft1 = z_neck0 + 0.02

    # fluted shaft: one loft of the fluted profile with entasis (fullest low, narrowest high)
    entasis = ((0.0, 0.34), (0.33, 0.3425), (0.66, 0.3225), (1.0, 0.2975))
    frames = [((0, 0, z_shaft0 + t * (z_shaft1 - z_shaft0)), 2 * k * s, 2 * k * s) for t, k in entasis]
    parts.append(ops.loft_shape("shaft", frames, _fluted(flutes, 0.035 * s), stone, axis="Z"))

    parts.append(ops.revolve("neck_ring", [
        (0.0, 0.30 * s), (0.5 * neck_h, 0.345 * s), (neck_h, 0.30 * s),
    ], "Z", 24, stone, center=(0, 0, z_neck0)))

    # capital: a bell growing from a circle to a rounded square, a flaring cushion, the abacus slab
    parts.append(ops.loft("capital_bell", [
        (Vector((0, 0, z_bell0)), u, v, 0.60 * s, 0.60 * s, 0.30 * s),
        (Vector((0, 0, z_bell0 + 0.5 * bell_h)), u, v, 0.72 * s, 0.72 * s, 0.22 * s),
        (Vector((0, 0, z_bell0 + bell_h)), u, v, 0.84 * X, 0.84 * Y, 0.07 * s),
    ], stone, corner_segments=5))
    parts.append(ops.loft("capital_cushion", [
        (Vector((0, 0, z_cushion0)), u, v, 0.86 * X, 0.86 * Y, 0.08 * s),
        (Vector((0, 0, z_cushion0 + cushion_h)), u, v, 0.94 * X, 0.94 * Y, 0.03 * s),
    ], stone, corner_segments=5))
    parts.append(ops.box("abacus", (X, Y, abacus_h), (0, 0, z_abacus0 + abacus_h / 2), trim))

    # moss: a lumpy cushion lying on the plinth ledge against the upper slab, and a patch climbing
    # the slab face above it, on the front (-Y) and on the east (+X) side; all inside the footprint
    cushion_t, cushion_w, cushion_len = 0.035, 0.05, 0.35 * s
    z0c, z1c = h_low - EMBED, h_low - EMBED + cushion_t
    y_ledge = -(up_y / 2 + 0.045 - cushion_w / 2)            # straddles the slab face: 15 mm buried, 30 mm out
    x_ledge = up_x / 2 + 0.045 - cushion_w / 2
    parts.append(ops.loft_shape("moss_ledge_front", [((-0.22 * X, y_ledge, z0c), cushion_len, cushion_w), ((-0.22 * X, y_ledge, z1c), cushion_len, cushion_w)], _lumpy(1.3, 10), moss, axis="Z"))
    parts.append(ops.loft_shape("moss_ledge_east", [((x_ledge, 0.22 * Y, z0c), cushion_w, cushion_len), ((x_ledge, 0.22 * Y, z1c), cushion_w, cushion_len)], _lumpy(3.1, 10), moss, axis="Z"))
    patch_w, patch_h, zp = 0.25 * s, 0.10, z_up0 + 0.06
    parts.append(ops.loft_shape("moss_climb_front", [((-0.25 * X, -up_y / 2 + EMBED, zp), patch_w, patch_h), ((-0.25 * X, -up_y / 2 - 0.004, zp), patch_w, patch_h)], _lumpy(0.4, 10), moss, axis="Y"))
    parts.append(ops.loft_shape("moss_climb_east", [((up_x / 2 - EMBED, 0.25 * Y, zp), patch_w, patch_h), ((up_x / 2 + 0.004, 0.25 * Y, zp), patch_w, patch_h)], _lumpy(2.2, 10), moss, axis="X"))
    return parts


# --- wall ---------------------------------------------------------------------------------------------

def _relief_variation(index):
    """2 to 5 mm, in a scrambled but deterministic order along the block index."""
    return 0.002 + 0.001 * ((index * 7) % 4)


def _lumpy(seed, n=16):
    """Profile factory for loft_shape: an ellipse w by h with gentle deterministic lumps, for moss
    patches. The bumps stay small enough that the outline never crosses itself."""

    def shape(w, h):
        points = []
        for i in range(n):
            a = 2 * math.pi * i / n
            bump = 1.0 + 0.12 * math.sin(3 * a + seed) + 0.08 * math.cos(5 * a - 2 * seed)
            points.append((w / 2 * bump * math.cos(a), h / 2 * bump * math.sin(a)))
        return points

    return shape


def _wall(X, Y, Z, stone, moss, trim, variant):
    """Core slab, running-bond blocks on the front (-Y), skirting along the bottom, stepped cornice."""
    parts = []
    relief = min(0.045, 0.15 * Y)                 # how far the skirting and cornice stand proud of the core
    y_front, y_back = -Y / 2, Y / 2
    y_face = y_front + relief                     # the core's front face; blocks grow out of it
    embed = min(EMBED / 2, (Y - relief) / 4)
    block_relief = min(BLOCK_RELIEF, relief - 0.012)

    parts.append(ops.box("core", (X, y_back - y_face, Z), (0, (y_face + y_back) / 2, Z / 2), stone))

    def front_box(name, x0, x1, z0, z1, proud, slot):
        """A box on the front face spanning x0..x1 and z0..z1, `proud` metres out of the core."""
        y0, y1 = y_face - proud, y_face + embed
        return ops.box(name, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), slot)

    skirting_h = 0.05 * Z
    cornice_h = 0.2 * Z / 3
    parts.append(front_box("skirting", -X / 2, X / 2, 0.0, skirting_h, relief, trim))
    parts.append(front_box("cornice_lower", -X / 2, X / 2, Z - cornice_h, Z - cornice_h / 2 + embed, relief - 0.008, trim))
    parts.append(front_box("cornice_upper", -X / 2, X / 2, Z - cornice_h / 2, Z, relief, trim))

    # running bond between the skirting and the cornice, a mortar joint away from each
    z_lo, z_hi = skirting_h + MORTAR, Z - cornice_h - MORTAR
    courses = int(variant.get("courses", 0)) or max(2, round((z_hi - z_lo) / 0.44))
    course_h = (z_hi - z_lo - (courses - 1) * MORTAR) / courses
    n_full = max(1, round(X / 0.5))
    end_inset = MORTAR / 2                        # even courses leave half a joint at each end, so tiles meet with one
    w_full = (X - 2 * end_inset - (n_full - 1) * MORTAR) / n_full
    w_half = w_full / 2
    index = 0
    for course in range(courses):
        z0 = z_lo + course * (course_h + MORTAR)
        if course % 2 == 0:
            widths = [w_full] * n_full
            x = -X / 2 + end_inset
        else:
            widths = [w_half] + [w_full] * (n_full - 1) + [w_half]
            x = -X / 2
        for i, w in enumerate(widths):
            proud = block_relief - _relief_variation(index)
            parts.append(front_box("block_%d_%d" % (course, i), x, x + w, z0, z0 + course_h, proud, stone))
            x += w + MORTAR
            index += 1

    # moss: a thin sheet on the core face that shows in the joints of the lower courses, and lumpy
    # patches over the blocks near the ground, thick enough to fill the joints they cover
    mossy = min(MOSSY_COURSES, courses)
    z_moss1 = z_lo + mossy * (course_h + MORTAR) - 0.002
    parts.append(front_box("moss_joints", -X / 2, X / 2, skirting_h - embed, z_moss1, 0.006, moss))
    y_patch_back = y_face + embed
    y_patch_front = y_face - block_relief - 0.004
    for name, fx, fz, w, h, seed in MOSS_PATCHES:
        cx, cz = fx * X, max(fz * Z, h / 2 + 0.02)
        parts.append(ops.loft_shape(name, [((cx, y_patch_back, cz), w, h), ((cx, y_patch_front, cz), w, h)], _lumpy(seed), moss, axis="Y"))
    return parts
