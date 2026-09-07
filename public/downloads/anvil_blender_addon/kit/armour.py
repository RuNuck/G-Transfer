"""Armour family: a kite shield and a closed great helm built from parametric parts.

shield: a stylized kite shield standing on its point, face toward -Y. A 23 point kite outline
(rounded top, sides tapering to a blunt point at z = 0) is lofted into a 25 mm plate bowed
6 mm forward around the centre line; a steel rim tube runs along the outline with its outer
vertices exactly on it, so the rim and not the plate defines the silhouette. A flanged boss
revolved along Y sets the front of the bounding box, a horizontal band crosses the face,
rivets follow the rim, and on the back two arched forearm straps and a wooden grip bar (whose
back face is the back of the box) complete the 80 mm depth. Nothing moves.

helmet: a stylized closed great helm, face toward -Y. Skull and bevor are revolves around Z
and the bevor's flare sets the width; a face recess is cut out of the skull so the visor reads
as its own plate and its openings look into shadow. The visor is a hexagonal section lofted
along a 150 degree arc, with a vision slit and six breathing holes cut through it and a
vertical reinforce that splits the slit into two eyes. A brow ring, two bands over the crown,
a leather jaw band and chin strap, a plume socket that sets the top of the box and rivets
finish it. Everything is built on a circle of radius dim.x / 2 and squashed in Y at the end,
so the box is exactly dim. The visor is tagged and hinges up about a pin through the temples:
clip "raise_visor".

Note for maintainers: `ops.fasteners` makes one mesh of separate cones, and Blender's exact
boolean returns an *empty* result when such a mesh is used as a cutter with four or more
cones (reproducible against a plain box). Cut holes with one object per hole instead - see
`_radial_cylinder`, which also meets a curved plate square on rather than at an angle.
"""
import math

from mathutils import Matrix, Vector

from . import ops

KINDS = ("shield", "helmet")
FINISHING = {
    "shield": {"bevel": (0.002, 1), "smooth_angle": 35},
    "helmet": {"bevel": (0.0015, 1), "smooth_angle": 38},
}
# demo clips: fraction of each part's angle per frame (24 fps)
ACTIONS = {
    "shield": [],
    "helmet": [{"name": "raise_visor", "parts": ["visor"], "keys": [(1, 0.0), (14, 1.0), (22, 1.0)]}],
}
_FALLBACK = {"trim": "primary", "secondary": "trim", "emissive": "trim", "glass": "secondary"}


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/secondary/trim to material slot
    indices; `variant` is accepted for later options and unused."""
    W, D, H = float(dim.x), float(dim.y), float(dim.z)
    parts, bones = (_shield if kind == "shield" else _helmet)(W, D, H, roles)
    present = {b["bone"] for b in bones}
    actions = [a for a in ACTIONS[kind] if all(p in present for p in a["parts"])]
    return parts, dict(FINISHING[kind]), {"bones": bones, "actions": actions}


# --- shared helpers ---------------------------------------------------------------------------------

def _has_role(roles, role):
    """True when the spec carries its own material for `role`. roles_from_materials() fills a
    missing role with its fallback's index, so a role equal to its fallback was not in the spec."""
    fallback = _FALLBACK.get(role)
    return fallback is not None and roles.get(role) != roles.get(fallback)


def _slot(roles, role, default):
    return roles[role] if _has_role(roles, role) else default


def _outline_normals(points):
    """Outward unit normals of a closed counter-clockwise outline in a plane, averaged over the
    two edges meeting at each point. Returned as (nu, nv) pairs."""
    normals = []
    n = len(points)
    for i in range(n):
        acc = Vector((0.0, 0.0))
        for a, b in ((i - 1, i), (i, (i + 1) % n)):
            edge = Vector((points[b][0] - points[a][0], points[b][1] - points[a][1]))
            if edge.length > 1e-12:
                acc += Vector((edge.y, -edge.x)).normalized()   # outward: the direction turned -90
        acc = acc.normalized() if acc.length > 1e-9 else Vector((1.0, 0.0))
        normals.append((acc.x, acc.y))
    return normals


