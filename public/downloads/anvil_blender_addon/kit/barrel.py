"""Barrel family: containers built as solids of revolution around Z.

barrel: a 55-gallon steel drum. One revolve whose profile steps out for the two rolling hoops
(one third and two thirds up) and for the top and bottom chimes, folds over the top rim to a
lid recessed below it with a rolled bead ring, plus two bungs (round flange and hexagonal plug)
on the lid. The hoops define the width and the rim the height, so the bounding box equals the
requested dimensions. Painted body on the primary slot, hoops, chimes, bead and bungs on trim.
Nothing moves.

potion: a stylized alchemy flask. The glass body is a revolve (ellipsoidal bulb cut flat at
the foot, long neck, flared lip with a bore for the cork), the liquid a second revolve inset
inside the bulb up to the fill level (emissive slot), the cork a tapered revolve in the bore
(secondary slot) and a wax-seal bead around the neck (trim when the spec has one, else the
cork's slot). The bulb sets the width, the cork's top the height. The cork is tagged as a
moving part that slides up out of the neck: clip "uncork".

A non-square footprint (dim.y != dim.x) squashes every part in Y so the box still fits.
"""
import math

from mathutils import Matrix

from . import ops

KINDS = ("barrel", "potion")
FINISHING = {
    "barrel": {"bevel": (0.002, 1), "smooth_angle": 40},
    "potion": {"bevel": (0.001, 1), "smooth_angle": 40},
}
# demo clips: fraction of each part's travel per frame (24 fps)
ACTIONS = {
    "barrel": [],
    "potion": [{"name": "uncork", "parts": ["cork"], "keys": [(1, 0.0), (12, 1.0)]}],
}


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/secondary/trim/emissive/glass to
    material slot indices. Potion variant: {"fill": 0.65} sets how full the bulb is."""
    variant = dict(variant or {})
    W, D, H = float(dim.x), float(dim.y), float(dim.z)
    parts, bones = (_barrel if kind == "barrel" else _potion)(W, H, roles, variant)
    if abs(D - W) > 1e-6:  # elliptical footprint: squash the revolves in Y to the spec's depth
        squash = Matrix.Diagonal((1.0, D / W, 1.0, 1.0))
        for ob in parts:
            ob.data.transform(squash)
            ob.data.update()
    present = {b["bone"] for b in bones}
    actions = [a for a in ACTIONS[kind] if all(p in present for p in a["parts"])]
    return parts, dict(FINISHING[kind]), {"bones": bones, "actions": actions}


def _paint(ob, slot, keep):
    """Move every face whose centre (height z, radius r from the Z axis) satisfies keep(z, r) to slot."""
    for poly in ob.data.polygons:
        c = poly.center
        if keep(c.z, math.hypot(c.x, c.y)):
            poly.material_index = slot
    return ob


# --- barrel -----------------------------------------------------------------------------------------

def _barrel(W, H, roles, variant):
    paint = roles.get("primary", 0)
    rust = roles.get("trim", paint)
    s = min(W / 0.6, H / 0.88)              # detail sizes below are given for a 0.6 x 0.88 drum
    R = W / 2                               # the rolling hoops define the width
    r_body = R - 0.012 * s
    r_chime = r_body + 0.008 * s
    chime_h, hoop_h = 0.015 * s, 0.030 * s
    lid_z = H - 0.012 * s                   # lid recessed below the top rim
    r_rim_in = r_chime - 0.014 * s          # inside of the top rim
    bead_out, bead_in, bead_h = r_body * 0.80, r_body * 0.74, 0.006 * s
    hoops = (H / 3, 2 * H / 3)

    profile = [(0.0, r_chime), (chime_h, r_chime), (chime_h, r_body)]
    for h in hoops:
        profile += [(h - hoop_h / 2, r_body), (h - hoop_h / 2, R), (h + hoop_h / 2, R), (h + hoop_h / 2, r_body)]
    profile += [
        (H - chime_h, r_body), (H - chime_h, r_chime), (H, r_chime),      # top chime
        (H, r_rim_in), (lid_z, r_rim_in),                                # over the rim, down to the lid
        (lid_z, bead_out), (lid_z + bead_h, (bead_out + bead_in) / 2), (lid_z, bead_in),  # rolled bead ring
    ]
    drum = ops.revolve("drum", profile, "Z", 24, paint)

    eps = 0.001 * s

    def rusty(z, r):
        if z <= chime_h + eps:                                              # bottom chime and base
            return True
        if z >= H - chime_h - eps and r >= r_rim_in - 0.006 * s:            # top chime, rim top, inner rim wall
            return True
        if r >= r_body + 0.002 * s and any(abs(z - h) <= hoop_h / 2 + eps for h in hoops):  # rolling hoops
            return True
        return lid_z - eps <= z <= lid_z + bead_h + eps and bead_in - eps <= r <= bead_out + eps  # bead

    _paint(drum, rust, rusty)
    parts = [drum]

    # two bungs on a diameter of the lid (a 2" and a 3/4" fitting): a round flange sunk 2 mm into
    # the lid and a hexagonal plug on it, topping out 1 mm below the rim
    for name, x, r_flange, r_plug in (("large", 0.155 * s, 0.034 * s, 0.024 * s), ("small", -0.155 * s, 0.026 * s, 0.017 * s)):
        parts.append(ops.cylinder("bung_" + name, r_flange, 0.008 * s, (x, 0.0, lid_z + 0.002 * s), "Z", 16, rust))
        parts.append(ops.cylinder("bung_" + name + "_plug", r_plug, 0.007 * s, (x, 0.0, lid_z + 0.0075 * s), "Z", 6, rust))
    return parts, []


# --- potion -----------------------------------------------------------------------------------------

def _potion(W, H, roles, variant):
    glass = roles.get("glass", 0)
    liquid = roles.get("emissive", glass)
    cork = roles.get("secondary", roles.get("trim", glass))
    trim = roles.get("trim", cork)
    wax = trim if trim not in (glass, liquid) else cork   # the potion spec usually has no trim slot
    s = min(W / 0.1, H / 0.22)              # detail sizes below are given for a 0.1 x 0.22 flask
    R = W / 2                               # the bulb defines the width
    segments = 20                           # divisible by 4: vertices on both axes keep the box exact

    # bulb: an ellipsoid R wide and `a` tall, cut flat at the foot so it rests on z = 0
    a = 1.16 * R
    foot_r, neck_r = 0.56 * R, 0.28 * R
    u_foot = -math.sqrt(1.0 - (foot_r / R) ** 2)
    u_top = math.sqrt(1.0 - (neck_r / R) ** 2)
    zc = -u_foot * a

    def bulb(u):
        return (zc + a * u, R * math.sqrt(max(0.0, 1.0 - u * u)))

    travel = 0.030 * s                      # the cork stands this much proud of the lip and slides this far
    lip_top = H - travel
    neck_top = lip_top - 0.025 * s
    bore_r, bore_d = 0.236 * R, 0.032 * s
    bulb_pts = [bulb(u) for u in (u_foot, -0.70, -0.50, -0.25, 0.0, 0.25, 0.50, 0.70, 0.85, u_top)]
    profile = bulb_pts + [
        (neck_top, neck_r),                                                         # straight neck
        (neck_top + 0.005 * s, 0.39 * R), (lip_top - 0.005 * s, 0.41 * R), (lip_top, 0.34 * R),  # flared lip
        (lip_top, bore_r), (lip_top - bore_d, bore_r),                              # bore for the cork
    ]
    parts = [ops.revolve("flask", profile, "Z", segments, glass)]

    # liquid: the bulb inset by 3 mm, filled to `fill` of the bulb's height, flat surface on top
    inset = 0.06 * R
    fill = min(0.95, max(0.1, float(variant.get("fill", 0.65))))
    z_fill = bulb(u_top)[0] * fill
    liq = [(z + inset, r - inset) for z, r in bulb_pts if z + inset < z_fill - 0.004 * s]
    u_fill = (z_fill - zc) / a
    liq.append((z_fill, R * math.sqrt(max(0.0, 1.0 - u_fill * u_fill)) - inset))
    parts.append(ops.revolve("liquid", liq, "Z", segments, liquid))

    # cork: tapered, wedged in the bore (slightly wider than the mouth so no seam shows), 3 cm proud
    z_cork = lip_top - bore_d + 0.002 * s
    stopper = ops.revolve("cork", [(z_cork, bore_r - 0.0008 * s), (lip_top, bore_r + 0.0007 * s), (H, 0.30 * R)], "Z", 16, cork)
    ops.tag_part(stopper, "cork")
    parts.append(stopper)
    bones = [{"bone": "cork", "group": "cork", "motion": "slide", "pivot": [0.0, 0.0, (z_cork + H) / 2],
              "axis": [0.0, 0.0, 1.0], "travel": travel, "label": "uncork", "length": travel}]

    # wax seal: a diamond-section bead around the neck below the lip, its inner edge inside the glass
    parts.append(ops.torus("wax_seal", neck_r + 0.003 * s, 0.004 * s, (0.0, 0.0, neck_top - 0.012 * s), "Z", 16, 4, wax))
    return parts, bones
