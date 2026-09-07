"""Anvil part kit: families of parametric parts assembled into game-ready meshes.

Entry point for generated scripts:

    from anvil_blender_addon.kit import build_parts
    built = build_parts(kind, dim, materials)   # None when no family covers `kind`
    parts, finishing, rig = built["parts"], built["finishing"], built["rig"]

`kind` is the Anvil prototype kind, `dim` a Vector (X, Y, Z in metres, Z up) and
`materials` the spec's material list (dicts with a "slot" role: primary, secondary, trim,
emissive, glass). Parts come back as mesh objects in the active collection with their
material slot indices already set; `finishing` carries hints for the caller (bevel width
and segments, smooth angle). Kinds without a family return None and the caller falls
back to its own blockout.

`rig` describes the moving parts for animation: {"bones": [{bone, group, motion
("slide" | "rotate"), pivot [x, y, z] in build coordinates, axis, travel metres or angle
degrees, label}], "actions": [{name, parts, keys [(frame, fraction)]}]}. Moving parts carry
a vertex group named after their bone, which survives the join; `rig.apply()` turns the
description into an armature with rigid skinning and demo actions.

Families are discovered: every module in this package that defines `KINDS` (a tuple of
kinds) and `build(kind, dim, roles, variant=None)` returning `(parts, finishing, rig)` is
registered for those kinds. See AUTHORING.md for the conventions a family follows.
"""
import importlib
import pkgutil

from . import rig  # noqa: F401  (the public rigging helper for generated scripts)

_FAMILIES = {}
_SKIP = ("ops", "rig")


def _discover():
    if _FAMILIES:
        return _FAMILIES
    for info in pkgutil.iter_modules(__path__):
        if info.name in _SKIP or info.name.startswith("_"):
            continue
        try:
            module = importlib.import_module(__name__ + "." + info.name)
        except Exception as exc:  # one broken family must not take the whole kit down
            print("Anvil kit: family module %s failed to import: %s" % (info.name, exc))
            continue
        build = getattr(module, "build", None)
        for kind in getattr(module, "KINDS", ()):
            if callable(build):
                _FAMILIES[kind] = module
    return _FAMILIES


def roles_from_materials(materials):
    """Map slot roles to material indices, falling back sensibly when a role is absent."""
    roles = {}
    for index, spec in enumerate(materials):
        roles.setdefault(spec.get("slot", "primary"), index)
    primary = roles.get("primary", 0)
    roles.setdefault("trim", primary)
    roles.setdefault("secondary", roles.get("trim", primary))
    roles.setdefault("emissive", roles["trim"])
    roles.setdefault("glass", roles["secondary"])
    return roles


def build_parts(kind, dim, materials, variant=None):
    module = _discover().get(kind)
    if module is None:
        return None
    parts, finishing, rig_spec = module.build(kind, dim, roles_from_materials(materials), variant)
    return {"parts": parts, "finishing": finishing, "rig": rig_spec or {"bones": [], "actions": []}}


def families():
    return sorted(_discover())