def _profile_radius(profile, z):
    """Radius of a (z, radius) profile at height z, linearly interpolated and clamped."""
    if z <= profile[0][0]:
        return profile[0][1]
    for (z0, r0), (z1, r1) in zip(profile, profile[1:]):
        if z <= z1:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return profile[-1][1]


def _profile_normals(profile):
    """Outward unit normals (radial, axial) at every point of a (z, radius) profile."""
    normals = []
    for i in range(len(profile)):
        acc = Vector((0.0, 0.0))
        for a, b in ((i - 1, i), (i, i + 1)):
            if a < 0 or b >= len(profile):
                continue
            dz, dr = profile[b][0] - profile[a][0], profile[b][1] - profile[a][1]
            edge = Vector((dz, -dr))
            if edge.length > 1e-12:
                acc += edge.normalized()
        normals.append(acc.normalized() if acc.length > 1e-9 else Vector((1.0, 0.0)))
    return normals


def _arc_plate(name, rings, phi0, phi1, steps, slot, cap=True):
    """Curved plate around Z: every (z, r_inner, r_outer) becomes a closed loop that runs along
    the outer arc from phi0 to phi1 and back along the inner one."""
    loops = []
    for z, r_in, r_out in rings:
        outer, inner = [], []
        for i in range(steps):
            a = phi0 + (phi1 - phi0) * i / (steps - 1)
            c, s = math.cos(a), math.sin(a)
            outer.append(Vector((r_out * c, r_out * s, z)))
            inner.append(Vector((r_in * c, r_in * s, z)))
        loops.append(outer + list(reversed(inner)))
    return ops.loft_points(name, loops, slot, cap)


# --- shield -----------------------------------------------------------------------------------------

ARC_POINTS = 9          # points across the rounded top, shoulder to shoulder
SIDE_POINTS = 7         # points down each tapering side, ending on the tip
SIDE_POWER = 0.88       # < 1 bows the sides slightly outward
FACE_THICKNESS = 0.025
FACE_BOW = 0.006        # how far the centre line of the face stands in front of the edges
RIM_RADIUS = 0.014      # half the rim tube across the face plane; its outer row is the outline
RIM_DEPTH = 0.019       # half the rim tube through the face, so it stands ~4 mm proud
PLATE_INSET = 0.020     # how far the plate's edge is tucked in behind the rim


def _kite_points(hw, height, shoulder, tip_w):
    """The kite outline as (x, z), counter-clockwise from the right shoulder: an elliptical top,
    then both sides tapering to a blunt point on z = 0. Spans exactly 2 * hw and `height`."""
    top_h = height - shoulder
    points = []
    for i in range(ARC_POINTS):
        a = math.pi * i / (ARC_POINTS - 1)
        points.append((hw * math.cos(a), shoulder + top_h * math.sin(a)))
    side = []
    for i in range(1, SIDE_POINTS + 1):
        s = i / SIDE_POINTS
        side.append((tip_w + (hw - tip_w) * (1.0 - s) ** SIDE_POWER, shoulder * (1.0 - s)))
    points += [(-x, z) for x, z in side]            # left shoulder down to the tip
    points += [(x, z) for x, z in reversed(side)]   # tip back up to the right shoulder
    return points


