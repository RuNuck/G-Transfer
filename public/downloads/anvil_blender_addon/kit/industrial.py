"""Industrial family: hard-surface fittings built from parametric parts.

pipe: a flanged steel T-junction. The main run lies along X between two flanges whose
diameter is the slimmer cross dimension; the branch leaves the middle of the run and ends in
a third flange at the far extent of the other cross dimension. When the height is the larger
dimension (the usual spec) the branch drops to the floor and the piece stands on the branch
flange, with two pipe stands under the elevated run; when the depth is larger the run rests on
its flanges and the branch runs out along -Y. Every flange carries eight square-head bolts on
its inner face (the outer faces define the bounding box), a cast tee body sits at the
junction. Steel (primary) for the run, branch and stands; rust (trim) for flanges, bolts and
the tee body. No moving parts.

vent: a 1 x 1 louvred ceiling vent module lying flat, louvres up. An outer frame of four
boxes, a recessed back plate closing the module with a lamp panel (emissive) on it that shows
through the louvres, and the grille: an inner rim, eight slats tilted 30 degrees about their
long axis and a centre cross bar. Four hex screw heads on the frame corners set the top of
the bounding box. The grille is one moving part, "grille", sliding down (-Z) by 0.1 m as a
maintenance drop (clip "drop"). `variant={"face": "down"}` flips the module so the louvres
face the floor, which is the installed orientation of a ceiling vent: the drop then takes the
grille out of the housing instead of through the back plate.
"""
import math

from mathutils import Matrix, Vector

from . import ops

KINDS = ("pipe", "vent")
FINISHING = {
    "pipe": {"bevel": (0.005, 1), "smooth_angle": 35},
    "vent": {"bevel": (0.003, 1), "smooth_angle": 35},
}
# demo clip: fraction of the grille's travel per frame (24 fps): drop, hold, lift back
VENT_ACTIONS = [{"name": "drop", "parts": ["grille"], "keys": [(1, 0.0), (12, 1.0), (20, 1.0), (32, 0.0)]}]

RUN_SEGMENTS = 24      # big cylinders: 15 degree facets stay smooth and unbevelled
SPHERE_SEGMENTS = 16   # 22.5 degree facets, below the 30 degree bevel limit
BOLT_SEGMENTS = 4      # square heads: the cheapest fastener after the bevel (44 tris each)
SCREW_SEGMENTS = 6


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/trim/emissive to material slot indices."""
    variant = dict(variant or {})
    if kind == "vent":
        parts, rig = _vent(dim, roles, variant)
    else:
        parts, rig = _pipe(dim, roles, variant)
    return parts, dict(FINISHING[kind]), rig


# --- private helpers -----------------------------------------------------------------------------

def _circle(center, axis, radius, count, phase=0.0):
    """`count` points on a circle around `axis` through `center`."""
    u, v = ops.PLANE[axis]
    center = Vector(center)
    return [center + (u * math.cos(a) + v * math.sin(a)) * radius for a in (phase + 2 * math.pi * i / count for i in range(count))]


def _tube(name, radius, start, end, axis, segments, slot):
    """Open-ended pipe between two centres. Both ends are buried in flanges or the tee body, so
    caps (and the rim bevels they would get) would only cost triangles."""
    return ops.loft_points(name, [_circle(start, axis, radius, segments), _circle(end, axis, radius, segments)], slot, cap=False)


def _flip_z(ob, height):
    """Mirror a part's geometry about z = height / 2 (turn a module face down)."""
    me = ob.data
    me.transform(Matrix.Translation(Vector((0.0, 0.0, height))) @ Matrix.Scale(-1.0, 4, Vector((0.0, 0.0, 1.0))))
    me.flip_normals()
    me.update()
    return ob


# --- pipe: flanged T-junction --------------------------------------------------------------------

