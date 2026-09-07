"""Blade family: a longsword and a utility dagger assembled from parametric parts.

Both weapons stand along Z with the pommel on z = 0 and the point at z = length. The
spec's X is the width across the guard and its thickness (dim.y) is set by the guard, so
every other part is sized to stay inside those two. Parts: a lofted blade (lens section
with a fuller for the sword, a single-edged drop-point section for the dagger), a guard,
a waisted grip carrying the wrap rings in the leather slot, and a pommel. Nothing moves.

Budget notes: the build script bevels every edge sharper than 30 degrees, which roughly
triples the triangles of a part whose facets are that sharp. The grip rings are therefore
one revolve whose profile keeps every corner under 30 degrees (a stack of tori costs about
five times as much after the bevel), and the pommel rims are quarter rounds in 22.5-degree
steps for the same reason. Sharp corners are left where the bevel earns its keep: guard
ends, blade edges, the fuller and the peen button.
"""
import math

import bpy
from mathutils import Vector

from . import ops

KINDS = ("sword", "dagger")
FINISHING = {"sword": {"bevel": (0.0007, 1), "smooth_angle": 32}, "dagger": {"bevel": (0.0004, 1), "smooth_angle": 32}}
LENS_FLAT = math.sin(math.radians(72))  # ops.lens(w, h) is this fraction of h thick across its flat top


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). `roles` maps primary/secondary/trim to material slot
    indices: the blade takes primary, the grip wrap secondary, guard and pommel trim."""
    W, T, L = float(dim.x), float(dim.y), float(dim.z)
    steel = roles.get("primary", 0)
    leather = roles.get("secondary", steel)
    fittings = roles.get("trim", steel)
    if kind == "dagger":
        parts = _dagger(W, T, L, steel, leather, fittings)
    else:
        parts = _sword(W, T, L, steel, leather, fittings)
    return parts, dict(FINISHING["dagger" if kind == "dagger" else "sword"]), {"bones": [], "actions": []}


# --- helpers ----------------------------------------------------------------------------------------

def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _interp(xs, vals, x):
    """Piecewise-linear interpolation of vals over the sorted xs."""
    if x <= xs[0]:
        return vals[0]
    for x0, x1, v0, v1 in zip(xs, xs[1:], vals, vals[1:]):
        if x <= x1:
            return v0 + (v1 - v0) * (x - x0) / (x1 - x0)
    return vals[-1]


def _bounds(ob):
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def _rounded_disc(h, radius, corner, steps=4, hub=0.0005, boss=None):
    """Revolve profile of a disc 2h long along its axis and `radius` across, its rims quarter
    rounds of `corner` in 22.5-degree steps (below the bevel threshold). `boss` = (height,
    radius) adds a gentle raised hub on both faces; the ends stay at `hub` radius so the
    caps are tiny and the faces flat."""
    profile = []
    if boss:
        bh, br = boss
        profile += [(-h - bh, hub), (-h - bh, br), (-h, br + bh * 2.4)]
    else:
        profile.append((-h, hub))
    profile.append((-h, radius - corner))
    for i in range(1, steps + 1):
        f = (math.pi / 2) * i / steps
        profile.append((-h + corner * (1 - math.cos(f)), radius - corner + corner * math.sin(f)))
    for i in range(steps, -1, -1):
        f = (math.pi / 2) * i / steps
        profile.append((h - corner * (1 - math.cos(f)), radius - corner + corner * math.sin(f)))
    if boss:
        profile += [(h, br + bh * 2.4), (h + bh, br), (h + bh, hub)]
    else:
        profile.append((h, hub))
    return profile


def _wrapped_grip(name, z0, z1, r_end, r_waist, rings, ridge, segments, slot, margin):
    """Waisted round grip with `rings` raised wrap rings, as one revolve along Z. Each ring
    is a low trapezoid whose slopes stay under 30 degrees, so the bevel pass leaves the
    grip alone and it costs 4 profile points per ring instead of a torus."""
    length = z1 - z0
    zc = (z0 + z1) / 2

    def core(z):
        s = (z - zc) / (length / 2)
        return r_waist + (r_end - r_waist) * s * s

    profile = [(z0, core(z0))]
    pitch = (length - 2 * margin) / rings
    rise, top = pitch * 0.22, pitch * 0.2
    for i in range(rings):
        za = z0 + margin + pitch * (i + 0.5) - (rise + top / 2)
        for dz, lift in ((0.0, 0.0), (rise, ridge), (rise + top, ridge), (2 * rise + top, 0.0)):
            profile.append((za + dz, core(za + dz) + lift))
    profile.append((z1, core(z1)))
    return ops.revolve(name, profile, "Z", segments, slot)


def _cross_guard(name, width, depth, height, z_center, slot):
    """Straight cross of rounded-rectangle section along X, the arms swelling in depth to an
    ecusson at the centre. The ecusson is a flat plateau exactly `depth` deep (the asset's
    thickness) whose shoulders slope under 30 degrees, so the bevel pass cannot shave it."""
    u, v = ops.PLANE["X"]
    stations = {1.0: (0.30, 0.76), 0.70: (0.34, 0.80), 0.48: (0.42, 0.86), 0.30: (0.62, 0.93), 0.13: (1.0, 1.0), 0.0: (1.0, 1.0)}
    frames = []
    for fx in (-1.0, -0.70, -0.48, -0.30, -0.13, 0.13, 0.30, 0.48, 0.70, 1.0):
        df, hf = stations[abs(fx)]
        w, h = depth * df, height * hf
        frames.append((Vector((width / 2 * fx, 0.0, z_center)), u, v, w, h, 0.34 * min(w, h)))
    return ops.loft(name, frames, slot, corner_segments=2)


def _oval(w, h, n=16, flat=0.003):
    """Ellipse for loft_shape with a short flat at each end of the long axis, so the extreme
    stays put when the bevel pass chamfers the sharp tip edges. n + 2 points."""
    points = []
    for i in range(n):
        a = 2 * math.pi * i / n
        if i == 0:
            points += [(w / 2, -flat / 2), (w / 2, flat / 2)]
        elif 2 * i == n:
            points += [(-w / 2, flat / 2), (-w / 2, -flat / 2)]
        else:
            points.append((w / 2 * math.cos(a), h / 2 * math.sin(a)))
    return points


def _knife(w, h):
    """Single-edged section for loft_shape: flat back h thick at +u, convex faces to a sharp
    edge at -u, w across. Always 9 points."""
    half = h / 2
    samples = (0.3, 0.6, 0.85)

    def face(s):
        return (w / 2 - s * w, half * (1 - s ** 1.6))

    bottom = [(pu, -pv) for pu, pv in (face(s) for s in reversed(samples))]
    top = [face(s) for s in samples]
    return [(-w / 2, 0.0)] + bottom + [(w / 2, -half), (w / 2, half)] + top


# --- sword ------------------------------------------------------------------------------------------

def _sword_blade(name, z0, z1, width, thick, tip_w, tip_t, slot):
    """Double-edged lens-section blade lofted along Z with profile and distal taper, plus a
    fuller cut into both faces of the first half (skipped if the cut misbehaves)."""
    length = z1 - z0
    stations = [(0.0, 1.0, 1.0), (0.2, 0.93, 0.94), (0.4, 0.84, 0.86), (0.6, 0.72, 0.76), (0.8, 0.54, 0.64), (0.92, 0.33, 0.52), (1.0, tip_w / width, tip_t / thick)]
    zs = [z0 + length * f for f, _, _ in stations]
    thicks = [thick * tf for _, _, tf in stations]
    frames = [((0.0, 0.0, z), width * wf, t / LENS_FLAT) for (_, wf, _), z, t in zip(stations, zs, thicks)]
    blade = ops.loft_shape(name, frames, ops.lens, slot, axis="Z")
    before, bounds = len(blade.data.polygons), _bounds(blade)

    # fuller: two tapered slabs, one per face, following the distal taper so the depth is even
    z_a, z_b = z0 + 0.02, z0 + length * 0.47
    fuller = ((z_a, width * 0.24, 0.0010), (z_b, width * 0.16, 0.0005))
    cutters = []
    for side in (-1, 1):
        rings = []
        for z, fw, depth in fuller:
            y_face = _interp(zs, thicks, z) / 2
            y_in, y_out = side * (y_face - depth), side * (y_face + 0.004)
            rings.append([(-fw / 2, y_in, z), (fw / 2, y_in, z), (fw / 2, y_out, z), (-fw / 2, y_out, z)])
        cutters.append(ops.loft_points("fuller_cutter", rings, slot))
    try:
        ops.boolean_cut(blade, cutters)
        cut_ok = len(blade.data.polygons) > before and all(abs(a - b) < 1e-5 for a, b in zip(_bounds(blade), bounds))
    except Exception as exc:  # the exact solver is robust, but a bad cut must not lose the blade
        print("Anvil blade: fuller cut failed, building a plain blade:", exc)
        cut_ok = False
    if not cut_ok:
        for cut in cutters:
            if cut.name in bpy.data.objects:
                data = cut.data
                bpy.data.objects.remove(cut, do_unlink=True)
                bpy.data.meshes.remove(data)
        data = blade.data
        bpy.data.objects.remove(blade, do_unlink=True)
        bpy.data.meshes.remove(data)
        blade = ops.loft_shape(name, frames, ops.lens, slot, axis="Z")
    return blade


def _sword(W, T, L, steel, leather, fittings):
    """Longsword: wheel pommel with peen button, waisted wrapped grip, flared cross, tapered
    fullered blade. Guard = W across and T deep; button bottom on z = 0, point at z = L."""
    guard_h = _clamp(L * 0.0145, 0.010, 0.020)
    blade_len = L * 0.735                       # visible blade above the guard
    z_guard = L - blade_len - guard_h / 2       # guard centre
    blade_w = min(0.046, W * 0.25)
    blade_t = min(0.0052, T * 0.13)
    pommel_r = _clamp(L * 0.0226, 0.018, 0.032)
    pommel_h = min(0.014, T * 0.35)             # half thickness of the wheel
    boss_h = min(0.002, (T / 2 - pommel_h) * 0.5)
    button_h = min(0.008, pommel_r * 0.3)
    grip_r = min(0.0135, T * 0.34, pommel_h - 0.0005)
    ridge = min(0.002, grip_r * 0.15)
    z_pommel = button_h - 0.002 + pommel_r      # wheel centre; the button overlaps it by 2 mm

    parts = []
    parts.append(ops.cone("pommel_button", button_h * 0.7, button_h * 0.95, button_h, (0.0, 0.0, button_h / 2), "Z", 12, fittings))
    disc = _rounded_disc(pommel_h, pommel_r, min(0.004, pommel_r * 0.16), boss=(boss_h, pommel_r * 0.35))
    parts.append(ops.revolve("pommel", disc, "Y", 20, fittings, center=(0.0, 0.0, z_pommel)))
    parts.append(_wrapped_grip("grip", z_pommel + pommel_r - 0.006, z_guard + 0.003, grip_r, grip_r * 0.9, 11, ridge, 16, leather, 0.008))
    parts.append(_cross_guard("crossguard", W, T, guard_h, z_guard, fittings))
    parts.append(_sword_blade("blade", z_guard - 0.002, L, blade_w, blade_t, 0.006, 0.002, steel))
    return parts


# --- dagger -----------------------------------------------------------------------------------------

def _dagger_blade(name, z0, z1, width, thick, slot):
    """Drop-point single-edged blade: the spine (at +X) runs straight then drops gently to
    the point while the edge sweeps up to meet it, so the tip sits near the centreline."""
    length = z1 - z0
    stations = [(0.0, 0.97, 1.0), (0.15, 0.985, 0.98), (0.35, 1.0, 0.93), (0.55, 1.0, 0.87), (0.7, 0.93, 0.78), (0.82, 0.76, 0.67), (0.92, 0.45, 0.53), (1.0, 0.14, 0.36)]
    spine = width * 0.485
    frames = []
    for f, wf, tf in stations:
        drop = 0.31 * width * ((f - 0.65) / 0.35) ** 2 if f > 0.65 else 0.0
        w = width * wf
        frames.append(((spine - drop - w / 2, 0.0, z0 + length * f), w, thick * tf))
    return ops.loft_shape(name, frames, _knife, slot, axis="Z")


def _dagger(W, T, L, steel, leather, fittings):
    """Utility dagger: small rounded pommel, wrapped grip, oval plate guard (W by T), drop-point
    blade. Pommel bottom on z = 0, point at z = L."""
    guard_h = _clamp(L * 0.016, 0.005, 0.010)
    z_guard = L * 0.34 - guard_h / 2            # guard centre; the blade starts at the guard top
    pommel_r = min(0.0098, T * 0.49, W * 0.2)
    pommel_h = _clamp(L * 0.02, 0.006, 0.012)   # half height
    grip_r = min(0.0086, T * 0.43)
    ridge = min(0.0013, T * 0.5 - grip_r - 0.0001)
    blade_w = min(0.029, W * 0.36)
    blade_t = min(0.0045, T * 0.225)

    parts = []
    parts.append(ops.revolve("pommel", _rounded_disc(pommel_h, pommel_r, min(0.003, pommel_r * 0.3)), "Z", 14, fittings, center=(0.0, 0.0, pommel_h)))
    parts.append(_wrapped_grip("grip", 2 * pommel_h - 0.003, z_guard + 0.002, grip_r, grip_r * 0.91, 8, ridge, 14, leather, 0.006))
    parts.append(ops.loft_shape("guard", [((0.0, 0.0, z_guard - guard_h / 2), W, T), ((0.0, 0.0, z_guard + guard_h / 2), W, T)], ops.ellipse, fittings, axis="Z"))
    parts.append(_dagger_blade("blade", z_guard, L, blade_w, blade_t, steel))
    return parts