def _shield(W, D, H, roles):
    wood = roles.get("primary", 0)                  # planked face, straps and grip
    steel = roles.get("trim", wood)                 # rim, boss, band and rivets
    leather = _slot(roles, "secondary", wood)       # the usual spec has no leather: use the face
    hw, depth = W / 2, D / 2
    shoulder = H * 0.75                             # the widest line, below the rounded top
    tip_w = 0.02
    outline = _kite_points(hw, H, shoulder, tip_w)
    normals = _outline_normals(outline)
    parts = []

    def bow(x):
        """The face is curved around its vertical centre line: the middle stands proud."""
        return FACE_BOW * (1.0 - (x / hw) ** 2)

    def half_width(z):
        """Half the outline's width at height z, on the tapering part of the sides."""
        t = max(0.0, min(1.0, z / shoulder))
        return tip_w + (hw - tip_w) * t ** SIDE_POWER

    # --- face plate: the outline inset behind the rim, extruded along Y and bowed forward -------
    plate = [(x - nx * PLATE_INSET, z - nz * PLATE_INSET) for (x, z), (nx, nz) in zip(outline, normals)]
    parts.append(ops.loft_points("shield_face", [
        [Vector((x, -FACE_THICKNESS / 2 - bow(x), z)) for x, z in plate],
        [Vector((x, FACE_THICKNESS / 2 - bow(x), z)) for x, z in plate],
    ], wood))

    # --- rim: a hexagonal tube whose outermost row of vertices is the outline itself -------------
    section = ops.ellipse(2 * RIM_RADIUS, 2 * RIM_DEPTH, 6)
    rim_rings = []
    for (x, z), (nx, nz) in zip(outline, normals):
        cx, cz = x - nx * RIM_RADIUS, z - nz * RIM_RADIUS
        cy = -bow(cx)
        rim_rings.append([Vector((cx + nx * u, cy + v, cz + nz * u)) for u, v in section])
    rim_rings.append(list(rim_rings[0]))            # close the loop instead of capping it
    parts.append(ops.loft_points("shield_rim", rim_rings, steel, cap=False))

    rivet_front = RIM_DEPTH * math.sin(math.pi / 3)  # the hexagon's frontmost row
    rivets = []
    for i in range(0, len(outline), 2):
        (x, z), (nx, nz) = outline[i], normals[i]
        cx, cz = x - nx * RIM_RADIUS, z - nz * RIM_RADIUS
        rivets.append((cx, -bow(cx) - rivet_front - 0.0005, cz))
    parts.append(ops.fasteners("shield_rim_rivets", rivets, 0.009, 0.005, "Y", steel, segments=6))

    # --- boss: a flanged dome revolved along Y whose nose is the front of the bounding box -------
    # the skirt starts inside the plate and stands ~7 mm proud of it before the dome takes over
    boss_z = H * 0.72
    r_boss = 0.082
    parts.append(ops.revolve("shield_boss", [
        (-0.014, r_boss * 1.16), (-0.025, r_boss * 1.16), (-0.027, r_boss * 1.06),
        (-0.030, r_boss), (-0.034, r_boss * 0.80), (-0.037, r_boss * 0.57),
        (-0.0392, r_boss * 0.31), (-depth, r_boss * 0.12),
    ], "Y", 14, steel, center=(0.0, 0.0, boss_z)))

    # --- horizontal reinforcing band across the lower face --------------------------------------
    band_z, band_h = H * 0.46, 0.05
    band_hx = half_width(band_z) - 0.032
    band_rings = []
    for i in range(7):
        x = -band_hx + 2 * band_hx * i / 6
        front = -FACE_THICKNESS / 2 - bow(x) - 0.005
        back = -FACE_THICKNESS / 2 - bow(x) + 0.006
        band_rings.append([
            Vector((x, front, band_z - band_h / 2)), Vector((x, front, band_z + band_h / 2)),
            Vector((x, back, band_z + band_h / 2)), Vector((x, back, band_z - band_h / 2)),
        ])
    parts.append(ops.loft_points("shield_band", band_rings, steel))

    # --- back: two arched forearm straps and a grip bar on standoffs ------------------------------
    strap_t, strap_w, strap_hl = 0.010, 0.050, 0.160
    strap_back = depth - 0.004
    strap_anchor = 0.15     # the fraction of each end that lies flat on the plate

    def strap_y(x, t):
        """The near face of an arched strap: a flat riveted pad at each end, then a bridge that
        stands off the plate far enough for a forearm."""
        near = FACE_THICKNESS / 2 - bow(x)
        span = 1.0 - 2 * strap_anchor
        arch = 0.0 if not strap_anchor < t < 1.0 - strap_anchor else math.sin(math.pi * (t - strap_anchor) / span)
        return near + (strap_back - strap_t - near) * arch

    def strap(name, z, steps=8):
        rings = []
        for i in range(steps):
            t = i / (steps - 1)
            x = -strap_hl + 2 * strap_hl * t
            y = strap_y(x, t)
            rings.append([
                Vector((x, y, z - strap_w / 2)), Vector((x, y, z + strap_w / 2)),
                Vector((x, y + strap_t, z + strap_w / 2)), Vector((x, y + strap_t, z - strap_w / 2)),
            ])
        return ops.loft_points(name, rings, leather)

    strap_z = (H * 0.80, H * 0.68)
    for z, name in zip(strap_z, ("upper", "lower")):
        parts.append(strap("shield_strap_" + name, z))
    studs = []
    for z in strap_z:
        for t in (0.06, 0.94):
            x = -strap_hl + 2 * strap_hl * t
            studs.append((x, strap_y(x, t) + strap_t + 0.0015, z))
    parts.append(ops.fasteners("shield_strap_studs", studs, 0.008, 0.004, "Y", steel, segments=6))

    grip_z, grip_hl = H * 0.55, 0.100
    parts.append(ops.rounded_box("shield_grip", (2 * grip_hl, 0.016, 0.034), (0.0, depth - 0.008, grip_z), 0.006, wood, corner_segments=2, axis="X"))
    for side, name in ((-1, "left"), (1, "right")):
        x = side * (grip_hl - 0.016)
        near = FACE_THICKNESS / 2 - bow(x)
        parts.append(ops.box("shield_grip_block_" + name, (0.026, depth - 0.016 - near, 0.050), (x, (near + depth - 0.016) / 2, grip_z), wood))
    return parts, []


