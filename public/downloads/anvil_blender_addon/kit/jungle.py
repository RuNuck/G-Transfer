"""Jungle biome family: parametric environment kit pieces for scene-compose.

Kinds map 1:1 to biome.jungle.* piece slugs (catalog kind = jungle_<piece>).
Pieces rest on z = 0; bounding box equals requested dimensions within AUTHORING.md
tolerance. Bark/soil take primary; foliage/moss secondary; wet/stone trim; water glass.
Nothing moves — empty rig. Organic bevels stay light so LOD budgets hold.
"""
import math

from . import ops

KINDS = (
    "jungle_terrain_tile_mud",
    "jungle_path_dirt_a",
    "jungle_tree_trunk_a",
    "jungle_tree_trunk_b",
    "jungle_tree_canopy_a",
    "jungle_tree_root_a",
    "jungle_fern_card_a",
    "jungle_shrub_a",
    "jungle_river_bank_a",
    "jungle_water_plane_a",
    "jungle_rock_scatter_a",
    "jungle_fallen_log_a",
    "jungle_mud_decal_a",
)

FINISHING = {
    "jungle_terrain_tile_mud": {"bevel": (0.008, 1), "smooth_angle": 40},
    "jungle_path_dirt_a": {"bevel": (0.006, 1), "smooth_angle": 40},
    "jungle_tree_trunk_a": {"bevel": (0.01, 1), "smooth_angle": 35},
    "jungle_tree_trunk_b": {"bevel": (0.008, 1), "smooth_angle": 35},
    "jungle_tree_canopy_a": {"bevel": (0.02, 1), "smooth_angle": 45},
    "jungle_tree_root_a": {"bevel": (0.012, 1), "smooth_angle": 35},
    "jungle_fern_card_a": {"bevel": (0.004, 1), "smooth_angle": 50},
    "jungle_shrub_a": {"bevel": (0.015, 1), "smooth_angle": 45},
    "jungle_river_bank_a": {"bevel": (0.015, 1), "smooth_angle": 35},
    "jungle_water_plane_a": {"bevel": (0.002, 1), "smooth_angle": 60},
    "jungle_rock_scatter_a": {"bevel": (0.02, 1), "smooth_angle": 30},
    "jungle_fallen_log_a": {"bevel": (0.01, 1), "smooth_angle": 35},
    "jungle_mud_decal_a": {"bevel": (0.004, 1), "smooth_angle": 50},
}

EMPTY_RIG = {"bones": [], "actions": []}


def build(kind, dim, roles, variant=None):
    """Return (parts, finishing, rig). dim is Blender XYZ (width, depth, height)."""
    X, Y, Z = float(dim.x), float(dim.y), float(dim.z)
    bark = roles.get("primary", 0)
    leaf = roles.get("secondary", bark)
    wet = roles.get("trim", bark)
    water = roles.get("glass", wet)

    builders = {
        "jungle_terrain_tile_mud": lambda: _terrain(X, Y, Z, bark, leaf),
        "jungle_path_dirt_a": lambda: _path(X, Y, Z, bark, wet),
        "jungle_tree_trunk_a": lambda: _trunk(X, Y, Z, bark, wet, stout=True),
        "jungle_tree_trunk_b": lambda: _trunk(X, Y, Z, bark, wet, stout=False),
        "jungle_tree_canopy_a": lambda: _canopy(X, Y, Z, leaf, bark),
        "jungle_tree_root_a": lambda: _roots(X, Y, Z, bark, leaf),
        "jungle_fern_card_a": lambda: _fern(X, Y, Z, leaf, bark),
        "jungle_shrub_a": lambda: _shrub(X, Y, Z, leaf, bark),
        "jungle_river_bank_a": lambda: _bank(X, Y, Z, bark, wet),
        "jungle_water_plane_a": lambda: _water(X, Y, Z, water),
        "jungle_rock_scatter_a": lambda: _rock(X, Y, Z, wet, bark),
        "jungle_fallen_log_a": lambda: _log(X, Y, Z, bark, wet),
        "jungle_mud_decal_a": lambda: _mud(X, Y, Z, bark, wet),
    }
    parts = builders[kind]()
    return parts, dict(FINISHING.get(kind, {"bevel": (0.01, 1), "smooth_angle": 35})), dict(EMPTY_RIG)


