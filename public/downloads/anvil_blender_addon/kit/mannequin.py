"""Mannequin family: a segmented art mannequin (wooden-figure / engine-mannequin style) standing
in a relaxed A-pose, assembled from parametric parts.

Layout in metres, Z up, soles on z = 0, facing -Y, centred on x = 0: an egg-shaped head with a
nose and eyes, a neck, an elliptical torso lofted through shoulders, chest and waist, a pelvis,
ball joints at the shoulders, elbows, wrists, hips, knees and ankles, tapered limbs, rounded
hands (palms in) and rounded feet with the toes toward -Y. Every measurement below is for a
1.8 m figure and scales with the requested height, so the proportions hold at any size.

The bounding box equals the requested dimensions exactly: the top of the head sets the height,
the toes and the upper back set the depth (the chest depth is derived from the spec's depth,
the foot length from what is left in front of the ankle), and the arm angle is solved so that
the outermost point of the hanging arms lands on the requested width. A true 35-degree A-pose
needs about 1.25 m of width for a 1.8 m figure; at 0.55 m the arms hang about 7 degrees off
vertical, which is what a 0.55 m wide standing figure has to look like.

Moving part: the head turns about Z (a "look" clip). Nothing else is animated.
"""
import math

from mathutils import Vector

from . import ops

KINDS = ("mannequin",)
FINISHING = {"bevel": (0.003, 1), "smooth_angle": 42}
REF_HEIGHT = 1.8                  # the measurements below are for a 1.8 m figure
FOOT_ANKLE = 0.72                 # the ankle sits this far along the foot, heel to toe
MAX_ARM_ANGLE = math.radians(60)  # widest A-pose before the solver gives up on the width
SIDES = ((1, "l"), (-1, "r"))     # +X is the figure's left (it faces -Y)

# torso and pelvis rings, top to bottom: (z, width, depth as a fraction of the chest depth).
# The torso narrows into the pelvis while the pelvis widens out of the torso, so the two
# surfaces cross at the waist and neither loft leaves a cap or a ledge showing.
TORSO_RINGS = (
    (1.550, 0.24, 0.72),
    (1.525, 0.37, 0.88),
    (1.490, 0.44, 0.97),   # shoulders
    (1.380, 0.40, 1.00),   # chest: the upper back sets the rear of the bounding box
    (1.250, 0.31, 0.84),   # waist
    (1.130, 0.29, 0.80),
)
PELVIS_RINGS = (
    (1.190, 0.29, 0.80),
    (1.050, 0.34, 0.95),   # hips
    (0.950, 0.31, 0.88),
    (0.885, 0.24, 0.70),
)

# demo clips: fraction of the head turn per frame (24 fps)
ACTIONS = [
    {"name": "look", "parts": ["head"], "keys": [(1, 0.0), (12, 1.0), (24, 0.0)]},
]


def _ellipse(w, h):
    return ops.ellipse(w, h, 16)


def _place(ob, rotation, center):
    """Angle a part built around the origin and move it into place."""
    ops.rotate_about_center(ob, rotation)
    ops.translate(ob, center)
    return ob


