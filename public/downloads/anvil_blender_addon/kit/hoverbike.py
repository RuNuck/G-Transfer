"""Hoverbike family: a sci-fi repulsor bike assembled from parametric parts.

Layout in metres along +X (thruster mouths at x = 0, nose lamp at x = length), resting on the
repulsor pods at z = 0 with the hull belly hovering around a quarter of the height. The hull is
one loft whose deck dips into a saddle well between a tail hump and a wide tank, so the
silhouette reads as a bike rather than a hull: a backrest hump over the tail, a
lofted saddle in the well, a tank that rises into the front cowling with its raked windscreen,
dash and lamps, handlebars on a tilted steering stem, foot pegs at the waist, twin outboard
thruster nacelles with vectoring bells at the rear, and four repulsor pods on pylons whose
underside discs sit on z = 0. The bounding box is the nose lamp in X, the pods in Y and the top
of the windscreen in Z, which is what Anvil's QC promises.

Moving parts: "handlebars" (stem, bar, grips, levers, clamp) turn 25 degrees about the tilted
steering axis, clip "steer"; "nozzles" (both thruster bells and their emissive exhaust discs) vector
20 degrees down about Y, clip "vector".

Budget notes: every shell is a loft with `corner_segments=3`, whose 22.5 degree corner facets
stay under the bevel's 30 degree angle limit and so cost nothing after the modifier; cylinders
use 16 segments for the same reason and 10 or 12 where the part is small enough that a bevelled
rim is cheap. Stations are fractions of the spec dimensions, so the family scales.
"""
import math

from mathutils import Vector

from . import ops

KINDS = ("hoverbike",)
FINISHING = {"bevel": (0.006, 1), "smooth_angle": 35}

# demo clips: fraction of each part's angle per frame (24 fps)
ACTIONS = [
    {"name": "steer", "parts": ["handlebars"], "keys": [(1, 0.0), (10, 1.0), (22, -1.0), (32, 0.0)]},
    {"name": "vector", "parts": ["nozzles"], "keys": [(1, 0.0), (12, 1.0), (20, 1.0), (30, 0.0)]},
]

# stations: (x along the length, belly, deck, width, corner radius) as fractions of the
# length, height, height, width and width. The hull's deck dips between 0.31 and 0.50 to make
# the saddle well, then climbs over the tank to its peak under the cowling.
HULL = (
    (0.140, 0.345, 0.595, 0.40, 0.060),
    (0.215, 0.300, 0.635, 0.52, 0.070),
    (0.310, 0.280, 0.585, 0.46, 0.070),
    (0.400, 0.278, 0.575, 0.44, 0.070),
    (0.500, 0.280, 0.585, 0.46, 0.070),
    (0.610, 0.290, 0.680, 0.56, 0.080),
    (0.730, 0.315, 0.715, 0.54, 0.075),
    (0.870, 0.370, 0.650, 0.34, 0.050),
    (0.980, 0.430, 0.575, 0.16, 0.035),
)
SEAT = (
    (0.295, 0.560, 0.650, 0.30, 0.045),
    (0.360, 0.550, 0.663, 0.34, 0.045),
    (0.450, 0.548, 0.665, 0.34, 0.045),
    (0.530, 0.560, 0.672, 0.24, 0.040),
)
HUMP = (
    (0.150, 0.545, 0.660, 0.22, 0.040),
    (0.190, 0.555, 0.760, 0.30, 0.050),
    (0.240, 0.560, 0.780, 0.34, 0.050),
    (0.290, 0.560, 0.660, 0.32, 0.050),
)
COWL = (
    (0.610, 0.590, 0.740, 0.42, 0.055),
    (0.690, 0.575, 0.790, 0.50, 0.065),
    (0.790, 0.570, 0.775, 0.46, 0.060),
    (0.880, 0.570, 0.700, 0.30, 0.045),
)
# repulsor pod, stationed relative to its own centre so the front and rear pods share a shape
POD = (
    (-0.095, 0.068, 0.144, 0.12, 0.025),
    (-0.045, 0.030, 0.170, 0.28, 0.045),
    (0.030, 0.025, 0.175, 0.30, 0.050),
    (0.090, 0.070, 0.155, 0.14, 0.030),
)
POD_X = (("front", 0.800), ("rear", 0.235))
POD_Y = 0.350        # pod centreline: the 0.30-wide pod reaches exactly half the width
BIG_SEGMENTS = 16    # 22.5 degree facets: smooth, and below the bevel's angle limit
SMALL_SEGMENTS = 10  # grips, pegs and other parts under 100 mm across