def _terrain(X, Y, Z, soil, moss):
    parts = [ops.box("tile", (X, Y, Z), (0, 0, Z / 2), soil)]
    pad_h = min(0.03, max(Z * 0.35, 0.005))
    for name, fx, fy, s in (
        ("moss_a", -0.28, -0.22, 0.55),
        ("moss_b", 0.3, 0.18, 0.4),
        ("moss_c", -0.05, 0.32, 0.35),
    ):
        parts.append(ops.box(name, (X * s, Y * s, pad_h), (fx * X, fy * Y, Z - pad_h / 2), moss))
    return parts


def _path(X, Y, Z, dirt, wet):
    parts = [ops.box("path", (X, Y, Z), (0, 0, Z / 2), dirt)]
    rut_h = min(0.02, max(Z * 0.4, 0.004))
    parts.append(ops.box("rut_l", (X * 0.12, Y * 0.85, rut_h), (-X * 0.22, 0, Z - rut_h / 2), wet))
    parts.append(ops.box("rut_r", (X * 0.12, Y * 0.85, rut_h), (X * 0.22, 0, Z - rut_h / 2), wet))
    return parts


def _trunk(X, Y, Z, bark, wet, stout=True):
    r = min(X, Y) / 2
    segs = 16 if stout else 12
    parts = [
        ops.cylinder("trunk", r * (0.95 if stout else 0.88), Z * 0.92, (0, 0, Z * 0.46), "Z", segs, bark),
        ops.cylinder("flare", r * 1.05, Z * 0.08, (0, 0, Z * 0.04), "Z", segs, bark),
        ops.cylinder("ridge", r * 0.18, Z * 0.7, (r * 0.75, 0, Z * 0.45), "Z", 8, wet),
    ]
    return parts


def _canopy(X, Y, Z, leaf, bark):
    base_r = min(X, Y) * 0.28
    parts = [
        ops.sphere(
            "crown",
            base_r,
            (0.0, 0.0, Z * 0.55),
            12,
            8,
            leaf,
            scale=(X / (2 * base_r), Y / (2 * base_r), (Z * 0.55) / (2 * base_r)),
        )
    ]
    for i, (sx, sy) in enumerate(((-0.28, -0.22), (0.3, -0.18), (-0.2, 0.28), (0.25, 0.3))):
        parts.append(
            ops.sphere(
                "lobe_%d" % i,
                min(X, Y) * 0.2,
                (sx * X, sy * Y, Z * (0.45 + 0.08 * (i % 2))),
                10,
                6,
                leaf,
                scale=(1.2, 1.1, 0.85),
            )
        )
    parts.append(ops.cylinder("stem", min(X, Y) * 0.06, Z * 0.2, (0, 0, Z * 0.1), "Z", 10, bark))
    return parts


def _roots(X, Y, Z, bark, moss):
    # Spec height is ~0.70m (Blender Z). Prior ball used Z*0.55 → ~0.39m (−44% Quinn HOLD).
    ball_h = Z * 0.98
    ball_r = min(X, Y) * 0.2
    parts = [ops.cylinder("ball", ball_r, ball_h, (0, 0, ball_h / 2), "Z", 12, bark)]
    half = min(X, Y) * 0.5
    for i, ang in enumerate((0.0, 1.2566, 2.5133, 3.7699, 5.0265)):
        tip_r = half * 0.98
        length = tip_r * 0.9
        dx = math.cos(ang) * (tip_r - length * 0.5)
        dy = math.sin(ang) * (tip_r - length * 0.5)
        root_h = Z * 0.5
        root = ops.box(
            "root_%d" % i,
            (length, min(X, Y) * 0.12, root_h),
            (dx, dy, root_h / 2),
            bark,
            rotation=(0.0, 0.0, ang),
        )
        parts.append(root)
    parts.append(ops.box("moss_pad", (X * 0.5, Y * 0.5, Z * 0.12), (0, 0, Z * 0.06), moss))
    return parts


