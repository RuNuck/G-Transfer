"""Run every generated build script inside real Blender the way the add-on does (exec with a bare namespace),
twice each (re-run must replace, not duplicate), with pre-existing user objects that must survive,
and check geometry, pivot, names, materials, UVs, LODs, collision, result and GLB export.

blender --background --python tools/blender-check/check-build.py -- tools/blender-check/out/gen tools/blender-check/out/build-report.json [only_substring]
"""
import json
import os
import re
import sys
import traceback

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
GEN, REPORT = argv[0], argv[1]
KIT_DIR = os.environ.get("ANVIL_KIT_DIR")  # parent of the anvil_blender_addon package: exercises the part-kit path
for _name in [n for n in list(sys.modules) if n == "anvil_blender_addon" or n.startswith("anvil_blender_addon.")]:
    del sys.modules[_name]  # an installed single-file add-on would shadow the package
if os.environ.get("ANVIL_NO_ADDON"):  # exercise the blockout path even where the add-on is installed
    sys.modules["anvil_blender_addon"] = None
elif KIT_DIR:
    sys.path.insert(0, KIT_DIR)
ONLY = argv[2] if len(argv) > 2 else ""
EXPORT_DIR = os.path.join(GEN, "glb")
os.makedirs(EXPORT_DIR, exist_ok=True)

PREFIX = {"unreal": "MI_", "unity": "M_", "godot": "mat_", "blender": "MAT_"}


def slug(name):
    s = re.sub(r"[^A-Za-z0-9]+", "_", name)
    s = re.sub(r"^_|_$", "", s)
    return re.sub(r"_+", "_", s)


def material_name(engine, name):
    s = slug(name)
    return PREFIX[engine] + (s.lower() if engine == "godot" else s)


