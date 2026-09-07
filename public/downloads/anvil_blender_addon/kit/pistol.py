"""Pistol family: a modern polymer-frame sidearm assembled from parametric parts.

Layout in metres, resting on z = 0, beavertail at x = 0, muzzle at x = length (+X): a slide
with rear and front cocking serrations, an ejection port, an extractor, a front post and a
rear notch sight; a barrel whose muzzle ring protrudes from the slide front, over a recoil
guide rod; a polymer frame with a railed dust cover, a trigger guard loop with the trigger
inside, a grip angled back 15 degrees with a palm swell and stippling ribs, a beavertail
tang, a magazine release on the right (+Y), a slide stop on the left (-Y) and frame pins; a
steel magazine with its floorplate below the grip; a hammer on the tang behind the slide.
The bounding box equals the requested dimensions exactly: beavertail tip to muzzle in X,
slide stop to magazine release in Y, floorplate to sights in Z.

Moving parts (slide with its sights, trigger, magazine, hammer) are tagged with a vertex
group named after their bone and described in the rig spec the family returns, so
`kit.rig.apply()` can animate them: rack, trigger pull, magazine release, cock.
"""
import math

from mathutils import Matrix, Vector

from . import ops

KINDS = ("pistol",)
FINISHING = {"bevel": (0.0008, 1), "smooth_angle": 32}
GRIP_ANGLE = math.radians(15)  # positive leans the bottom of the grip backwards (-X)

# demo clips: fraction of each part's travel or angle per frame (24 fps)
ACTIONS = [
    {"name": "rack", "parts": ["slide", "hammer"], "keys": [(1, 0.0), (8, 1.0), (12, 1.0), (24, 0.0)]},
    {"name": "trigger_pull", "parts": ["trigger"], "keys": [(1, 0.0), (6, 1.0), (10, 1.0), (16, 0.0)]},
    {"name": "magazine_release", "parts": ["magazine"], "keys": [(1, 0.0), (14, 1.0)]},
    {"name": "cock", "parts": ["hammer"], "keys": [(1, 0.0), (8, 1.0), (12, 1.0), (20, 0.0)]},
]


def _tilt(ob, pivot, angle):
    """Rotate a part's geometry about `pivot`, about the Y axis (the object stays at the origin)."""
    pivot = Vector(pivot)
    ob.data.transform(Matrix.Translation(pivot) @ Matrix.Rotation(angle, 4, "Y") @ Matrix.Translation(-pivot))
    ob.data.update()
    return ob