def _fern(X, Y, Z, leaf, stem):
    # Card in XZ; thin in Y (depth)
    parts = [
        ops.box("frond", (X, max(Y, 0.04), Z), (0, 0, Z / 2), leaf),
        ops.box("midrib", (X * 0.06, max(Y, 0.04) * 1.1, Z * 0.95), (0, 0, Z / 2), stem),
    ]
    for i, t in enumerate((0.25, 0.45, 0.65, 0.8)):
        parts.append(
            ops.box(
                "leaflet_%d" % i,
                (X * 0.35, max(Y, 0.04) * 0.8, Z * 0.08),
                (X * (0.2 if i % 2 == 0 else -0.2), 0, Z * t),
                leaf,
            )
        )
    return parts


def _shrub(X, Y, Z, leaf, bark):
    # Spec footprint ~1.4×1.4m. Prior clumps underfilled → ~1.16×1.16 (−18/−31% Quinn HOLD).
    base_r = min(X, Y) * 0.5
    crown_r = base_r * 0.68
    return [
        ops.cylinder("stem", min(X, Y) * 0.07, Z * 0.42, (0, 0, Z * 0.21), "Z", 10, bark),
        ops.sphere(
            "clump_a",
            crown_r,
            (0.0, 0.0, Z * 0.55),
            12,
            8,
            leaf,
            scale=(
                (X * 0.94) / (2 * crown_r),
                (Y * 0.94) / (2 * crown_r),
                (Z * 0.82) / (2 * crown_r),
            ),
        ),
        ops.sphere("clump_b", min(X, Y) * 0.26, (-X * 0.32, Y * 0.24, Z * 0.48), 10, 6, leaf),
        ops.sphere("clump_c", min(X, Y) * 0.24, (X * 0.3, -Y * 0.22, Z * 0.46), 10, 6, leaf),
        ops.sphere("clump_d", min(X, Y) * 0.2, (X * 0.08, Y * 0.34, Z * 0.4), 10, 6, leaf),
    ]


def _bank(X, Y, Z, soil, wet):
    return [
        ops.box("bank_body", (X, Y * 0.7, Z * 0.85), (0, Y * 0.1, Z * 0.425), soil),
        ops.box("wet_lip", (X * 0.95, Y * 0.35, Z * 0.35), (0, -Y * 0.28, Z * 0.18), wet),
        ops.box("cap", (X * 0.9, Y * 0.4, Z * 0.2), (0, Y * 0.15, Z * 0.9), soil),
    ]


def _water(X, Y, Z, water):
    return [ops.box("water", (X, Y, Z), (0, 0, Z / 2), water)]


def _rock(X, Y, Z, stone, dirt):
    r = min(X, Y, Z) * 0.45
    return [
        ops.sphere(
            "boulder",
            r,
            (0, 0, Z * 0.4),
            12,
            8,
            stone,
            scale=(X / (2 * r), Y / (2 * r), Z / (2 * r)),
        ),
        ops.box("chip", (X * 0.35, Y * 0.25, Z * 0.3), (X * 0.28, -Y * 0.15, Z * 0.15), stone),
        ops.box("dirt_wedge", (X * 0.4, Y * 0.3, Z * 0.12), (-X * 0.15, Y * 0.2, Z * 0.06), dirt),
    ]


def _log(X, Y, Z, bark, wet):
    # Long along X; collision must be convex hull (not vertical capsule) — capsule used
    # max(size.x, size.y) radius and made a ~2.8×2.8 XZ pad around a ~0.43m log (Quinn HOLD).
    r = min(Y, Z) / 2
    return [
        ops.cylinder("log", r * 0.95, X, (0, 0, r), "X", 14, bark),
        ops.cylinder("end_a", r * 0.7, r * 0.25, (-X / 2 + r * 0.15, 0, r), "X", 10, wet),
        ops.cylinder("end_b", r * 0.7, r * 0.25, (X / 2 - r * 0.15, 0, r), "X", 10, wet),
    ]


def _mud(X, Y, Z, mud, wet):
    return [
        ops.box("decal", (X, Y, Z), (0, 0, Z / 2), mud),
        ops.box("puddle", (X * 0.4, Y * 0.35, max(Z * 0.5, 0.005)), (X * 0.1, -Y * 0.1, Z * 0.75), wet),
    ]