_FALLBACK = {"trim": "primary", "secondary": "trim", "emissive": "trim", "glass": "secondary"}


def _has_role(roles, role):
    """True when the spec carries its own material for `role`: roles_from_materials() fills a
    missing role with its fallback's index, so a role equal to its fallback was not in the spec."""
    fallback = _FALLBACK.get(role)
    return fallback is not None and roles.get(role) != roles.get(fallback)


def _station(table, xf):
    """Interpolate a station table at a fraction of the length: (belly, deck, width, radius)."""
    lo, hi, t = table[0], table[0], 0.0
    if xf >= table[-1][0]:
        lo = hi = table[-1]
    elif xf > table[0][0]:
        for a, b in zip(table, table[1:]):
            if a[0] <= xf <= b[0]:
                lo, hi, t = a, b, (xf - a[0]) / (b[0] - a[0])
                break
    return tuple(lo[i] + (hi[i] - lo[i]) * t for i in range(1, 5))


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/secondary/trim/emissive/glass to
    material slot indices; `variant` is accepted for later options and unused."""
    L, W, H = float(dim.x), float(dim.y), float(dim.z)
    hull_slot = roles.get("primary", 0)          # hull, cowling, nacelles and pylons
    trim = roles.get("trim", hull_slot)          # strake, vents, bars, pegs, bells, seams, pods
    lamp = roles.get("emissive", trim)           # nose lamp, dash lamps, glow discs, light bar
    seat_slot = roles.get("secondary", trim)     # saddle and backrest hump
    glass = roles["glass"] if _has_role(roles, "glass") else trim  # a trim screen without glass
    parts, bones = [], []

    def add(ob, bone=None):
        """Link a part; `bone` names the moving part it belongs to."""
        if bone:
            ops.tag_part(ob, bone)
        parts.append(ob)
        return ob

    def moving(bone, pivot, axis, angle, label, length):
        bones.append({"bone": bone, "group": bone, "motion": "rotate", "pivot": [float(v) for v in pivot],
                      "axis": [float(v) for v in axis], "angle": float(angle), "label": label, "length": length})

    def frame(xf, table=HULL, grow=0.0, height=None, drop=0.0, cy=0.0, shift=0.0):
        """A loft_x section from a station table, optionally grown into a proud collar or
        flattened to a fixed height (a strake) and dropped down the flank."""
        bf, tf, wf, rf = _station(table, xf)
        h = (tf - bf) * H + grow if height is None else height
        return ((xf + shift) * L, cy, (bf + tf) / 2 * H - drop, wf * W + grow, h, rf * W + grow * 0.4)

    def belly(xf):
        """A loft_x section for the ventral plate: a flat strip riding just under the belly."""
        bf, _, wf, _ = _station(HULL, xf)
        return (xf * L, 0.0, bf * H + 0.012 * H, wf * W * 0.60, 0.060 * H, 0.020 * W)

    # --- hull, flank strake, side intakes and panel seams ---------------------------------------------
    add(ops.loft_x("hull", [frame(s[0]) for s in HULL], hull_slot, corner_segments=3))
    add(ops.loft_x("flank_strake", [frame(xf, grow=0.026 * W, height=0.075 * H, drop=0.060 * H)
                                    for xf in (0.185, 0.30, 0.45, 0.60, 0.73, 0.86)], trim, corner_segments=3))
    vent_y = _station(HULL, 0.665)[2] * W / 2 + 0.014 * W
    add(ops.mirror(ops.ribs("intake_vents", 0.600 * L, 0.725 * L, vent_y, 0.545 * H, 4,
                            (0.020 * L, 0.09 * W, 0.130 * H), trim), "Y"))
    for name, xf, width in (("deck_seam_tank", 0.555, 0.36), ("deck_seam_nose", 0.930, 0.18)):
        deck = _station(HULL, xf)[1] * H
        add(ops.box(name, (0.012 * L, width * W, 0.045 * H), (xf * L, 0.0, deck + 0.014 - 0.0225 * H), trim))
    add(ops.loft_x("belly_plate", [belly(xf) for xf in (0.290, 0.420, 0.550, 0.680, 0.800)], trim, corner_segments=3))

    # --- nose: a proud collar and the lamp that sets the front of the bounding box -------------------
    add(ops.loft_x("nose_collar", [frame(xf, grow=0.030 * W) for xf in (0.905, 0.945, 0.972)], trim, corner_segments=3))
    add(ops.rounded_box("nose_lamp", (0.026 * L, 0.15 * W, 0.13 * H), (L - 0.013 * L, 0.0, 0.502 * H),
                        0.030 * W, lamp, corner_segments=3, axis="X"))

    # --- cowling, windscreen and dash ----------------------------------------------------------------
    add(ops.loft_x("front_cowl", [frame(s[0], COWL) for s in COWL], hull_slot, corner_segments=3))
    rake = math.radians(30.0)
    up = Vector((-math.sin(rake), 0.0, math.cos(rake)))       # up the screen: back and over
    face = Vector((math.cos(rake), 0.0, math.sin(rake)))      # screen thickness, pointing forward
    side = Vector((0.0, 1.0, 0.0))
    thick = 0.024 * W
    screen_base = Vector((0.755 * L, 0.0, 0.700 * H))
    span = (H - thick / 2 * face.z - screen_base.z) / up.z    # the top of the screen lands on H
    add(ops.loft("windscreen", [(screen_base + up * (span * t) + face * (bow * W), side, face, w * W, thick, 0.008 * W)
                                for t, w, bow in ((0.0, 0.38, 0.0), (0.5, 0.35, 0.016), (1.0, 0.22, 0.0))],
                 glass, corner_segments=3))
    add(ops.box("dash", (0.041 * L, 0.30 * W, 0.111 * H), (0.700 * L, 0.0, 0.744 * H), trim))
    add(ops.ribs("dash_lamps", -0.085 * W, 0.085 * W, 0.700 * L, 0.812 * H, 2,
                 (0.030 * L, 0.09 * W, 0.022 * H), lamp, axis="Y"))

    # --- handlebars on a tilted stem (moving part) ---------------------------------------------------
    tilt = math.radians(22.0)
    steer_axis = Vector((-math.sin(tilt), 0.0, math.cos(tilt)))
    stem_base = Vector((0.700 * L, 0.0, 0.620 * H))
    stem_len = 0.240 * H
    bar = stem_base + steer_axis * stem_len
    stem = ops.cylinder("steering_stem", 0.060 * W, stem_len * 1.4, (0.0, 0.0, 0.0), "Z", 12, trim)
    ops.rotate_about_center(stem, (0.0, -tilt, 0.0))
    add(ops.translate(stem, stem_base + steer_axis * (stem_len * 0.3)), "handlebars")
    add(ops.cylinder("handlebar", 0.030 * W, 0.62 * W, bar, "Y", 12, trim), "handlebars")
    grips = ops.cylinder("handlebar_grips", 0.042 * W, 0.16 * W, (bar.x, 0.300 * W, bar.z), "Y", SMALL_SEGMENTS, trim)
    add(ops.mirror(grips, "Y"), "handlebars")
    levers = ops.box("brake_levers", (0.050 * L, 0.018 * W, 0.026 * H),
                     (bar.x + 0.030 * L, 0.245 * W, bar.z - 0.014 * H), trim, rotation=(0.0, math.radians(8), 0.0))
    add(ops.mirror(levers, "Y"), "handlebars")
    add(ops.box("bar_clamp", (0.035 * L, 0.11 * W, 0.060 * H), (bar.x, 0.0, bar.z + 0.006 * H), trim), "handlebars")
    moving("handlebars", stem_base, steer_axis, 25.0, "steer", 0.07)

    # --- saddle, backrest hump and foot pegs -----------------------------------------------------------
    add(ops.loft_x("saddle", [frame(s[0], SEAT) for s in SEAT], seat_slot, corner_segments=3))
    add(ops.loft_x("tail_hump", [frame(s[0], HUMP) for s in HUMP], seat_slot, corner_segments=3))
    add(ops.mirror(ops.box("peg_mounts", (0.045 * L, 0.10 * W, 0.10 * H),
                           (0.480 * L, 0.270 * W, 0.340 * H), trim), "Y"))
    add(ops.mirror(ops.cylinder("foot_pegs", 0.030 * W, 0.19 * W, (0.480 * L, 0.385 * W, 0.325 * H),
                                "Y", SMALL_SEGMENTS, trim), "Y"))

    # --- twin thrusters: nacelles on pylons, vectoring bells (moving) and exhaust discs ---------------
    nacelle = Vector((0.0, 0.290 * W, 0.430 * H))
    add(ops.mirror(ops.revolve("thruster_nacelles", [
        (0.100 * L, 0.132 * W), (0.135 * L, 0.140 * W), (0.190 * L, 0.132 * W),
        (0.235 * L, 0.110 * W), (0.258 * L, 0.050 * W),
    ], "X", BIG_SEGMENTS, hull_slot, center=nacelle), "Y"))
    add(ops.mirror(ops.box("nacelle_pylons", (0.115 * L, 0.18 * W, 0.16 * H),
                           (0.198 * L, 0.235 * W, 0.455 * H), hull_slot), "Y"))
    # the bell waists at its throat and buries its front ring in the nacelle; the emissive
    # exhaust disc closes the mouth and sets the back of the bounding box
    add(ops.mirror(ops.revolve("thruster_bells", [
        (0.020 * L, 0.130 * W), (0.045 * L, 0.092 * W), (0.070 * L, 0.100 * W), (0.105 * L, 0.128 * W),
    ], "X", BIG_SEGMENTS, trim, center=nacelle), "Y"), "nozzles")
    add(ops.mirror(ops.cylinder("exhaust_discs", 0.115 * W, 0.020 * L,
                                (0.010 * L, nacelle.y, nacelle.z), "X", BIG_SEGMENTS, lamp), "Y"), "nozzles")
    moving("nozzles", (0.100 * L, 0.0, nacelle.z), (0.0, 1.0, 0.0), -20.0, "vector", 0.09)
    # the light bar stands proud of the tail cap, inboard of both nacelles
    add(ops.box("tail_light_bar", (0.015 * L, 0.32 * W, 0.045 * H), (0.135 * L, 0.0, 0.528 * H), lamp))

    # --- repulsor pods on pylons, their glow discs sitting on z = 0 -----------------------------------
    glow_h = 0.090 * H  # tall enough that a lit band shows under the pod from a level view
    for tag, xf in POD_X:
        add(ops.mirror(ops.rounded_box("pad_pylon_" + tag, (0.055 * L, 0.30 * W, 0.220 * H),
                                       (xf * L, 0.270 * W, 0.235 * H), 0.030 * W, hull_slot,
                                       corner_segments=2, axis="Y"), "Y"))
        pod = ops.loft_x("repulsor_pod_" + tag, [frame(s[0], POD, cy=POD_Y * W, shift=xf) for s in POD],
                         trim, corner_segments=3)
        add(ops.mirror(pod, "Y"))
        add(ops.mirror(ops.cylinder("repulsor_glow_" + tag, 0.125 * W, glow_h,
                                    (xf * L, POD_Y * W, glow_h / 2), "Z", BIG_SEGMENTS, lamp), "Y"))

    present = {b["bone"] for b in bones}
    actions = [a for a in ACTIONS if all(p in present for p in a["parts"])]
    return parts, dict(FINISHING), {"bones": bones, "actions": actions}