def _pipe(dim, roles, variant):
    L, W, H = float(dim.x), float(dim.y), float(dim.z)
    steel = roles.get("primary", 0)
    rust = roles.get("trim", steel)
    parts = []

    vertical = H >= W                          # branch drops to the floor, or runs out along -Y
    flange_r = (W if vertical else H) / 2      # the flange diameter is the slimmer cross dimension
    t_f = flange_r * 0.12                      # flange thickness (30 mm on a 0.5 m flange)
    pipe_r = flange_r * 0.72                   # 0.18 m on a 0.5 m flange
    z_axis = (H - flange_r) if vertical else flange_r
    b_axis = "Z" if vertical else "Y"
    b_dir = Vector((0.0, 0.0, -1.0)) if vertical else Vector((0.0, -1.0, 0.0))
    b_len = (H - flange_r) if vertical else (W - flange_r)   # run axis to the branch flange's outer face
    xc = L / 2
    embed = 0.005                              # tube ends reach this far into the flanges

    def on_run(x):
        return Vector((x, 0.0, z_axis))

    def on_branch(t):
        return on_run(xc) + b_dir * t

    # --- run, branch and the cast tee body --------------------------------------------------------
    parts.append(_tube("run", pipe_r, on_run(t_f - embed), on_run(L - t_f + embed), "X", RUN_SEGMENTS, steel))
    parts.append(_tube("branch", pipe_r, on_branch(0.0), on_branch(b_len - t_f + embed), b_axis, RUN_SEGMENTS, steel))
    parts.append(ops.sphere("tee_body", flange_r * 0.8, on_run(xc), SPHERE_SEGMENTS, 8, rust))

    # --- flanges: the outer faces define the bounding box ---------------------------------------
    parts.append(ops.cylinder("flange_left", flange_r, t_f, on_run(t_f / 2), "X", RUN_SEGMENTS, rust))
    parts.append(ops.cylinder("flange_right", flange_r, t_f, on_run(L - t_f / 2), "X", RUN_SEGMENTS, rust))
    parts.append(ops.cylinder("flange_branch", flange_r, t_f, on_branch(b_len - t_f / 2), b_axis, RUN_SEGMENTS, rust))

    # --- bolt rings on the inner faces, eight square heads per flange ---------------------------
    ring_r = (pipe_r + flange_r) / 2
    r_bolt = flange_r * 0.05
    h_bolt = r_bolt
    phase = math.pi / 8
    # the left ring is built around x = 0, mirrored for the right flange (so both tapers point
    # outward) and moved into place as one part
    left = _circle(Vector((t_f + h_bolt / 2 - xc, 0.0, z_axis)), "X", ring_r, 8, phase)
    run_bolts = ops.fasteners("bolts_run", left, r_bolt, h_bolt, "X", rust, segments=BOLT_SEGMENTS)
    ops.mirror(run_bolts, "X")
    ops.translate(run_bolts, (xc, 0.0, 0.0))
    parts.append(run_bolts)
    branch_ring = _circle(on_branch(b_len - t_f - h_bolt / 2), b_axis, ring_r, 8, phase)
    parts.append(ops.fasteners("bolts_branch", branch_ring, r_bolt, h_bolt, b_axis, rust, segments=BOLT_SEGMENTS))

    # --- two pipe stands under the run: base plate, post and saddle ------------------------------
    underside = z_axis - pipe_r
    for tag, x in (("a", L * 0.17), ("b", L * 0.83)):
        parts.append(ops.box("stand_base_" + tag, (pipe_r * 0.9, pipe_r * 1.1, 0.012), (x, 0.0, 0.006), steel))
        post_h = underside + pipe_r * 0.1
        parts.append(ops.box("stand_post_" + tag, (pipe_r * 0.33, pipe_r * 0.55, post_h), (x, 0.0, post_h / 2), steel))
        saddle_h = pipe_r * 0.28
        parts.append(ops.box("stand_saddle_" + tag, (pipe_r * 0.55, pipe_r * 0.9, saddle_h), (x, 0.0, underside - saddle_h / 2 + pipe_r * 0.08), steel))

    return parts, {"bones": [], "actions": []}


# --- vent: louvred ceiling module ----------------------------------------------------------------

