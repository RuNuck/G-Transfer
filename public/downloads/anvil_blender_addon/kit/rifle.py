"""Rifle family: a modern carbine assembled from parametric parts.

Layout in metres, resting on z = 0, stock at x = 0, muzzle at x = length: stock, receiver
(upper with ejection port and bolt carrier, lower with magazine well and selector), handguard
with top and bottom rails and vent ribs, barrel with gas block and muzzle device. Grip,
trigger group, curved magazine, sights, charging handle and fasteners hang off the receiver.
The bounding box equals the requested dimensions exactly, which is what Anvil's QC promises.

Moving parts (charging handle, bolt carrier, trigger, magazine, selector, collapsible stock)
are tagged with a vertex group named after their bone and described in the rig spec the
family returns, so `kit.rig.apply()` can animate them: cock back, trigger pull, magazine
release, safe-to-fire, stock collapse.
"""
import math

from mathutils import Vector

from . import ops

KINDS = ("rifle", "shotgun")
FINISHING = {"bevel": (0.0012, 1), "smooth_angle": 32}

# demo clips: fraction of each part's travel or angle per frame (24 fps)
ACTIONS = [
    {"name": "cock_back", "parts": ["charging_handle", "bolt"], "keys": [(1, 0.0), (10, 1.0), (14, 1.0), (24, 0.0)]},
    {"name": "trigger_pull", "parts": ["trigger"], "keys": [(1, 0.0), (6, 1.0), (10, 1.0), (16, 0.0)]},
    {"name": "magazine_release", "parts": ["magazine"], "keys": [(1, 0.0), (14, 1.0)]},
    {"name": "selector_toggle", "parts": ["selector"], "keys": [(1, 0.0), (8, 1.0)]},
    {"name": "stock_collapse", "parts": ["stock"], "keys": [(1, 0.0), (12, 1.0)]},
]


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/secondary/trim to material slot indices.
    A rifle gets a collapsible stock unless the variant says otherwise; a shotgun a fixed one."""
    variant = dict(variant or {})
    variant.setdefault("stock", "fixed" if kind == "shotgun" else "collapsible")
    L, W, H = float(dim.x), float(dim.y), float(dim.z)
    metal = roles.get("primary", 0)           # receiver, rails, trigger guard
    polymer = roles.get("secondary", metal)   # furniture: stock, grip, handguard, magazine
    steel = roles.get("trim", metal)          # barrel, sights, fasteners, trigger, buttplate
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

    z_bore = H * 0.62            # bore axis; magazine bottom sits on z = 0, front sight reaches H
    receiver_h = H * 0.22
    receiver_w = W               # the receiver defines the full width

    # --- stock -----------------------------------------------------------------------------------------
    stock_len = L * 0.30
    collapsible = variant.get("stock") == "collapsible"
    stock_part = "stock" if collapsible else None
    if collapsible:
        add(ops.cylinder("stock_tube", W * 0.22, stock_len * 0.6, (stock_len * 0.7, 0, z_bore + H * 0.02), "X", 16, metal))
        add(ops.loft_x("stock", [
            (0.0, 0, z_bore - H * 0.16, W * 0.62, H * 0.42, 0.006),
            (stock_len * 0.22, 0, z_bore - H * 0.12, W * 0.66, H * 0.34, 0.006),
            (stock_len * 0.45, 0, z_bore - H * 0.04, W * 0.6, H * 0.22, 0.005),
        ], polymer), stock_part)
        moving("stock", "slide", (stock_len * 0.45, 0, z_bore - H * 0.04), (1, 0, 0), "collapse", travel=stock_len * 0.3, length=0.04)
    else:
        add(ops.loft_x("stock", [
            (0.0, 0, z_bore - H * 0.14, W * 0.7, H * 0.52, 0.008),
            (stock_len * 0.25, 0, z_bore - H * 0.10, W * 0.72, H * 0.44, 0.008),
            (stock_len * 0.62, 0, z_bore - H * 0.02, W * 0.7, H * 0.30, 0.006),
            (stock_len, 0, z_bore + H * 0.01, W * 0.8, H * 0.24, 0.005),
        ], polymer))
    add(ops.box("buttplate", (0.008, W * 0.72, H * 0.54), (0.004, 0, z_bore - H * 0.14), steel), stock_part)

    # --- receiver ---------------------------------------------------------------------------------------
    rx0, rx1 = stock_len, L * 0.56
    rlen = rx1 - rx0
    upper = add(ops.rounded_box("upper_receiver", (rlen, receiver_w, receiver_h), ((rx0 + rx1) / 2, 0, z_bore + H * 0.03), 0.006, metal))
    port = ops.box("ejection_port_cutter", (rlen * 0.24, receiver_w * 0.4, receiver_h * 0.42), (rx0 + rlen * 0.62, receiver_w * 0.5, z_bore + H * 0.05), metal)
    ops.boolean_cut(upper, port)
    # bolt carrier: seen through the port, slides back with the charging handle
    add(ops.box("bolt_carrier", (rlen * 0.6, receiver_w * 0.18, receiver_h * 0.36), (rx0 + rlen * 0.62, receiver_w * 0.2, z_bore + H * 0.05), steel), "bolt")
    moving("bolt", "slide", (rx0 + rlen * 0.62, receiver_w * 0.2, z_bore + H * 0.05), (-1, 0, 0), "bolt carrier", travel=L * 0.09, length=0.04)
    lx0, lx1 = rx0 + rlen * 0.08, rx0 + rlen * 0.86
    add(ops.rounded_box("lower_receiver", (lx1 - lx0, receiver_w * 0.88, H * 0.18), ((lx0 + lx1) / 2, 0, z_bore - H * 0.155), 0.005, metal))
    add(ops.box("magwell", (L * 0.085, receiver_w * 0.6, H * 0.12), (rx0 + rlen * 0.55, 0, z_bore - H * 0.27), metal))
    pin_y = receiver_w * 0.5 - 0.001  # flush with the receiver side so the width stays exact
    add(ops.fasteners("receiver_pins", [
        (rx0 + rlen * 0.2, pin_y, z_bore - H * 0.12),
        (rx0 + rlen * 0.78, pin_y, z_bore - H * 0.12),
        (rx0 + rlen * 0.3, pin_y, z_bore + H * 0.09),
        (rx0 + rlen * 0.5, pin_y, z_bore + H * 0.09),
    ], 0.0035, 0.002, "Y", steel))
    handle_x, handle_z = rx0 + L * 0.012, z_bore + H * 0.145
    add(ops.box("charging_handle", (L * 0.03, receiver_w * 0.7, H * 0.035), (handle_x, 0, handle_z), steel), "charging_handle")
    add(ops.box("charging_latch", (L * 0.012, receiver_w * 0.25, H * 0.03), (handle_x, receiver_w * 0.32, z_bore + H * 0.16), steel), "charging_handle")
    moving("charging_handle", "slide", (handle_x, 0, handle_z), (-1, 0, 0), "cock back", travel=L * 0.09, length=0.04)

    # --- grip, trigger group and selector -------------------------------------------------------------
    grip_x = rx0 + rlen * 0.22
    grip_loc = (grip_x - L * 0.02, 0.0, z_bore - H * 0.38)
    grip = add(ops.rounded_box("grip", (L * 0.045, receiver_w * 0.55, H * 0.40), grip_loc, 0.006, polymer, corner_segments=2))
    ops.rotate_about_center(grip, (0.0, math.radians(-18), 0.0))
    add(ops.ribs("grip_serrations", grip_x - L * 0.045, grip_x - L * 0.005, receiver_w * 0.29, z_bore - H * 0.42, 4, (0.003, 0.004, H * 0.18), polymer))
    tx0, tx1 = grip_x + L * 0.01, grip_x + L * 0.075
    tz = z_bore - H * 0.30
    add(ops.box("trigger_guard_bottom", (tx1 - tx0, receiver_w * 0.28, 0.004), ((tx0 + tx1) / 2, 0, tz - H * 0.14), metal))
    add(ops.box("trigger_guard_front", (0.004, receiver_w * 0.28, H * 0.14), (tx1, 0, tz - H * 0.07), metal))
    trigger_x = tx0 + (tx1 - tx0) * 0.45
    add(ops.box("trigger", (0.006, receiver_w * 0.14, H * 0.09), (trigger_x, 0, tz - H * 0.06), steel, rotation=(0.0, math.radians(12), 0.0)), "trigger")
    moving("trigger", "rotate", (trigger_x, 0, tz - H * 0.015), (0, 1, 0), "pull", angle=18.0, length=0.015)
    # selector lever on the left of the lower receiver, inside the receiver's width
    sel_x, sel_z = grip_x - L * 0.005, z_bore - H * 0.13
    side_y = -receiver_w * 0.44
    pin_h, lever_t = receiver_w * 0.02, receiver_w * 0.035
    add(ops.fasteners("selector_pin", [(sel_x, side_y - pin_h / 2, sel_z)], receiver_w * 0.06, pin_h, "Y", steel), "selector")
    add(ops.box("selector_lever", (L * 0.022, lever_t, receiver_w * 0.08), (sel_x - L * 0.011 + 0.002, side_y - pin_h - lever_t / 2, sel_z), steel), "selector")
    moving("selector", "rotate", (sel_x, side_y - pin_h, sel_z), (0, 1, 0), "safe to fire", angle=-90.0, length=0.012)

    # --- magazine: curved and tapered, bottom on the ground -------------------------------------------
    mag_x = rx0 + rlen * 0.55
    mag_top = z_bore - H * 0.33
    mag_len, mag_w = L * 0.075, receiver_w * 0.55
    frames = []
    steps = 5
    for i in range(steps + 1):
        t = i / steps
        z = mag_top * (1 - t)
        curve = (t ** 1.6) * L * 0.04
        frames.append((Vector((mag_x + curve, 0, z)), Vector((1, 0, 0)), Vector((0, 1, 0)), mag_len * (1 + 0.15 * t), mag_w, 0.004))
    add(ops.loft("magazine", frames, polymer, corner_segments=2), "magazine")
    add(ops.box("magazine_floorplate", (mag_len * 1.25, mag_w * 1.08, 0.006), (mag_x + L * 0.04, 0, 0.003), polymer), "magazine")
    add(ops.ribs("magazine_ribs", mag_x - mag_len * 0.3, mag_x + mag_len * 0.3, mag_w * 0.5, mag_top * 0.5, 3, (0.003, 0.003, mag_top * 0.7), polymer), "magazine")
    moving("magazine", "slide", (mag_x, 0, mag_top), (0, 0, -1), "release", travel=mag_top, length=0.04)

    # --- handguard with rails and vent ribs -------------------------------------------------------------
    hx0, hx1 = rx1, L * 0.80
    hz = z_bore + H * 0.02
    add(ops.loft_x("handguard", [
        (hx0, 0, hz, receiver_w * 0.82, H * 0.24, 0.007),
        (hx0 + (hx1 - hx0) * 0.5, 0, hz, receiver_w * 0.78, H * 0.22, 0.007),
        (hx1, 0, hz, receiver_w * 0.72, H * 0.20, 0.006),
    ], polymer))
    rail_top = z_bore + H * 0.03 + receiver_h / 2
    add(ops.rail("top_rail", rx0 + rlen * 0.2, hx1 - L * 0.01, 0, rail_top, receiver_w * 0.3, 0.003, 0.003, 0.01, 0.0053, metal, direction=1))
    add(ops.rail("bottom_rail", hx0 + (hx1 - hx0) * 0.1, hx0 + (hx1 - hx0) * 0.65, 0, hz - H * 0.11, receiver_w * 0.28, 0.003, 0.003, 0.01, 0.0053, metal, direction=-1))
    for side in (-1, 1):
        add(ops.ribs("handguard_vents", hx0 + (hx1 - hx0) * 0.1, hx1 - (hx1 - hx0) * 0.1, side * receiver_w * 0.4, hz, 8, (0.006, 0.004, H * 0.12), polymer))

    # --- barrel, gas block, muzzle device ---------------------------------------------------------------
    bx0 = hx1 - L * 0.01
    r_bore = max(receiver_w * 0.14, 0.006)
    add(ops.revolve_x("barrel", [
        (bx0, r_bore * 1.4), (bx0 + L * 0.02, r_bore * 1.4), (bx0 + L * 0.02, r_bore),
        (L * 0.905, r_bore), (L * 0.905, r_bore * 1.25), (L * 0.925, r_bore * 1.25), (L * 0.925, r_bore * 0.95),
        (L * 0.965, r_bore * 0.95), (L * 0.965, r_bore * 1.3), (L * 0.985, r_bore * 1.3), (L, r_bore * 1.15),
    ], 16, steel, z=z_bore))
    add(ops.ribs("muzzle_flutes", L * 0.968, L * 0.983, 0, z_bore + r_bore * 1.3, 3, (0.003, r_bore * 0.6, 0.003), steel))
    add(ops.box("gas_block", (L * 0.02, receiver_w * 0.3, H * 0.06), (L * 0.915, 0, z_bore + H * 0.035), steel))

    # --- sights: the front post sets the top of the bounding box ----------------------------------------
    fs_x = L * 0.915
    post_base = z_bore + H * 0.11
    add(ops.box("front_sight_base", (L * 0.03, receiver_w * 0.34, H * 0.05), (fs_x, 0, z_bore + H * 0.085), steel))
    add(ops.box("front_sight_post", (0.004, 0.004, H - post_base), (fs_x, 0, (H + post_base) / 2), steel))
    for side in (-1, 1):
        add(ops.box("front_sight_ear", (L * 0.012, 0.004, H - post_base - 0.008), (fs_x, side * receiver_w * 0.13, (H - 0.008 + post_base) / 2), steel))
    rs_x = rx0 + rlen * 0.55
    add(ops.box("rear_sight_base", (L * 0.03, receiver_w * 0.4, H * 0.03), (rs_x, 0, rail_top + 0.006 + H * 0.015), steel))
    for side in (-1, 1):
        add(ops.box("rear_sight_wing", (L * 0.012, 0.004, H * 0.06), (rs_x, side * receiver_w * 0.15, rail_top + 0.006 + H * 0.06), steel))
    add(ops.box("rear_sight_aperture", (0.004, receiver_w * 0.3, 0.004), (rs_x, 0, rail_top + 0.006 + H * 0.085), steel))

    present = {b["bone"] for b in bones}
    actions = [a for a in ACTIONS if all(p in present for p in a["parts"])]
    # Intentional FPS hand socket in build-space: palm on pistol-grip body, aft of trigger /
    # beside mag well. Mesh "grip" is joined away; build script emits Empty from
    # finishing["sockets"]. Must sit in lower-rear of centered AABB — NOT near origin
    # (inject scaffold was ~[0,-0.02,0.01] / AABB frac ~0.50,0.41,0.64 = mid-receiver).
    finishing = dict(FINISHING)
    grip_hand = (
        float(grip_x - L * 0.01),           # grip column, slight bias toward trigger
        0.0,
        float(z_bore - H * 0.36),           # palm mid-grip (below receiver, above mag floor)
    )
    finishing["sockets"] = [
        {"name": "grip", "location": [grip_hand[0], grip_hand[1], grip_hand[2]]},
    ]
    return parts, finishing, {"bones": bones, "actions": actions}
