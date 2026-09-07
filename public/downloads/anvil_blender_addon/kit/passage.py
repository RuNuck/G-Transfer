"""Passage family: architecture modules assembled from parametric parts.

stairs: a stylized stone stair run of equal rise and run (8 treads for a 2 m by 2 m module)
built as stacked full-width slabs, each tread with a proud nosing lip, stepped side parapets
and moss cushions in the corners. The nosing line of the first step is the module's near
edge (y = 0), the riser faces sit one lip behind it, the top tread's face is at z = height
exactly and nothing leaves the requested box. No moving parts.

door: a hard-surface bulkhead door. A stepped frame ring (outer lip at the full thickness,
riveted inner band 3 mm lower so the rivet heads and lamp strips finish flush with the lip),
a rounded leaf with a window slit, stiffener ribs and kick plates on both faces, a spoked
pressure wheel on the front face sunk inside the frame's thickness, three hinge knuckles on
the -X jamb and lamp strips over the opening. Moving parts: the leaf (with everything mounted
on it) swings open about the hinge line, and the wheel turns half a revolution about its axis.
Bones are all children of root, so the wheel stays put while the leaf swings in the demo clip.
"""
import math

from . import ops

KINDS = ("stairs", "door")
FINISHING = {
    "stairs": {"bevel": (0.006, 1), "smooth_angle": 35},
    "door": {"bevel": (0.0015, 1), "smooth_angle": 32},
}

# stairs
STEP_RISE = 0.25       # nominal rise: the tread count is height / STEP_RISE, rounded
NOSING_LIP = 0.02      # how far the nosing overhangs the riser
NOSING_T = 0.015       # nosing slab thickness (the top face is flush with the tread)
NOSING_D = 0.06        # how far the slab reaches back onto the tread
PARAPET_W = 0.1
PARAPET_H = 0.2        # side blocks rise this much above their tread (clamped to the height)
MOSS_T = 0.015         # moss cushions: at least 2.5 bevel widths so they never clamp the bevel

# door
DOOR_ACTIONS = [
    {"name": "open", "parts": ["leaf"], "keys": [(1, 0.0), (24, 1.0)]},
    {"name": "turn", "parts": ["wheel"], "keys": [(1, 0.0), (16, 1.0)]},
]
_FALLBACK = {"trim": "primary", "secondary": "trim", "emissive": "trim", "glass": "secondary"}


def _has_role(roles, role):
    """True when the spec carries its own material for `role`. roles_from_materials() fills a
    missing role with its fallback's index, so a role equal to its fallback was not in the spec."""
    fallback = _FALLBACK.get(role)
    return fallback is not None and roles.get(role) != roles.get(fallback)


def _slot(roles, role, default):
    return roles[role] if _has_role(roles, role) else default