# --- helmet -----------------------------------------------------------------------------------------

# profiles as (z, radius) fractions of the height and of dim.x / 2, so the helm scales with the spec
BEVOR = ((0.000, 1.000), (0.038, 0.996), (0.063, 0.960), (0.109, 0.918), (0.194, 0.882), (0.275, 0.861))
SKULL = ((0.219, 0.850), (0.313, 0.900), (0.391, 0.914), (0.500, 0.907), (0.641, 0.893),
         (0.775, 0.886), (0.844, 0.879), (0.888, 0.836), (0.916, 0.686), (0.933, 0.436))
VISOR_ARC = math.radians(150.0)
VISOR_STEPS = 11        # 15 degrees apart, matching the skull's 24 segments
VISOR_Z = (0.453, 0.619, 0.781)     # the three heights the visor plate is lofted through
# the visor plus its reinforce must stay inside the bevor's flare, which sets the box
VISOR_GAP, VISOR_THICK, RIB_PROUD = 0.001, 0.008, 0.003
HINGE_Z = 0.744         # the temple pin, as a fraction of the height
VISOR_ANGLE = -60.0     # right-hand rule about +X: the visor lifts
FRONT = -math.pi / 2    # the helm faces -Y


def _radial_cylinder(name, azimuth, z, r_surface, radius, half_len, slot, segments=10):
    """A cylinder lying along the outward radial direction at (azimuth, z): a breathing hole
    drilled square through a curved plate, which the exact solver handles far better than a
    cutter that meets the surface at an angle."""
    out = Vector((math.cos(azimuth), math.sin(azimuth), 0.0))
    up = Vector((0.0, 0.0, 1.0))
    side = out.cross(up)
    center = out * r_surface + up * z
    rings = []
    for end in (-half_len, half_len):
        base = center + out * end
        rings.append([base + (up * math.cos(t) + side * math.sin(t)) * radius
                      for t in (2 * math.pi * i / segments for i in range(segments))])
    return ops.loft_points(name, rings, slot)