def _vent(dim, roles, variant):
    SX, SY, T = float(dim.x), float(dim.y), float(dim.z)
    hull = roles.get("primary", 0)
    trim = roles.get("trim", hull)
    lamp = roles.get("emissive", trim)
    parts = []

    def add(ob, part=None):
        if part:
            ops.tag_part(ob, part)
        parts.append(ob)
        return ob

    fw = 0.06                       # frame width
    h_screw = 0.003
    fh = T - h_screw                # the screw heads on the frame corners reach the full thickness
    ox, oy = SX / 2 - fw, SY / 2 - fw   # half sizes of the opening

    # --- outer frame ----------------------------------------------------------------------------
    add(ops.box("frame_front", (SX, fw, fh), (0.0, -SY / 2 + fw / 2, fh / 2), hull))
    add(ops.box("frame_back", (SX, fw, fh), (0.0, SY / 2 - fw / 2, fh / 2), hull))
    add(ops.box("frame_left", (fw, SY - 2 * fw, fh), (-SX / 2 + fw / 2, 0.0, fh / 2), hull))
    add(ops.box("frame_right", (fw, SY - 2 * fw, fh), (SX / 2 - fw / 2, 0.0, fh / 2), hull))
    corners = [(sx * (SX / 2 - fw / 2), sy * (SY / 2 - fw / 2), fh + h_screw / 2) for sx in (-1, 1) for sy in (-1, 1)]
    add(ops.fasteners("corner_screws", corners, 0.008, h_screw, "Z", trim, segments=SCREW_SEGMENTS))

    # --- back plate, slightly recessed, with the lamp panel on it -------------------------------
    plate_t = 0.006
    recess = 0.005
    add(ops.box("back_plate", (2 * ox + 0.02, 2 * oy + 0.02, plate_t), (0.0, 0.0, recess + plate_t / 2), hull))
    lamp_t = 0.004
    add(ops.box("lamp_panel", (2 * ox - 0.02, 2 * oy - 0.02, lamp_t), (0.0, 0.0, recess + plate_t + lamp_t / 2), lamp))

    # --- grille: inner rim, louvre slats and the centre cross bar (one moving part) --------------
    rw, rh = 0.025, 0.016
    z_top = fh - 0.003              # grille top, just below the frame top
    gap = 0.001                     # clearance between the rim and the frame
    rx, ry = ox - gap, oy - gap     # rim outer half sizes
    ix, iy = rx - rw, ry - rw       # rim inner half sizes
    z_rim = z_top - rh / 2
    add(ops.box("rim_front", (2 * rx, rw, rh), (0.0, -(ry - rw / 2), z_rim), trim), "grille")
    add(ops.box("rim_back", (2 * rx, rw, rh), (0.0, ry - rw / 2, z_rim), trim), "grille")
    add(ops.box("rim_left", (rw, 2 * iy, rh), (-(rx - rw / 2), 0.0, z_rim), trim), "grille")
    add(ops.box("rim_right", (rw, 2 * iy, rh), (rx - rw / 2, 0.0, z_rim), trim), "grille")
    slat_h, slat_t, tilt = 0.036, 0.003, math.radians(30)
    v_extent = slat_h * math.cos(tilt) + slat_t * math.sin(tilt)
    count = 8
    for i in range(count):
        y = -iy + 2 * iy * (i + 0.5) / count
        add(ops.box("slat_%d" % (i + 1), (2 * ix + 0.02, slat_t, slat_h), (0.0, y, z_top - v_extent / 2), trim, rotation=(tilt, 0.0, 0.0)), "grille")
    bar_h = 0.014
    add(ops.box("cross_bar", (0.02, 2 * iy + 0.02, bar_h), (0.0, 0.0, z_top - bar_h / 2), trim), "grille")

    pivot = Vector((0.0, 0.0, z_rim))
    if variant.get("face") == "down":
        for ob in parts:
            _flip_z(ob, T)
        pivot.z = T - pivot.z
    bones = [{"bone": "grille", "group": "grille", "motion": "slide", "pivot": [pivot.x, pivot.y, pivot.z],
              "axis": [0.0, 0.0, -1.0], "travel": 0.1, "label": "drop", "length": 0.03}]
    return parts, {"bones": bones, "actions": list(VENT_ACTIONS)}