def _spread(a, b, count):
    """`count` positions evenly spaced from a to b inclusive."""
    if count == 1:
        return [(a + b) / 2]
    return [a + (b - a) * i / (count - 1) for i in range(count)]


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `variant` is accepted for later options and unused."""
    if kind == "stairs":
        parts = _stairs(dim, roles)
        return parts, dict(FINISHING["stairs"]), {"bones": [], "actions": []}
    parts, bones = _door(dim, roles)
    present = {b["bone"] for b in bones}
    actions = [a for a in DOOR_ACTIONS if all(p in present for p in a["parts"])]
    return parts, dict(FINISHING["door"]), {"bones": bones, "actions": actions}


# --- stairs -----------------------------------------------------------------------------------------

def _stairs(dim, roles):
    W, D, H = float(dim.x), float(dim.y), float(dim.z)
    stone = roles.get("primary", 0)
    moss = _slot(roles, "secondary", stone)
    trim = roles.get("trim", stone)          # nosings; falls back to stone when the spec has no trim
    steps = max(2, int(round(H / STEP_RISE)))
    rise, run = H / steps, D / steps
    lip = min(NOSING_LIP, run * 0.1)
    nose_t = min(NOSING_T, rise * 0.1)
    nose_d = min(NOSING_D, run * 0.3)
    side_w = min(PARAPET_W, W * 0.1)
    parapet_h = min(PARAPET_H, rise * 0.8)
    parts = []

    def riser_y(i):
        """Riser face of step i: one lip behind the nosing line, so the first nosing is at y = 0."""
        return min(lip + i * run, D)

    def parapet(i):
        """(y0, y1, height) of the side blocks on tread i, or None when they would leave the box."""
        top = (i + 1) * rise
        h = min(parapet_h, H - top)
        if h < 0.02:
            return None
        return riser_y(i), riser_y(i + 1), h

    for i in range(steps):
        n = i + 1
        top = n * rise
        y0 = riser_y(i)
        parts.append(ops.box("step_%d" % n, (W, D - y0, rise), (W / 2, (y0 + D) / 2, top - rise / 2), stone))
        nd = lip + nose_d
        parts.append(ops.box("nosing_%d" % n, (W, nd, nose_t), (W / 2, i * run + nd / 2, top - nose_t / 2), trim))
        span = parapet(i)
        if span:
            py0, py1, ph = span
            for tag, x in (("l", side_w / 2), ("r", W - side_w / 2)):
                parts.append(ops.box("parapet_%s_%d" % (tag, n), (side_w, py1 - py0, ph), (x, (py0 + py1) / 2, top + ph / 2), stone))

    # moss: cushions in the tread corners against the parapets, drips on two risers, caps on two parapets
    cushion = MOSS_T
    for k, i in enumerate(i for i in range(1, steps - 1) if i % 3 != 2):
        top = (i + 1) * rise
        y1 = riser_y(i + 1)
        w, d = min(0.3, W * 0.2), min(0.16, run * 0.6)
        left = k % 2 == 0
        x = side_w - 0.005 + w / 2 if left else W - side_w + 0.005 - w / 2
        parts.append(ops.box("moss_tread_%d" % (i + 1), (w, d, cushion), (x, y1 + 0.005 - d / 2, top + cushion / 2), moss))
    for k, i in enumerate(range(2, steps - 1, 3)):
        yr = riser_y(i)
        w, h = min(0.3, W * 0.2), min(0.11, rise * 0.45)
        x = W * (0.62 if k % 2 == 0 else 0.34)
        z0 = i * rise + rise * 0.15
        parts.append(ops.box("moss_riser_%d" % (i + 1), (w, cushion, h), (x, yr + 0.003 - cushion / 2, z0 + h / 2), moss))
    for k, i in enumerate(range(1, steps - 1, 4)):
        span = parapet(i)
        if not span:
            continue
        py0, py1, ph = span
        top = (i + 1) * rise
        right = k % 2 == 0
        x = W - side_w / 2 if right else side_w / 2
        parts.append(ops.box("moss_cap_%d" % (i + 1), (side_w * 0.8, (py1 - py0) * 0.55, cushion), (x, (py0 + py1) / 2, top + ph + cushion / 2), moss))
    return parts


# --- door -------------------------------------------------------------------------------------------

def _ring(prefix, x0, x1, z0, z1, width, thickness, slot):
    """Four boxes forming a rectangular ring in the XZ plane, centred on y = 0."""
    return [
        ops.box(prefix + "_left", (width, thickness, z1 - z0), (x0 + width / 2, 0, (z0 + z1) / 2), slot),
        ops.box(prefix + "_right", (width, thickness, z1 - z0), (x1 - width / 2, 0, (z0 + z1) / 2), slot),
        ops.box(prefix + "_top", (x1 - x0 - 2 * width, thickness, width), ((x0 + x1) / 2, 0, z1 - width / 2), slot),
        ops.box(prefix + "_bottom", (x1 - x0 - 2 * width, thickness, width), ((x0 + x1) / 2, 0, z0 + width / 2), slot),
    ]


def _rib_row(name, z0, z1, x, y, count, size, slot):
    """`count` horizontal ribs of `size` stacked between z0 and z1 on a face at (x, y)."""
    return ops.ribs(name, z0, z1, x, y, count, size, slot, axis="Z")


def _door(dim, roles):
    W, T, H = float(dim.x), float(dim.y), float(dim.z)
    hull = roles.get("primary", 0)
    trim = roles.get("trim", hull)
    lamp = roles.get("emissive", trim)
    panel = _slot(roles, "secondary", hull)                     # ribs: hull unless the spec has a panel material
    pane_slot = roles["glass"] if _has_role(roles, "glass") else lamp  # a lit slit when there is no glass
    parts, bones = [], []

    def add(ob, bone=None):
        if bone:
            ops.tag_part(ob, bone)
        parts.append(ob)
        return ob

    def moving(bone, pivot, axis, angle, label, length):
        bones.append({"bone": bone, "group": bone, "motion": "rotate", "pivot": [float(v) for v in pivot],
                      "axis": [float(v) for v in axis], "angle": float(angle), "label": label, "length": length})

    half = T / 2
    proud = 0.003                              # rivet heads and lamps stand this far off the band, flush with the lip
    lip_w = min(0.035, W * 0.025)
    band_w = min(0.085, W * 0.06)
    frame_w = lip_w + band_w                   # 0.12 on the test piece
    band_face = half - proud

    # --- frame: outer lip at the full thickness, recessed riveted band inside it --------------------
    for ob in _ring("lip", 0.0, W, 0.0, H, lip_w, T, hull):
        add(ob)
    for ob in _ring("band", lip_w, W - lip_w, lip_w, H - lip_w, band_w, T - 2 * proud, hull):
        add(ob)
    jamb_x = (lip_w + band_w / 2, W - lip_w - band_w / 2)
    header_z = H - lip_w - band_w / 2
    sill_z = lip_w + band_w / 2
    rivet_r, rivet_h = 0.009, proud + 0.002    # 2 mm of the head is sunk into the band
    front = []
    for x in jamb_x:
        front += [(x, -half + rivet_h / 2, z) for z in _spread(sill_z + band_w, header_z - band_w, 4)]
    front += [(x, -half + rivet_h / 2, header_z) for x in _spread(frame_w + 0.16, W - frame_w - 0.16, 2)]
    back = [(x, half - rivet_h / 2, z) for x in jamb_x for z in _spread(sill_z + band_w, header_z - band_w, 3)]
    rivets = add(ops.fasteners("rivets_front", front, rivet_r, rivet_h, "Y", trim, 6))
    ops.rotate_about_center(rivets, (math.pi, 0.0, 0.0))  # heads taper outwards on the front face too
    add(ops.fasteners("rivets_back", back, rivet_r, rivet_h, "Y", trim, 6))
    for side, tag in ((-1, "front"), (1, "back")):
        add(ops.box("lamp_" + tag, (min(0.6, W * 0.42), 2 * proud, 0.028), (W / 2, side * band_face, header_z), lamp))

    # --- leaf with window slit, ribs and kick plates ------------------------------------------------
    gap = 0.008
    lx0, lx1 = frame_w + gap, W - frame_w - gap
    lz0, lz1 = frame_w + gap, H - frame_w - gap
    lw, lh, lt = lx1 - lx0, lz1 - lz0, 0.06
    cx, cz = (lx0 + lx1) / 2, (lz0 + lz1) / 2
    face = lt / 2
    leaf = ops.rounded_box("leaf", (lw, lt, lh), (cx, 0, cz), 0.02, hull, corner_segments=4, axis="Y")
    slit_w, slit_h = min(0.56, lw * 0.5), 0.10
    slit_z = lz1 - 0.27
    ops.boolean_cut(leaf, ops.box("window_cutter", (slit_w, lt + 0.02, slit_h), (cx, 0, slit_z), hull))
    add(leaf, "leaf")
    add(ops.box("window_pane", (slit_w + 0.012, 0.008, slit_h + 0.012), (cx, 0, slit_z), pane_slot), "leaf")
    wheel_R = min(0.19, lw * 0.17)
    rib_d, rib_len = 0.012, lw * 0.78
    kick_h = 0.28
    lower = (lz0 + kick_h + 0.05, cz - wheel_R - 0.05)
    upper = (cz + wheel_R + 0.05, slit_z - slit_h / 2 - 0.05)
    for side, tag in ((-1, "front"), (1, "back")):
        y = side * (face + rib_d / 2 - 0.004)
        add(_rib_row("ribs_lower_" + tag, lower[0], lower[1], cx, y, 3, (rib_len, rib_d, 0.07), panel), "leaf")
        add(_rib_row("ribs_upper_" + tag, upper[0], upper[1], cx, y, 2, (rib_len, rib_d, 0.07), panel), "leaf")
        add(ops.box("kick_plate_" + tag, (lw - 0.06, 0.008, kick_h), (cx, side * (face + 0.002), lz0 + 0.02 + kick_h / 2), trim), "leaf")

    # --- pressure wheel on the front face, inside the frame's thickness -----------------------------
    wy = -(face + 0.032)
    add(ops.torus("wheel_rim", wheel_R, 0.017, (cx, wy, cz), "Y", 20, 16, trim), "wheel")
    for k, (dx, dz) in enumerate(((1, 0), (0, 1), (-1, 0), (0, -1))):
        add(ops.cylinder("wheel_spoke_%d" % (k + 1), 0.011, wheel_R, (cx + dx * wheel_R / 2, wy, cz + dz * wheel_R / 2), "X" if dx else "Z", 6, trim), "wheel")
    add(ops.cylinder("wheel_hub", 0.045, 0.06, (cx, -(face + 0.022), cz), "Y", 8, trim), "wheel")
    add(ops.box("wheel_marker", (0.04, 0.036, 0.05), (cx, wy, cz + wheel_R), hull), "wheel")
    moving("wheel", (cx, wy, cz), (0, 1, 0), 180.0, "turn", 0.05)

    # --- hinge knuckles on the -X jamb; the leaf swings about their axis ----------------------------
    kx, ky = frame_w + 0.01, -(face + 0.02)
    for k, z in enumerate((lz0 + 0.3, cz, lz1 - 0.3)):
        add(ops.cylinder("hinge_knuckle_%d" % (k + 1), 0.026, 0.2, (kx, ky, z), "Z", 8, trim))
    moving("leaf", (kx, ky, lz0), (0, 0, 1), -80.0, "open", 0.3)
    return parts, bones
