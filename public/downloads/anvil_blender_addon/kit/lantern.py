"""Lantern family: a stylized kerosene lantern built from solids of revolution and wire lofts.

Layout in metres, resting on z = 0 with the Z axis through the middle: a fuel font (revolve
around Z, rounded shoulders) carrying a burner collar and, on its -Y side, the wick-adjust
knob; a barrel-shaped glass chimney (glass slot) over the burner with the wick and an
emissive teardrop flame (emissive slot) inside it; a cage of four bowed brass bars from a
band around the font up into a top plate whose rim sets the width; a vented top cap with a
smoke hole and a ring of vent ribs; two ears on the plate carrying a semicircular bail with a
hanging ring at its apex, which sets the height. Everything but the chimney and the flame is
brass, and the bounding box is exactly the requested one: the plate's rim in X and Y, the top
of the bail's hanging ring in Z, the font's flat base on z = 0.

Moving parts (tagged with a vertex group named after their bone, described in the rig spec):
"bail" swings 70 degrees about the X axis through the ears (clip "swing") and "knob" turns
about its own Y axis, its lever sweeping round with it (clip "trim_wick").
"""
import math

from mathutils import Matrix, Vector

from . import ops

KINDS = ("lantern",)
FINISHING = {"bevel": (0.0008, 1), "smooth_angle": 36}

# demo clips: fraction of each part's angle per frame (24 fps)
ACTIONS = [
    {"name": "swing", "parts": ["bail"], "keys": [(1, 0.0), (12, 1.0), (18, 1.0), (24, 0.0)]},
    {"name": "trim_wick", "parts": ["knob"], "keys": [(1, 0.0), (14, 1.0)]},
]

SIDES = 16          # revolves: divisible by 4, so vertices land on the X and Y axes, and the
                    # 22.5 degree facets stay under the build script's 30 degree bevel limit


def _hoop(center, u, v, radius, sides):
    """One ring of `sides` points around `center`, in the plane spanned by u and v. Point 0 lies
    on +u, so a ring's outermost vertex is exactly `radius` beyond the path it follows."""
    return [center + u * (radius * math.cos(a)) + v * (radius * math.sin(a))
            for a in (2 * math.pi * i / sides for i in range(sides))]


