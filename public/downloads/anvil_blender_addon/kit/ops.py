"""Parametric mesh operations for kit parts.

Every builder returns a new mesh object linked to the active collection, with all of its
faces on one material slot index. Coordinates are metres with Z up. Objects keep their
origin at the world origin; use rotate_about_center() to angle a part in place.

Sections: 2D profiles (rounded_rect, ellipse, diamond, lens), lofts (loft_points, loft,
loft_x, loft_shape), primitives (box, rounded_box, cylinder, cone, sphere, torus, revolve),
repeated details (rail, ribs, fasteners), edits (mirror, rotate_about_center, boolean_cut)
and part tagging for the rig (tag_part).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

MIN_RADIUS = 0.0005
AXIS_ROTATION = {
    "X": Matrix.Rotation(math.pi / 2, 4, "Y"),
    "Y": Matrix.Rotation(-math.pi / 2, 4, "X"),
    "Z": Matrix.Identity(4),
}
# unit vectors spanning the plane perpendicular to each axis, for lofts and profiles
PLANE = {
    "X": (Vector((0, 1, 0)), Vector((0, 0, 1))),
    "Y": (Vector((1, 0, 0)), Vector((0, 0, 1))),
    "Z": (Vector((1, 0, 0)), Vector((0, 1, 0))),
}
AXIS = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}


def _link(name, bm, slot):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.view_layer.active_layer_collection.collection.objects.link(ob)
    for poly in me.polygons:
        poly.material_index = slot
    return ob


# --- 2D profiles: (u, v) points counter-clockwise, centred on the origin ----------------------

def rounded_rect(w, h, r, corner_segments=3):
    """Always 4 * (corner_segments + 1) points, so any two profiles can be lofted."""
    r = max(MIN_RADIUS, min(r, w / 2 - 1e-6, h / 2 - 1e-6))
    hw, hh = w / 2 - r, h / 2 - r
    corners = [(hw, hh, 0.0), (-hw, hh, math.pi / 2), (-hw, -hh, math.pi), (hw, -hh, 3 * math.pi / 2)]
    points = []
    for cx, cy, a0 in corners:
        for i in range(corner_segments + 1):
            a = a0 + (math.pi / 2) * i / corner_segments
            points.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return points


def ellipse(w, h, n=16):
    return [(w / 2 * math.cos(2 * math.pi * i / n), h / 2 * math.sin(2 * math.pi * i / n)) for i in range(n)]


def diamond(w, h):
    """Four points: a rhombus w wide and h thick (blade sections, spear heads)."""
    return [(w / 2, 0.0), (0.0, h / 2), (-w / 2, 0.0), (0.0, -h / 2)]


def lens(w, h, n=6):
    """Lenticular section, w wide and h thick: two arcs meeting at sharp edges; 2n - 2 points."""
    top = [(w / 2 * math.cos(math.pi * i / (n - 1)), h / 2 * math.sin(math.pi * i / (n - 1))) for i in range(n)]
    bottom = [(-w / 2 * math.cos(math.pi * i / (n - 1)), -h / 2 * math.sin(math.pi * i / (n - 1))) for i in range(1, n - 1)]
    return top + bottom


# --- lofts ----------------------------------------------------------------------------------------

def loft_points(name, rings, slot=0, cap=True):
    """Skin a list of rings (lists of 3D points, all the same length, consistently wound).
    Rings must not collapse to a point: use a tiny radius instead of zero."""
    bm = bmesh.new()
    verts = [[bm.verts.new(Vector(p)) for p in ring] for ring in rings]
    for a, b in zip(verts, verts[1:]):
        n = len(a)
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap:
        bm.faces.new(list(reversed(verts[0])))
        bm.faces.new(verts[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _link(name, bm, slot)


def loft(name, frames, slot=0, corner_segments=3, cap=True):
    """Skin rounded-rectangle sections: frames of (center, u, v, width, height, radius) where
    center is a Vector and u, v are unit Vectors spanning the section plane."""
    rings = [[center + u * px + v * py for px, py in rounded_rect(w, h, r, corner_segments)] for center, u, v, w, h, r in frames]
    return loft_points(name, rings, slot, cap)


def loft_x(name, sections, slot=0, corner_segments=3):
    """Loft rounded-rectangle sections perpendicular to X: (x, cy, cz, width, height, radius)."""
    u, v = PLANE["X"]
    return loft(name, [(Vector((x, cy, cz)), u, v, w, h, r) for x, cy, cz, w, h, r in sections], slot, corner_segments)


def loft_shape(name, frames, shape, slot=0, cap=True, axis=None):
    """Skin sections of any profile: frames of (center, width, height) along `axis` ("X", "Y" or
    "Z"), or (center, u, v, width, height) with explicit plane vectors when axis is None.
    `shape(w, h)` returns the 2D profile (ellipse, diamond, lens or your own) and must give
    the same number of points for every frame."""
    rings = []
    for frame in frames:
        if axis is not None:
            center, w, h = frame
            u, v = PLANE[axis]
        else:
            center, u, v, w, h = frame
        center = Vector(center)
        rings.append([center + u * px + v * py for px, py in shape(w, h)])
    return loft_points(name, rings, slot, cap)


# --- primitives -----------------------------------------------------------------------------------

def box(name, size, center, slot=0, rotation=(0.0, 0.0, 0.0)):
    """Box of `size` (x, y, z) at `center`, rotated about its own centre (Euler XYZ radians)."""
    bm = bmesh.new()
    matrix = (
        Matrix.Translation(Vector(center))
        @ Matrix.Rotation(rotation[2], 4, "Z")
        @ Matrix.Rotation(rotation[1], 4, "Y")
        @ Matrix.Rotation(rotation[0], 4, "X")
        @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    )
    bmesh.ops.create_cube(bm, size=1.0, matrix=matrix)
    return _link(name, bm, slot)


def rounded_box(name, size, center, radius, slot=0, corner_segments=2, axis="X"):
    """Box whose edges along `axis` are rounded: a rounded-rectangle profile in the plane
    perpendicular to the axis, extruded along it."""
    u, v = PLANE[axis]
    d = AXIS[axis]
    center = Vector(center)
    sizes = {"X": (size[1], size[2], size[0]), "Y": (size[0], size[2], size[1]), "Z": (size[0], size[1], size[2])}
    w, h, length = sizes[axis]
    frames = [(center - d * (length / 2), u, v, w, h, radius), (center + d * (length / 2), u, v, w, h, radius)]
    return loft(name, frames, slot, corner_segments)


def cylinder(name, radius, length, center, axis="X", segments=16, slot=0):
    """Closed cylinder along X, Y or Z."""
    return cone(name, radius, radius, length, center, axis, segments, slot)


def cone(name, radius1, radius2, length, center, axis="Z", segments=16, slot=0):
    """Closed truncated cone (radius1 at the low end of the axis, radius2 at the high end)."""
    bm = bmesh.new()
    matrix = Matrix.Translation(Vector(center)) @ AXIS_ROTATION[axis]
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=max(radius1, MIN_RADIUS), radius2=max(radius2, MIN_RADIUS), depth=length, matrix=matrix)
    return _link(name, bm, slot)


def sphere(name, radius, center, segments=16, rings=8, slot=0, scale=(1.0, 1.0, 1.0)):
    """UV sphere, optionally squashed by `scale` (x, y, z)."""
    bm = bmesh.new()
    matrix = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius, matrix=matrix)
    return _link(name, bm, slot)


def torus(name, major, minor, center, axis="Z", segments=24, ring_segments=8, slot=0):
    """Torus (ring) of radius `major` with a tube of radius `minor`, around `axis`."""
    bm = bmesh.new()
    matrix = Matrix.Translation(Vector(center)) @ AXIS_ROTATION[axis]
    rings = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        radial = Vector((math.cos(a), math.sin(a), 0.0))
        ring = []
        for j in range(ring_segments):
            b = 2 * math.pi * j / ring_segments
            p = radial * (major + minor * math.cos(b)) + Vector((0.0, 0.0, minor * math.sin(b)))
            ring.append(bm.verts.new(matrix @ p))
        rings.append(ring)
    for i in range(segments):
        a, b = rings[i], rings[(i + 1) % segments]
        for j in range(ring_segments):
            bm.faces.new((a[j], a[(j + 1) % ring_segments], b[(j + 1) % ring_segments], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _link(name, bm, slot)


def revolve(name, profile, axis="Z", segments=24, slot=0, center=(0.0, 0.0, 0.0)):
    """Solid of revolution around an axis through `center`. profile: [(t, radius), ...] with t
    the position along the axis (metres from `center`). Both ends are capped."""
    bm = bmesh.new()
    d = AXIS[axis]
    u, v = PLANE[axis]
    center = Vector(center)
    rings = []
    for t, r in profile:
        r = max(r, MIN_RADIUS)
        rings.append([bm.verts.new(center + d * t + (u * math.cos(a) + v * math.sin(a)) * r) for a in (2 * math.pi * i / segments for i in range(segments))])
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            bm.faces.new((a[i], a[(i + 1) % segments], b[(i + 1) % segments], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _link(name, bm, slot)


def revolve_x(name, profile, segments=24, slot=0, z=0.0):
    """Solid of revolution around an axis parallel to X at height z. profile: [(x, radius), ...]."""
    return revolve(name, profile, "X", segments, slot, center=(0.0, 0.0, z))


# --- repeated details -----------------------------------------------------------------------------

def rail(name, x0, x1, y, z, width, base_height, block_height, pitch=0.01, slot_width=0.0053, slot=0, direction=1):
    """Picatinny-style rail mounted on the surface at z, growing in `direction` (+1 up, -1 down)."""
    bm = bmesh.new()
    length = x1 - x0
    d = 1 if direction >= 0 else -1
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(Vector((x0 + length / 2, y, z + d * base_height / 2))) @ Matrix.Diagonal((length, width, base_height, 1.0)))
    x = x0
    while x + pitch <= x1 + 1e-9:
        block_len = pitch - slot_width
        cx = x + slot_width + block_len / 2
        cz = z + d * (base_height + block_height / 2)
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(Vector((cx, y, cz))) @ Matrix.Diagonal((block_len, width, block_height, 1.0)))
        x += pitch
    return _link(name, bm, slot)


def ribs(name, x0, x1, y, z, count, size, slot=0, axis="X"):
    """A row of `count` small boxes of `size` spread between x0 and x1 along `axis`
    (vent ribs, grip serrations, planks, louvres); y and z are the other two coordinates."""
    bm = bmesh.new()
    for i in range(count):
        c = x0 + (x1 - x0) * (i + 0.5) / count
        pos = {"X": (c, y, z), "Y": (y, c, z), "Z": (y, z, c)}[axis]
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(Vector(pos)) @ Matrix.Diagonal((size[0], size[1], size[2], 1.0)))
    return _link(name, bm, slot)


def fasteners(name, positions, radius=0.003, height=0.0015, axis="Y", slot=0, segments=10):
    """Screw or rivet heads: short, slightly tapered cylinders at the given centres, pointing along `axis`."""
    bm = bmesh.new()
    for center in positions:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius * 0.85, depth=height, matrix=Matrix.Translation(Vector(center)) @ AXIS_ROTATION[axis])
    return _link(name, bm, slot)


# --- edits ----------------------------------------------------------------------------------------

def tag_part(ob, group):
    """Put every vertex of a part in a vertex group named after its bone, so the part stays
    addressable after the join and rigid-skins to that bone when the rig is applied."""
    vg = ob.vertex_groups.get(group) or ob.vertex_groups.new(name=group)
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")
    return ob


def mirror(ob, axis="Y"):
    """Add a mirrored copy of the part's geometry to the same object (symmetric details).

    bmesh.ops.mirror already duplicates what it is given, so the geometry must be passed whole:
    handing it only vertices leaves loose mirrored points and no faces, and duplicating first
    leaves a coincident copy. Mirroring reverses the winding, so the new faces are flipped back."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    result = bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], matrix=Matrix.Identity(4), merge_dist=-1.0, axis=axis)
    new_faces = [g for g in result["geom"] if isinstance(g, bmesh.types.BMFace)]
    if new_faces:
        bmesh.ops.reverse_faces(bm, faces=new_faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob


def rotate_about_center(ob, rotation):
    """Rotate a part's geometry about its own bounding-box centre (Euler XYZ radians)."""
    me = ob.data
    center = sum((Vector(c) for c in ob.bound_box), Vector()) / 8
    rot = Matrix.Rotation(rotation[2], 4, "Z") @ Matrix.Rotation(rotation[1], 4, "Y") @ Matrix.Rotation(rotation[0], 4, "X")
    me.transform(Matrix.Translation(center) @ rot @ Matrix.Translation(-center))
    me.update()
    return ob


def translate(ob, offset):
    """Move a part's geometry (the object stays at the world origin)."""
    ob.data.transform(Matrix.Translation(Vector(offset)))
    ob.data.update()
    return ob


def boolean_cut(target, cutter, slot=None):
    """Subtract one cutter (or a list of them) from `target` with the exact solver and delete
    the cutters. The result keeps the target's single material slot index.

    A cut that returns an empty mesh is treated as a failure and rolled back, so a family can
    never silently ship a part the solver deleted. Prefer one cutter object per hole over a
    single cutter made of many loose shells: the solver copes with them far more reliably."""
    if slot is None:
        slot = target.data.polygons[0].material_index if len(target.data.polygons) else 0
    cutters = list(cutter) if isinstance(cutter, (list, tuple)) else [cutter]
    for cut in cutters:
        mod = target.modifiers.new("AnvilCut", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = cut
        mod.solver = "EXACT"
        if hasattr(mod, "material_mode"):
            mod.material_mode = "INDEX"
        bpy.ops.object.select_all(action="DESELECT")
        target.select_set(True)
        bpy.context.view_layer.objects.active = target
        backup = target.data.copy()  # the exact solver can return an empty mesh on awkward input
        bpy.ops.object.modifier_apply(modifier=mod.name)
        if len(target.data.polygons) == 0 and len(backup.polygons):
            print("Anvil kit: boolean cut of %r by %r returned an empty mesh; keeping the uncut part" % (target.name, cut.name))
            emptied = target.data
            target.data = backup
            bpy.data.meshes.remove(emptied)
        else:
            bpy.data.meshes.remove(backup)
        data = cut.data
        bpy.data.objects.remove(cut, do_unlink=True)
        bpy.data.meshes.remove(data)
    me = target.data
    while len(me.materials):  # any slot the boolean introduced would become an empty slot after join
        me.materials.pop(index=0)
    for poly in me.polygons:
        poly.material_index = slot
    return target