def _solve(reach, target, lo, hi, steps=64):
    """Angle in [lo, hi] at which the increasing function `reach` meets `target` (bisection)."""
    if reach(lo) >= target:
        return lo
    if reach(hi) <= target:
        return hi
    for _ in range(steps):
        mid = (lo + hi) / 2
        if reach(mid) < target:
            lo = mid
        else:
            hi = mid
    return hi


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/secondary/trim/emissive to slots:
    body segments on primary, ball joints on trim, hands and feet on secondary, eyes on emissive.
    variant {"face": "none"} drops the nose and eyes for a blank art-mannequin head."""
    variant = dict(variant or {})
    W, D, H = float(dim.x), float(dim.y), float(dim.z)
    k = H / REF_HEIGHT
    body = roles.get("primary", 0)
    joint = roles.get("trim", body)
    accent = roles.get("secondary", body)
    eye_slot = roles.get("emissive", joint)
    parts = []
    bones = []

    def add(ob, part=None):
        """Link a part; `part` names the bone a moving part belongs to."""
        if part:
            ops.tag_part(ob, part)
        parts.append(ob)
        return ob

    # --- depth: the toes set the front of the box, the upper back the rear ------------------------
    chest_d = min(max(2.0 * (D - FOOT_ANKLE * 0.26 * k), 0.18 * k), 0.26 * k)
    foot_len = (D - chest_d / 2) / FOOT_ANKLE   # what is left in front of the ankle, which stays on y = 0
    toe_y = chest_d / 2 - D

    # --- head, face and neck ----------------------------------------------------------------------
    r_head = 0.11 * k
    head_z = H - r_head
    add(ops.sphere("head", r_head, (0.0, 0.0, head_z), 16, 8, body, scale=(0.82, 0.90, 1.0)), "head")
    if variant.get("face", "simple") != "none":
        add(ops.sphere("nose", 0.017 * k, (0.0, -0.094 * k, head_z - 0.012 * k), 8, 4, body), "head")
        for s, side in SIDES:
            add(ops.sphere("eye_" + side, 0.012 * k, (s * 0.033 * k, -0.0875 * k, head_z + 0.012 * k), 8, 4, eye_slot), "head")
    bones.append({"bone": "head", "group": "head", "motion": "rotate", "pivot": [0.0, 0.0, head_z - r_head],
                  "axis": [0.0, 0.0, 1.0], "angle": 30.0, "label": "look", "length": 2 * r_head})
    add(ops.cylinder("neck", 0.05 * k, 0.10 * k, (0.0, 0.0, 1.57 * k), "Z", 12, body))

    # --- torso and pelvis: elliptical lofts along Z -----------------------------------------------
    add(ops.loft_shape("torso", [((0.0, 0.0, z * k), w * k, chest_d * d) for z, w, d in TORSO_RINGS], _ellipse, body, axis="Z"))
    add(ops.loft_shape("pelvis", [((0.0, 0.0, z * k), w * k, chest_d * d) for z, w, d in PELVIS_RINGS], _ellipse, body, axis="Z"))

    # --- arms: built vertical around the origin, angled outward by the solved A-pose angle --------
    sh_x, sh_z = 0.175 * k, 1.485 * k
    r_shoulder, r_elbow, r_wrist = 0.058 * k, 0.045 * k, 0.034 * k   # balls clearly wider than the limb ends
    len_upper, len_fore = 0.30 * k, 0.26 * k
    hand_size = (0.034 * k, 0.085 * k, 0.18 * k)          # thickness (X), width (Y), length (Z): palms in
    t_hand = len_upper + len_fore + hand_size[2] / 2 - 0.015 * k
    sh_x = min(sh_x, W / 2 - r_shoulder - 0.005 * k)       # a shoulder must never set the width
    hands = {s: ops.rounded_box("hand_" + side, hand_size, (0.0, 0.0, 0.0), 0.025 * k, accent, 3, "X") for s, side in SIDES}
    hand_pts = [(v.co.x, v.co.z) for v in hands[1].data.vertices]

    def reach(theta):
        """Outermost x of one arm hanging `theta` off vertical (the +X side)."""
        c, s = math.cos(theta), math.sin(theta)
        return max(
            sh_x + r_shoulder,
            sh_x + len_upper * s + r_elbow,
            sh_x + (len_upper + len_fore) * s + r_wrist,
            sh_x + t_hand * s + max(x * c - z * s for x, z in hand_pts),
        )

    theta = _solve(reach, W / 2, 0.0, MAX_ARM_ANGLE)
    for s, side in SIDES:
        pivot = Vector((s * sh_x, 0.0, sh_z))
        down = Vector((s * math.sin(theta), 0.0, -math.cos(theta)))
        rotation = (0.0, -s * theta, 0.0)

        def along(t, pivot=pivot, down=down):
            return pivot + down * t

        add(ops.sphere("shoulder_" + side, r_shoulder, along(0.0), 12, 6, joint))
        add(_place(ops.cone("upper_arm_" + side, 0.034 * k, 0.044 * k, len_upper, (0.0, 0.0, 0.0), "Z", 12, body), rotation, along(len_upper / 2)))
        add(ops.sphere("elbow_" + side, r_elbow, along(len_upper), 12, 6, joint))
        add(_place(ops.cone("forearm_" + side, 0.026 * k, 0.034 * k, len_fore, (0.0, 0.0, 0.0), "Z", 12, body), rotation, along(len_upper + len_fore / 2)))
        add(ops.sphere("wrist_" + side, r_wrist, along(len_upper + len_fore), 12, 6, joint))
        add(_place(hands[s], rotation, along(t_hand)))

    # --- legs: vertical, feet flat on z = 0 with the toes toward -Y ------------------------------
    hip_x, hip_z, knee_z, ankle_z = 0.092 * k, 0.935 * k, 0.52 * k, 0.10 * k
    foot_h = 0.075 * k
    for s, side in SIDES:
        x = s * hip_x
        add(ops.sphere("hip_" + side, 0.065 * k, (x, 0.0, hip_z), 12, 6, joint))
        add(ops.cone("thigh_" + side, 0.042 * k, 0.054 * k, hip_z - knee_z, (x, 0.0, (hip_z + knee_z) / 2), "Z", 12, body))
        add(ops.sphere("knee_" + side, 0.055 * k, (x, 0.0, knee_z), 12, 6, joint))
        add(ops.cone("shin_" + side, 0.030 * k, 0.042 * k, knee_z - ankle_z, (x, 0.0, (knee_z + ankle_z) / 2), "Z", 12, body))
        add(ops.sphere("ankle_" + side, 0.038 * k, (x, 0.0, ankle_z), 12, 6, joint))
        add(ops.rounded_box("foot_" + side, (0.09 * k, foot_len, foot_h), (x, toe_y + foot_len / 2, foot_h / 2), 0.03 * k, accent, 3, "X"))

    present = {b["bone"] for b in bones}
    actions = [a for a in ACTIONS if all(p in present for p in a["parts"])]
    return parts, dict(FINISHING), {"bones": bones, "actions": actions}