def _helmet(W, D, H, roles):
    plate = roles.get("primary", 0)                 # skull, bevor, visor, bands, socket
    leather = _slot(roles, "secondary", plate)      # jaw band and chin strap
    trim = _slot(roles, "trim", plate)              # the usual spec has no trim: use the plate
    R = W / 2                                       # the bevor's flare sets the width
    bevor = [(z * H, r * R) for z, r in BEVOR]
    skull = [(z * H, r * R) for z, r in SKULL]
    z_crown = skull[-1][0]
    phi0, phi1 = FRONT - VISOR_ARC / 2, FRONT + VISOR_ARC / 2
    parts, bones = [], []

    def add(ob, part=None):
        if part:
            ops.tag_part(ob, part)
        parts.append(ob)
        return ob

    def skull_r(z):
        return _profile_radius(skull, z)

    # --- skull with a face recess behind the visor, and the flared bevor ------------------------
    shell = ops.revolve("helm_skull", skull, "Z", 24, plate)
    ops.boolean_cut(shell, ops.box("helm_face_cutter", (R * 1.21, R * 0.64, H * 0.29), (0.0, -R * 0.92, H * 0.62), plate))
    add(shell)
    add(ops.revolve("helm_bevor", bevor, "Z", 20, plate))

    # --- visor: a hexagonal section lofted along the front arc, slit and pierced, then tagged ----
    zs = [H * f for f in VISOR_Z]
    inner = [skull_r(z) + VISOR_GAP for z in zs]
    outer = [r + VISOR_THICK for r in inner]
    rings = []
    for i in range(VISOR_STEPS):
        a = phi0 + (phi1 - phi0) * i / (VISOR_STEPS - 1)
        c, s = math.cos(a), math.sin(a)
        section = ((inner[0], zs[0]), (outer[0], zs[0]), (outer[1], zs[1]),
                   (outer[2], zs[2]), (inner[2], zs[2]), (inner[1], zs[1]))
        rings.append([Vector((r * c, r * s, z)) for r, z in section])
    visor = ops.loft_points("helm_visor", rings, plate)
    ops.boolean_cut(visor, ops.box("helm_visor_slit_cutter", (R * 1.5, R * 1.4, H * 0.047), (0.0, -R * 0.78, H * 0.653), plate))
    breath = []
    for column, azimuth in enumerate((FRONT - math.radians(18.0), FRONT + math.radians(18.0))):
        for row, z in enumerate((H * 0.494, H * 0.538, H * 0.581)):
            breath.append(_radial_cylinder("helm_breath_cutter_%d%d" % (column, row), azimuth, z,
                                           skull_r(z) + VISOR_GAP + VISOR_THICK / 2, R * 0.054, 0.04, plate))
    ops.boolean_cut(visor, breath)
    add(visor, "visor")

    # the vertical reinforce down the middle of the visor: it also splits the slit into two eyes
    rib = []
    for z in (zs[0], H * 0.55, H * 0.65, H * 0.74, zs[2]):
        r_out = skull_r(z) + VISOR_GAP + VISOR_THICK
        rib.append([Vector((-R * 0.079, -r_out + 0.002, z)), Vector((R * 0.079, -r_out + 0.002, z)),
                    Vector((R * 0.079, -r_out - RIB_PROUD, z)), Vector((-R * 0.079, -r_out - RIB_PROUD, z))])
    add(ops.loft_points("helm_visor_rib", rib, trim), "visor")
    rivets = []
    for azimuth in (FRONT - math.radians(15.0), FRONT + math.radians(15.0)):
        for z in (H * 0.470, H * 0.764):
            r = skull_r(z) + VISOR_GAP + VISOR_THICK + 0.0005
            rivets.append((r * math.cos(azimuth), r * math.sin(azimuth), z))
    add(ops.fasteners("helm_visor_rivets", rivets, R * 0.036, 0.003, "Y", trim, segments=6), "visor")

    # --- brow ring and the reinforcing bands over the crown, ear to ear and front to back --------
    brow = [H * 0.800, H * 0.812, H * 0.856, H * 0.868]
    add(ops.revolve("helm_brow_ring", [
        (brow[0], skull_r(brow[0])), (brow[1], skull_r(brow[1]) + 0.005),
        (brow[2], skull_r(brow[2]) + 0.005), (brow[3], skull_r(brow[3])),
    ], "Z", 24, trim))
    add(_crown_band("helm_band_ears", skull, 0.0, H * 0.42, H * 0.42, R * 0.105, 0.006, 0.004, trim))
    add(_crown_band("helm_band_crest", skull, math.pi / 2, H * 0.42, H * 0.88, R * 0.105, 0.006, 0.004, trim))
    band_rivets = []
    for z in (H * 0.50, H * 0.60, H * 0.70):
        x = skull_r(z) + 0.0065
        band_rivets += [(x, 0.0, z), (-x, 0.0, z)]
    add(ops.fasteners("helm_band_rivets_x", band_rivets, R * 0.036, 0.003, "X", trim, segments=6))
    add(ops.fasteners("helm_band_rivets_y", [
        (0.0, skull_r(z) + 0.0065, z) for z in (H * 0.50, H * 0.60, H * 0.70)
    ], R * 0.036, 0.003, "Y", trim, segments=6))

    # --- temple pins the visor turns on, and the plume socket that sets the top of the box -------
    hinge_z = H * HINGE_Z
    pin_x = skull_r(hinge_z) + 0.002
    for side, name in ((-1, "left"), (1, "right")):
        add(ops.cylinder("helm_hinge_pin_" + name, R * 0.072, 0.014, (side * pin_x, 0.0, hinge_z), "X", 10, trim))
    add(ops.cylinder("helm_plume_collar", R * 0.215, 0.014, (0.0, 0.0, z_crown - 0.002), "Z", 12, trim))
    add(ops.cylinder("helm_plume_socket", R * 0.145, H - z_crown + 0.006, (0.0, 0.0, (H + z_crown - 0.006) / 2), "Z", 12, trim))

    # --- leather: a jaw band around the helm and a chin strap across the bevor -------------------
    jaw = [H * 0.312, H * 0.325, H * 0.400, H * 0.412]
    add(ops.revolve("helm_jaw_band", [
        (jaw[0], skull_r(jaw[0])), (jaw[1], skull_r(jaw[1]) + 0.005),
        (jaw[2], skull_r(jaw[2]) + 0.005), (jaw[3], skull_r(jaw[3])),
    ], "Z", 20, leather))
    add(_arc_plate("helm_chin_strap", [
        (z, _profile_radius(bevor, z), _profile_radius(bevor, z) + 0.005) for z in (H * 0.094, H * 0.188)
    ], phi0, phi1, 9, leather))

    # the helm is built round; squashing Y makes the box exactly dim without distorting the width
    squash = D / W
    if abs(squash - 1.0) > 1e-6:
        matrix = Matrix.Diagonal((1.0, squash, 1.0, 1.0))
        for ob in parts:
            ob.data.transform(matrix)
            ob.data.update()

    bones.append({"bone": "visor", "group": "visor", "motion": "rotate", "pivot": [0.0, 0.0, hinge_z],
                  "axis": [1.0, 0.0, 0.0], "angle": VISOR_ANGLE, "label": "raise", "length": 0.05})
    return parts, bones