def bounds(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def close(a, b, tol):
    return abs(a - b) <= tol


def check(case):
    base = os.path.join(GEN, case)
    meta = json.load(open(base + ".json", encoding="utf-8"))
    spec, mesh, col_name = meta["spec"], meta["mesh"], meta["collision"]
    code = open(base + ".py", encoding="utf-8").read()
    problems = []

    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(5, 5, 5))
    bpy.context.object.name = "UserCube"
    bpy.ops.object.light_add(type="POINT", location=(3, 3, 3))
    bpy.context.object.name = "UserLight"
    user_mat = bpy.data.materials.new("UserMaterial")
    bpy.data.objects["UserCube"].data.materials.append(user_mat)

    export_path = os.path.join(EXPORT_DIR, case + ".glb")
    os.environ["ANVIL_EXPORT_PATH"] = export_path
    ns = {"bpy": bpy, "result": None}
    exec(compile(code, case + ".py", "exec"), ns, ns)
    first_result = ns.get("result")
    exec(compile(code, case + ".py", "exec"), ns, ns)  # re-run must replace the previous build cleanly

    names = {o.name for o in bpy.data.objects}
    for keep in ("UserCube", "UserLight"):
        if keep not in names:
            problems.append(f"user object {keep} was deleted")
    if "UserMaterial" not in bpy.data.materials:
        problems.append("user material was deleted")
    dupes = sorted(n for n in names if re.search(r"\.\d{3}$", n))
    if dupes:
        problems.append(f"duplicate-suffixed objects after re-run: {dupes}")

    body = bpy.data.objects.get(mesh)
    if body is None:
        problems.append(f"body {mesh} missing; objects: {sorted(names)}")
        return {"ok": False, "problems": problems}

    coll = bpy.data.collections.get("Anvil_" + mesh)
    if coll is None or body.name not in coll.objects:
        problems.append("body is not in the Anvil_<mesh> collection")

    lo, hi = bounds(body)
    size = hi - lo
    expected = (spec["dimensions"]["x"], spec["dimensions"]["z"], spec["dimensions"]["y"])
    for axis, (got, want) in enumerate(zip(size, expected)):
        if not close(got, want, max(0.03 * want, 0.006)):
            problems.append(f"dimension axis {axis}: got {got:.4f} expected {want}")
    center = (lo + hi) / 2
    if spec["pivot"] == "bottom":
        if not close(lo.z, 0.0, 0.002):
            problems.append(f"bottom pivot: min z is {lo.z:.4f}")
        if not (close(center.x, 0, 0.002) and close(center.y, 0, 0.002)):
            problems.append(f"bottom pivot: xy centre is ({center.x:.3f}, {center.y:.3f})")
    else:
        if not all(close(c, 0, 0.002) for c in center):
            problems.append(f"center pivot: bounds centre is {tuple(round(c, 3) for c in center)}")
    if any(abs(v) > 1e-6 for v in body.location):
        problems.append(f"body origin not at world origin: {tuple(body.location)}")
    if any(abs(s - 1) > 1e-6 for s in body.scale):
        problems.append(f"body scale not applied: {tuple(body.scale)}")

    want_mats = [material_name(spec["engine"], m["name"]) for m in spec["materials"]]
    got_mats = [m.name if m else None for m in body.data.materials]
    if got_mats != want_mats:
        problems.append(f"materials {got_mats} != {want_mats}")
    for m in body.data.materials:
        if m is None:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            problems.append(f"material {m.name} has no Principled BSDF")
    emissive = [m for m in spec["materials"] if m.get("emissive")]
    if emissive:
        m = body.data.materials[spec["materials"].index(emissive[0])]
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        if bsdf.inputs["Emission Strength"].default_value <= 0:
            problems.append("emissive material has zero emission strength")

    if not any(p.use_smooth for p in body.data.polygons):
        problems.append("no smooth-shaded faces")
    if len(body.data.uv_layers) != 2:
        problems.append(f"uv layers: {len(body.data.uv_layers)}")
    else:
        uv = body.data.uv_layers[0].data
        if uv and all(abs(d.uv.x) < 1e-6 and abs(d.uv.y) < 1e-6 for d in uv):
            problems.append("UV0 is all zeros")

    for i in (1, 2):
        lod = bpy.data.objects.get(f"{mesh}_LOD{i}")
        if lod is None:
            problems.append(f"LOD{i} missing")
            continue
        if lod.display_type != "WIRE":
            problems.append(f"LOD{i} display is {lod.display_type}")
        if any(abs(v) > 1e-6 for v in lod.location):
            problems.append(f"LOD{i} moved to {tuple(lod.location)}")
        if lod.modifiers:
            problems.append(f"LOD{i} still has modifiers {[m.type for m in lod.modifiers]}")
        if lod.name not in coll.objects:
            problems.append(f"LOD{i} not in the Anvil collection")
    def tris(ob):
        return sum(max(len(p.vertices) - 2, 0) for p in ob.data.polygons)

    lod1 = bpy.data.objects.get(f"{mesh}_LOD1")
    lod2 = bpy.data.objects.get(f"{mesh}_LOD2")
    if lod1 and lod2 and tris(lod2) > tris(lod1):
        problems.append(f"LOD2 has more triangles ({tris(lod2)}) than LOD1 ({tris(lod1)})")
    if lod2 and tris(lod2) > spec["triangleBudget"]["lod2"]:
        problems.append(f"LOD2 over budget: {tris(lod2)} > {spec['triangleBudget']['lod2']}")

    col = bpy.data.objects.get(col_name)
    if col is None:
        problems.append(f"collision {col_name} missing")
    else:
        clo, chi = bounds(col)
        for axis in range(3):
            if clo[axis] > lo[axis] + 0.002 or chi[axis] < hi[axis] - 0.002:
                problems.append(f"collision does not enclose the body on axis {axis}: {tuple(clo)}..{tuple(chi)} vs {tuple(lo)}..{tuple(hi)}")
            # a capsule or sphere must be as wide as the widest axis, so only boxes and hulls are size-checked
            if spec["collision"] in ("box", "convex") and (chi[axis] - clo[axis]) > (hi[axis] - lo[axis]) * 1.6 + 0.05:
                problems.append(f"collision much larger than body on axis {axis}")
        if col.display_type != "WIRE":
            problems.append("collision display is not WIRE")
        if any(abs(v) > 1e-6 for v in col.location):
            problems.append(f"collision origin not at body origin: {tuple(col.location)}")
        if len(col.data.polygons) > 400:
            problems.append(f"collision has {len(col.data.polygons)} faces")

    if not isinstance(ns.get("result"), str) or mesh not in ns["result"]:
        problems.append(f"result not set: {ns.get('result')!r}")
    if not isinstance(first_result, str):
        problems.append("first run did not set result")

    if not os.path.exists(export_path) or os.path.getsize(export_path) < 1000:
        problems.append("GLB export missing or tiny")
    else:
        import struct
        with open(export_path, "rb") as fh:
            magic, version, length = struct.unpack("<III", fh.read(12))
            chunk_len, chunk_type = struct.unpack("<II", fh.read(8))
            gltf = json.loads(fh.read(chunk_len).decode("utf-8"))
        node_names = {n.get("name") for n in gltf.get("nodes", [])}
        lods = (f"{mesh}_LOD1", f"{mesh}_LOD2")
        # Godot builds its own LODs at import and has no exported LOD chain, so shipping these
        # would just draw three copies of the asset on top of each other. Every other engine
        # reads them from the file. They stay in the scene either way; only the export differs.
        wanted = (mesh, col_name) if spec["engine"] == "godot" else (mesh, *lods, col_name)
        for want in wanted:
            if want not in node_names:
                problems.append(f"GLB lacks node {want}; nodes: {sorted(node_names)}")
        if spec["engine"] == "godot":
            for unwanted in lods:
                if unwanted in node_names:
                    problems.append(f"GLB for Godot should not carry {unwanted}")
        mat_names = {m.get("name") for m in gltf.get("materials", [])}
        if not set(want_mats) <= mat_names:
            problems.append(f"GLB materials {sorted(mat_names)} lack {want_mats}")

    return {
        "ok": not problems,
        "problems": problems,
        "size": [round(v, 4) for v in size],
        "expected": expected,
        "tris_lod0": sum(len(p.vertices) - 2 for p in body.data.polygons),
        "lod1_faces": len(lod1.data.polygons) if lod1 else None,
        "lod2_faces": len(lod2.data.polygons) if lod2 else None,
        "collision_faces": len(col.data.polygons) if col else None,
        "result": ns.get("result"),
    }


cases = sorted(f[:-5] for f in os.listdir(GEN) if f.endswith(".json") and ONLY in f)
report = {}
for case in cases:
    try:
        report[case] = check(case)
    except Exception:
        report[case] = {"ok": False, "problems": ["EXCEPTION: " + traceback.format_exc()[-1500:]]}
    print("CASE", case, "OK" if report[case]["ok"] else "FAIL", flush=True)

with open(REPORT, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=1)
failed = [c for c, r in report.items() if not r["ok"]]
print(f"SUMMARY {len(cases) - len(failed)}/{len(cases)} passed; failed: {failed}")