def _cage_bar(name, azimuth, path, rod_r, slot, sides=4):
    """A bowed vertical bar at `azimuth`: path is [(z, radius from the Z axis), ...]."""
    u = Vector((math.cos(azimuth), math.sin(azimuth), 0.0))
    v = Vector((-math.sin(azimuth), math.cos(azimuth), 0.0))
    rings = [_hoop(Vector((r * u.x, r * u.y, z)), u, v, rod_r, sides) for z, r in path]
    return ops.loft_points(name, rings, slot)


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/secondary/trim/emissive/glass to
    material slot indices; a lantern spec normally carries brass, glass and a flame."""
    W, D, H = float(dim.x), float(dim.y), float(dim.z)
    brass = roles.get("primary", 0)              # font, collar, plate, cap
    trim = roles.get("trim", brass)              # cage, bail, knob
    glass = roles.get("glass", brass)            # chimney
    fire = roles.get("emissive", trim)           # flame
    R = W / 2.0                                  # the top plate's rim defines the width
    s = min(W / 0.18, H / 0.36)                  # detail sizes below are for a 0.18 x 0.36 lantern
    parts, bones = [], []

    def add(ob, part=None):
        """Link a part; `part` names the bone a moving part belongs to."""
        if part:
            ops.tag_part(ob, part)
        parts.append(ob)
        return ob

    def moving(bone, motion, pivot, axis, label, **extra):
        bones.append(dict(bone=bone, group=bone, motion=motion, pivot=[float(v) for v in pivot],
                          axis=[float(v) for v in axis], label=label, **extra))

    # --- heights: the bail's hanging ring sets the top, the stack hangs below the ears ----------
    tube_r = 0.0356 * R                          # bail wire, 3.2 mm at 0.18 wide
    bail_r = R - tube_r                          # so the bail's ends reach the full width too
    ring_major, ring_minor = 0.122 * R, 0.029 * R
    bite = 0.028 * R                             # how far the ring bites into the bail's apex
    z_ear = H - bail_r - (tube_r - bite + 2.0 * (ring_major + ring_minor))
    z_apex = z_ear + bail_r
    z_plate_top = z_ear - 0.0113 * s
    z_plate_bot = z_plate_top - 0.012 * s
    z_font_top = 0.072 * s
    z_collar_top = 0.088 * s
    z_glass = (0.084 * s, z_plate_bot + 0.006 * s)

    # --- fuel font, burner collar and wick knob ------------------------------------------------
    add(ops.revolve("fuel_tank", [
        (0.0, 0.733 * R),                        # flat base it rests on
        (0.024 * s, 0.833 * R),                  # widest: 0.15 across
        (0.046 * s, 0.811 * R),
        (0.060 * s, 0.689 * R),                  # rounded shoulder
        (z_font_top - 0.008 * s, 0.511 * R),
        (z_font_top, 0.400 * R),
    ], "Z", SIDES, brass))
    add(ops.revolve("burner_collar", [
        (z_font_top - 0.004 * s, 0.411 * R),
        (0.082 * s, 0.511 * R),                  # lip the chimney seats in
        (z_collar_top, 0.511 * R),
    ], "Z", SIDES, brass))

    z_knob = 0.076 * s
    y_knob = -0.0535 * s
    add(ops.cylinder("wick_knob_stem", 0.050 * R, 0.014 * s, (0.0, -0.043 * s, z_knob), "Y", 6, trim), "knob")
    add(ops.cylinder("wick_knob_wheel", 0.130 * R, 0.008 * s, (0.0, y_knob, z_knob), "Y", 10, trim), "knob")
    add(ops.box("wick_knob_lever", (0.005 * s, 0.008 * s, 0.014 * s), (0.0, y_knob, z_knob + 0.0125 * s), trim), "knob")
    moving("knob", "rotate", (0.0, y_knob, z_knob), (0, 1, 0), "trim the wick", angle=110.0, length=0.02)

    # --- chimney, wick and flame ---------------------------------------------------------------
    g0, g1 = z_glass
    span = g1 - g0
    add(ops.revolve("glass_chimney", [
        (g0, 0.444 * R),
        (g0 + 0.14 * span, 0.589 * R),
        (g0 + 0.40 * span, 0.611 * R),           # widest: 0.11 across
        (g0 + 0.74 * span, 0.550 * R),
        (g1, 0.422 * R),
    ], "Z", SIDES, glass))
    add(ops.box("burner_wick", (0.011 * s, 0.0035 * s, 0.016 * s), (0.0, 0.0, 0.096 * s), brass))
    add(ops.revolve("flame", [
        (0.100 * s, 0.0022 * s),
        (0.108 * s, 0.0105 * s),
        (0.120 * s, 0.0115 * s),
        (0.136 * s, 0.0060 * s),
        (0.150 * s, 0.0010 * s),
    ], "Z", 8, fire))

    # --- cage: a band round the font and four bowed bars up to the plate ------------------------
    rod_r = 0.050 * R
    add(ops.revolve("cage_ring", [
        (0.015 * s, 0.878 * R),                  # band strapping the bars to the font
        (0.031 * s, 0.878 * R),
    ], "Z", SIDES, trim))
    bar_path = [
        (0.012 * s, 0.844 * R),                  # foot, under the band
        (0.086 * s, 0.912 * R),                  # widest bar: 0.0866 out, inside the plate's rim
        (0.160 * s, 0.912 * R),
        (z_plate_bot + 0.004 * s, 0.833 * R),
    ]
    # on the diagonals, so they read across the glass instead of hiding behind the bail's legs
    for tag, quarter in (("ne", 1), ("nw", 3), ("sw", 5), ("se", 7)):
        add(_cage_bar("cage_bar_" + tag, quarter * math.pi / 4, bar_path, rod_r, trim))

    # --- top plate (its rim is the bounding box in X and Y), vented cap and louvres -------------
    add(ops.revolve("top_plate", [
        (z_plate_bot + 0.004 * s, 0.700 * R),    # underside, over the chimney
        (z_plate_bot, R),                        # brim out to the full width and turned down
        (z_plate_bot + 0.008 * s, R),            # 8 mm of straight rim, so the bevel cannot shave it
        (z_plate_top + 0.004 * s, 0.856 * R),
    ], "Z", SIDES, brass))
    add(ops.revolve("top_cap", [
        (z_plate_top, 0.800 * R),
        (z_plate_top + 0.013 * s, 0.556 * R),
        (z_plate_top + 0.026 * s, 0.233 * R),    # rim of the smoke hole
        (z_plate_top + 0.016 * s, 0.178 * R),    # and down inside it
    ], "Z", SIDES, brass))
    pitch = math.atan2(0.013 * s, 0.244 * R)     # the cap's slope, so the ribs lie along it
    for i in range(6):
        az = 2 * math.pi * (i + 0.5) / 6
        add(ops.box("vent_rib_%d" % (i + 1), (0.024 * s, 0.005 * s, 0.005 * s),
                    (0.644 * R * math.cos(az), 0.644 * R * math.sin(az), z_plate_top + 0.0083 * s),
                    brass, rotation=(0.0, pitch, az)))

    # --- ears and the bail ----------------------------------------------------------------------
    x_ear = bail_r - 0.0023 * s
    for tag, side in (("right", 1.0), ("left", -1.0)):
        add(ops.box("bail_ear_" + tag, (0.010 * s, 0.016 * s, 0.032 * s),
                    (side * x_ear, 0.0, z_ear - 0.0015 * s), brass))
    rings = []
    for i in range(10):                          # 10 rings round a semicircle, ends at the ears
        a = math.pi * (1.0 - i / 9.0)
        u = Vector((math.cos(a), 0.0, math.sin(a)))
        center = Vector((bail_r * math.cos(a), 0.0, z_ear + bail_r * math.sin(a)))
        rings.append(_hoop(center, u, Vector((0.0, 1.0, 0.0)), tube_r, 6))
    add(ops.loft_points("bail_handle", rings, trim), "bail")
    z_ring = z_apex + tube_r - bite + ring_major + ring_minor
    add(ops.torus("bail_ring", ring_major, ring_minor, (0.0, 0.0, z_ring), "Y", 8, 3, trim), "bail")
    moving("bail", "rotate", (0.0, 0.0, z_ear), (1, 0, 0), "swing down", angle=70.0, length=0.03)

    if abs(D - W) > 1e-6:                        # oval footprint: squash everything to the spec's depth
        squash = Matrix.Diagonal((1.0, D / W, 1.0, 1.0))
        for ob in parts:
            ob.data.transform(squash)
            ob.data.update()

    present = {b["bone"] for b in bones}
    actions = [a for a in ACTIONS if all(p in present for p in a["parts"])]
    return parts, dict(FINISHING), {"bones": bones, "actions": actions}