def _crown_band(name, profile, phi, z_near, z_far, half_w, proud, sink, slot):
    """A reinforcing strip up the meridian at azimuth `phi` from z_near, across the flat crown and
    down the far side to z_far. The width direction stays one world vector, so the loft is clean."""
    normals = _profile_normals(profile)
    z_crown = profile[-1][0]
    tangent = Vector((-math.sin(phi), math.cos(phi), 0.0))
    up = Vector((0.0, 0.0, 1.0))

    def side(sign, z_low):
        radial = Vector((math.cos(phi), math.sin(phi), 0.0)) * sign
        points = [(radial * r + up * z, radial * n.x + up * n.y) for (z, r), n in zip(profile, normals) if z >= z_low - 1e-9]
        if not points or points[0][0].z > z_low + 1e-9:
            points.insert(0, (radial * _profile_radius(profile, z_low) + up * z_low, Vector(radial)))
        return points

    path = side(1.0, z_near) + [(up * z_crown, Vector(up))] + list(reversed(side(-1.0, z_far)))
    rings = []
    for point, normal in path:
        normal = normal.normalized()
        rings.append([
            point + tangent * half_w - normal * sink,
            point - tangent * half_w - normal * sink,
            point - tangent * half_w + normal * proud,
            point + tangent * half_w + normal * proud,
        ])
    return ops.loft_points(name, rings, slot)