def _sweep(name, path, width, thickness, slot):
    """Rectangular bar swept along a polyline in the XZ plane: `path` is [(point, tangent), ...],
    `width` spans Y and `thickness` the in-plane normal. Four-point rings keep it cheap."""
    rings = []
    for point, tangent in path:
        t = Vector(tangent).normalized()
        u = Vector((0.0, 1.0, 0.0))
        v = Vector((-t.z, 0.0, t.x))
        c = Vector(point)
        rings.append([c + u * px + v * py for px, py in ((width / 2, thickness / 2), (-width / 2, thickness / 2), (-width / 2, -thickness / 2), (width / 2, -thickness / 2))])
    return ops.loft_points(name, rings, slot)


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/secondary/trim to material slot indices."""
    L, W, H = float(dim.x), float(dim.y), float(dim.z)
    metal = roles.get("primary", 0)           # slide, magazine body: dark gun metal
    polymer = roles.get("secondary", metal)   # frame: dust cover, rail, trigger guard, grip, tang, floorplate
    steel = roles.get("trim", metal)          # barrel, guide rod, sights, extractor, hammer, trigger, controls, pins
    parts = []
    bones = []

    def add(ob, part=None):
        """Link a part; `part` names the bone a moving part belongs to."""
        if part:
            ops.tag_part(ob, part)
        parts.append(ob)
        return ob

    def moving(bone, motion, pivot, axis, label, **extra):
        bones.append(dict(bone=bone, group=bone, motion=motion, pivot=[float(v) for v in pivot], axis=[float(v) for v in axis], label=label, **extra))

    s, c = math.sin(GRIP_ANGLE), math.cos(GRIP_ANGLE)
    fwd = Vector((c, 0.0, -s))     # across the grip towards the front strap, in the tilted frame
    down = Vector((-s, 0.0, -c))   # along the grip axis, towards the floorplate

    # --- layout ------------------------------------------------------------------------------------------
    sight_h = H * 0.05                 # sights above the slide set the top of the box
    slide_h, slide_w = H * 0.215, W * 0.75
    slide_top = H - sight_h
    slide_bot = slide_top - slide_h
    bore = slide_top - slide_h / 2     # barrel axis
    frame_top = slide_bot + 0.001      # frame rails tuck 1 mm into the slide
    frame_h = H * 0.13
    frame_bot = frame_top - frame_h
    frame_w = W * 0.9                  # grip and rear frame width; the controls make up the last 2 mm
    muzzle = 0.001                     # barrel ring proud of the slide front
    sx0, sx1 = L * 0.13, L - muzzle    # slide
    fx0, fx1 = L * 0.055, L * 0.935    # frame: tang behind the slide to the dust cover nose

    # --- slide: rounded box tapering at the nose; serrations and the ejection port cut in ----------------
    r_slide = min(0.006, slide_w * 0.2)
    slide = ops.loft_x("slide", [
        (sx0, 0, bore, slide_w, slide_h, r_slide),
        (sx1 - L * 0.055, 0, bore, slide_w, slide_h, r_slide),
        (sx1, 0, bore, slide_w * 0.9, slide_h * 0.93, r_slide),
    ], metal, corner_segments=4)
    px0, px1 = L * 0.53, L * 0.69
    y_in, y_out = slide_w * 0.12, slide_w / 2 + 0.004
    z_floor, z_over = bore + 0.003, slide_top + 0.005
    cutters = [ops.box("ejection_port_cutter", (px1 - px0, y_out - y_in, z_over - z_floor), ((px0 + px1) / 2, (y_in + y_out) / 2, (z_floor + z_over) / 2), metal)]
    ser_h = slide_h - 2 * r_slide - 0.003
    groove = (0.0016, 0.002, ser_h)
    for side, name in ((-1, "l"), (1, "r")):
        cutters.append(ops.ribs("rear_serration_cutter_" + name, sx0 + 0.005, sx0 + 0.029, side * slide_w / 2, bore, 6, groove, metal))
        cutters.append(ops.ribs("front_serration_cutter_" + name, L * 0.80, L * 0.905, side * slide_w / 2, bore, 5, groove, metal))
    ops.boolean_cut(slide, cutters)
    add(slide, "slide")
    add(ops.box("extractor", (0.010, 0.002, 0.005), (px1 + 0.008, slide_w / 2, bore + 0.003), steel), "slide")
    # sights: both tops at H
    fs_x = sx1 - L * 0.08
    add(ops.box("front_sight", (0.005, 0.0035, sight_h + 0.001), (fs_x, 0, H - (sight_h + 0.001) / 2), steel), "slide")
    rs_x = sx0 + 0.011
    base_h = 0.003
    add(ops.box("rear_sight_base", (0.008, slide_w * 0.6, base_h + 0.001), (rs_x, 0, slide_top - 0.001 + (base_h + 0.001) / 2), steel), "slide")
    blade_h = H - (slide_top + base_h)
    for side, name in ((-1, "rear_sight_blade_l"), (1, "rear_sight_blade_r")):
        add(ops.box(name, (0.006, 0.006, blade_h + 0.001), (rs_x, side * 0.0055, H - (blade_h + 0.001) / 2), steel), "slide")
    moving("slide", "slide", (sx0 + 0.02, 0, bore), (-1, 0, 0), "rack", travel=L * 0.18, length=0.04)

    # --- barrel and guide rod: fixed to the frame, exposed through the port and when the slide is back --
    r_b = slide_h * 0.215
    add(ops.revolve_x("barrel", [(L * 0.45, r_b), (L, r_b), (L, r_b * 0.68), (L - 0.004, r_b * 0.68)], 16, steel, z=bore))
    rod_x0, rod_x1 = L * 0.5, sx1 - 0.0005
    add(ops.cylinder("guide_rod", 0.003, rod_x1 - rod_x0, ((rod_x0 + rod_x1) / 2, 0, frame_top + 0.0025), "X", 14, steel))

    # --- frame: tang, rails and dust cover in one loft, rail below the dust cover, beavertail ----------
    fz = (frame_top + frame_bot) / 2
    add(ops.loft_x("frame", [
        (fx0, 0, fz, frame_w, frame_h, 0.004),
        (L * 0.47, 0, fz, frame_w, frame_h, 0.004),
        (L * 0.56, 0, fz, slide_w, frame_h, 0.004),
        (fx1 - 0.006, 0, fz, slide_w, frame_h, 0.004),
        (fx1, 0, fz + 0.002, slide_w * 0.92, frame_h - 0.004, 0.004),
    ], polymer, corner_segments=2))
    add(ops.rail("rail", L * 0.68, L * 0.88, 0, frame_bot + 0.001, slide_w * 0.6, 0.002, 0.003, 0.01, 0.0053, polymer, direction=-1))
    tail_len = sx0 + 0.006  # root buried in the tang and grip; the tip sets x = 0
    add(ops.loft_x("beavertail", [
        (0.0, 0, frame_bot + 0.010, frame_w * 0.45, 0.006, 0.0025),
        (tail_len * 0.35, 0, frame_bot + 0.008, frame_w * 0.6, 0.010, 0.003),
        (tail_len, 0, frame_bot + 0.006, frame_w * 0.8, 0.014, 0.004),
    ], polymer, corner_segments=2))

    # --- grip, stippling, magazine: about the grip axis leaning back 15 degrees ----------------------
    grip_d, grip_w = L * 0.21, frame_w
    mag_out, plate_t, plate_d = 0.008, 0.005, L * 0.21 + 0.002
    top = Vector((L * 0.235, 0.0, frame_bot + 0.012))  # where the grip axis meets the frame
    grip_len = (top.z - s * plate_d / 2) / c - mag_out - plate_t  # so the floorplate's front corner rests on z = 0
    frames = []  # straight front strap; the backstrap swells for the palm and flares at the heel
    for t, swell in ((0.0, 0.0), (0.4, 0.001), (0.8, 0.004), (1.0, 0.003)):
        frames.append((top + down * (grip_len * t) - fwd * (swell / 2), fwd, Vector((0.0, 1.0, 0.0)), grip_d + swell, grip_w, 0.008))
    add(ops.loft("grip", frames, polymer, corner_segments=4))
    rib_t0, rib_t1 = 0.018, grip_len - 0.008
    rib_c = top + down * ((rib_t0 + rib_t1) / 2)
    half = (rib_t1 - rib_t0) / 2
    for side, name in ((-1, "stipple_l"), (1, "stipple_r")):
        ribs = ops.ribs(name, rib_c.z - half, rib_c.z + half, rib_c.x, side * grip_w / 2, 6, (grip_d * 0.55, 0.003, 0.0025), polymer, axis="Z")
        add(_tilt(ribs, rib_c, GRIP_ANGLE))
    mag_len = grip_len + mag_out
    mag_c = top + down * (mag_len / 2)
    add(ops.box("magazine", (grip_d - 0.006, grip_w - 0.006, mag_len), mag_c, metal, rotation=(0.0, GRIP_ANGLE, 0.0)), "magazine")
    plate_c = top + down * (mag_len + plate_t / 2)
    add(ops.box("magazine_floorplate", (plate_d, grip_w, plate_t), plate_c, polymer, rotation=(0.0, GRIP_ANGLE, 0.0)), "magazine")
    moving("magazine", "slide", top, down, "release", travel=L * 0.41, length=0.04)

    # --- trigger guard loop with the trigger inside ---------------------------------------------------
    guard_w, guard_t = slide_w * 0.45, 0.005
    guard_bot = frame_bot - H * 0.2
    gz = guard_bot + guard_t / 2
    gx_front, radius = L * 0.585, 0.010
    path = [((L * 0.255, 0, gz), (1, 0, 0)), ((gx_front - radius, 0, gz), (1, 0, 0))]
    for i in range(1, 5):
        a = math.pi / 2 * i / 4
        path.append(((gx_front - radius + radius * math.sin(a), 0, gz + radius - radius * math.cos(a)), (math.cos(a), 0, math.sin(a))))
    path.append(((gx_front, 0, frame_bot + 0.003), (0, 0, 1)))
    add(_sweep("trigger_guard", path, guard_w, guard_t, polymer))
    tx, tz_pin = L * 0.465, frame_bot + 0.0068
    trig_h = 0.026
    add(ops.box("trigger", (0.005, 0.008, trig_h), (tx, 0, tz_pin + 0.002 - trig_h / 2), steel, rotation=(0.0, math.radians(-8), 0.0)), "trigger")
    moving("trigger", "rotate", (tx, 0, tz_pin), (0, 1, 0), "pull", angle=25.0, length=0.012)

    # --- hammer on the tang behind the slide ---------------------------------------------------------
    hx = sx0 - 0.007
    body_h = H * 0.17
    hz0 = frame_top - 0.002
    add(ops.box("hammer", (0.006, 0.006, body_h), (hx, 0, hz0 + body_h / 2), steel), "hammer")
    add(ops.box("hammer_spur", (0.013, 0.009, 0.006), (hx - 0.0035, 0, hz0 + body_h - 0.002), steel), "hammer")
    moving("hammer", "rotate", (hx, 0, frame_top), (0, 1, 0), "cock", angle=-35.0, length=0.012)

    # --- controls and pins: the magazine release reaches +W/2, the slide stop -W/2 ---------------------
    add(ops.box("magazine_release", (0.008, 0.004, 0.006), (L * 0.30, W / 2 - 0.002, frame_bot - 0.005), steel))
    ss_x0, ss_z = L * 0.375, frame_bot + frame_h * 0.5
    ss_y = -(W / 2 - 0.0015)
    add(ops.box("slide_stop", (0.014, 0.003, 0.004), (ss_x0 + 0.007, ss_y, ss_z), steel))
    add(ops.box("slide_stop_pad", (0.009, 0.003, 0.0065), (ss_x0 + 0.0045, ss_y, ss_z), steel))
    pin_z = frame_bot + 0.0068
    for side, name, pins in ((1, "pins_r", [(tx - 0.002, pin_z), (hx, frame_top - 0.0065), (ss_x0 + 0.005, ss_z + 0.0007)]), (-1, "pins_l", [(tx - 0.002, pin_z), (hx, frame_top - 0.0065)])):
        add(ops.fasteners(name, [(x, side * frame_w / 2, z) for x, z in pins], 0.0025, 0.0016, "Y", steel, 14))

    present = {b["bone"] for b in bones}
    actions = [dict(a) for a in ACTIONS if all(p in present for p in a["parts"])]
    return parts, dict(FINISHING), {"bones": bones, "actions": actions}
