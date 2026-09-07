"""Build one generated case through the part kit and report on the family: bounding box, budget,
slots, moving parts, renders. The authoring loop for kit families.

blender --background --python tools/kit-check/check-kit.py -- <gen_dir> <case> <out_dir> [--rig] [--surface] [--size N]

<gen_dir> holds the scripts fetched by tools/blender-check/fetch-scripts.mjs; <case> is
<kind>_<engine>, e.g. crate_unreal. The kit is imported from ANVIL_KIT_DIR or, by default,
this repository's public/downloads. Writes <out_dir>/report.json, two renders of the rest
pose (view-a.png from the front left, view-b.png from the back right), one render per demo
clip with --rig, and surfaced renders with --surface (bake at --size, 512 by default).
"""
import json
import math
import os
import re
import struct
import sys
import time
import traceback

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
argv = sys.argv[sys.argv.index("--") + 1 :]
GEN, CASE, OUT = argv[0], argv[1], argv[2]
RIG = "--rig" in argv
SURFACE = "--surface" in argv
SIZE = int(argv[argv.index("--size") + 1]) if "--size" in argv else 512
HERE = os.path.dirname(os.path.abspath(__file__))
KIT_DIR = os.environ.get("ANVIL_KIT_DIR") or os.path.normpath(os.path.join(HERE, "..", "..", "public", "downloads"))
for _name in [n for n in list(sys.modules) if n == "anvil_blender_addon" or n.startswith("anvil_blender_addon.")]:
    del sys.modules[_name]
sys.path.insert(0, KIT_DIR)
os.makedirs(OUT, exist_ok=True)
os.environ["ANVIL_RIG"] = "1" if RIG else ""
os.environ["ANVIL_EXPORT_PATH"] = os.path.join(OUT, CASE + ".glb")
os.environ["ANVIL_TEXTURE_DIR"] = os.path.join(OUT, "textures")

base = os.path.join(GEN, CASE)
meta = json.load(open(base + ".json", encoding="utf-8"))
spec = meta["spec"]
report = {"case": CASE, "ok": False, "problems": [], "kit_dir": KIT_DIR}
problems = report["problems"]


def bounds(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def evaluated_vertices(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    verts = [v.co.copy() for v in me.vertices]
    tris = sum(max(len(p.vertices) - 2, 0) for p in me.polygons)
    return verts, tris


try:
    bpy.ops.wm.read_homefile(use_empty=True)
    code = open(base + ".py", encoding="utf-8").read()
    ns = {"bpy": bpy, "result": None}
    t0 = time.time()
    exec(compile(code, CASE + ".py", "exec"), ns, ns)
    report["build_seconds"] = round(time.time() - t0, 1)
    report["result"] = ns.get("result")
    body = bpy.data.objects[meta["mesh"]]
    if body.get("anvil_source") != "kit":
        problems.append("the build used the blockout, not the kit: is the family registered (KINDS + build)?")

    lo, hi = bounds(body)
    size = hi - lo
    expected = (spec["dimensions"]["x"], spec["dimensions"]["z"], spec["dimensions"]["y"])
    report["size"] = [round(v, 4) for v in size]
    report["expected"] = list(expected)
    for axis, (got, want) in enumerate(zip(size, expected)):
        if abs(got - want) > max(0.03 * want, 0.006):
            problems.append("dimension %s: got %.4f expected %s" % ("XYZ"[axis], got, want))

    _, tris = evaluated_vertices(body)
    budget = spec["triangleBudget"]["lod0"]
    report["tris_lod0"] = tris
    report["budget_lod0"] = budget
    report["raw_polys"] = len(body.data.polygons)
    if tris > budget:
        problems.append("LOD0 %d triangles over the budget of %d" % (tris, budget))
    lod2 = bpy.data.objects.get(meta["mesh"] + "_LOD2")
    if lod2 is not None:
        report["tris_lod2"] = sum(max(len(p.vertices) - 2, 0) for p in lod2.data.polygons)

    used = {p.material_index for p in body.data.polygons}
    names = [m.name if m else None for m in body.data.materials]
    report["slots"] = {names[i] if i < len(names) else i: sum(1 for p in body.data.polygons if p.material_index == i) for i in sorted(used)}
    missing = [names[i] for i in range(len(names)) if i not in used]
    if missing:
        problems.append("material slots with no faces: %s" % missing)

    report["groups"] = sorted(g.name for g in body.vertex_groups)
    parts = json.loads(body["anvil_parts"]) if "anvil_parts" in body else {"bones": [], "actions": []}
    report["moving_parts"] = [(b["bone"], b["motion"], b.get("label", "")) for b in parts["bones"]]
    report["clips"] = [a["name"] for a in parts["actions"]]

    rig = bpy.data.objects.get(body.get("anvil_rig") or "")
    if RIG:
        if parts["bones"] and rig is None:
            problems.append("ANVIL_RIG set but no armature was made")
        if rig is not None:
            report["bones"] = [b.name for b in rig.data.bones]
            unweighted = sum(1 for v in body.data.vertices if not any(g.weight > 0 for g in v.groups))
            if unweighted:
                problems.append("%d vertices carry no bone weight" % unweighted)
    glb = os.environ["ANVIL_EXPORT_PATH"]
    if os.path.exists(glb):
        with open(glb, "rb") as fh:
            fh.read(12)
            clen, _ = struct.unpack("<II", fh.read(8))
            g = json.loads(fh.read(clen))
        report["glb"] = {"nodes": [n.get("name") for n in g["nodes"]], "skins": len(g.get("skins", [])), "animations": [a.get("name") for a in g.get("animations", [])], "bytes": os.path.getsize(glb)}

    # --- renders --------------------------------------------------------------------------------
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.name != body.name:
            ob.hide_render = True
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1400, 900
    world = bpy.data.worlds.new("KitCheckWorld")
    scene.world = world
    bg = world.node_tree.nodes.get("Background") or world.node_tree.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.32, 0.34, 0.38, 1.0)
    scene.view_settings.view_transform = "AgX"
    center = (lo + hi) / 2
    span = max(size)
    k = (span / 0.9) ** 2
    for loc, energy, lsize, rot in ((Vector((0.5, -0.9, 0.9)), 60, 1.5, (0.95, 0.0, 0.45)), (Vector((-0.8, 0.7, 0.5)), 25, 2.5, (1.1, 0.0, -2.2)), (Vector((0.2, 0.8, 0.6)), 40, 1.0, (1.2, 0.0, 2.8))):
        data = bpy.data.lights.new("KitCheckLight", "AREA")
        data.energy, data.size = energy * k, lsize * span / 0.9
        light = bpy.data.objects.new("KitCheckLight", data)
        light.location = center + loc * (span / 0.9)
        light.rotation_euler = rot
        scene.collection.objects.link(light)
    cam_data = bpy.data.cameras.new("KitCheckCam")
    cam = bpy.data.objects.new("KitCheckCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam_data.lens = 50
    VIEWS = {"a": Vector((0.9, -1.4, 0.7)), "b": Vector((-1.1, 1.2, 0.55))}
    # frame the whole asset: back off far enough that its bounding sphere fits the narrower field of view
    radius = (size.length / 2) * 1.12
    fov_h = 2 * math.atan(cam_data.sensor_width / 2 / cam_data.lens)
    fov_v = 2 * math.atan((cam_data.sensor_width * scene.render.resolution_y / scene.render.resolution_x) / 2 / cam_data.lens)
    distance = radius / math.sin(min(fov_h, fov_v) / 2)

    def render(name, view="a"):
        cam.location = center + VIEWS[view].normalized() * distance
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(OUT, name + ".png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        return path

    report["renders"] = {"view-a": render("view-a", "a"), "view-b": render("view-b", "b")}

    if RIG and rig is not None and rig.animation_data:
        rest, _ = evaluated_vertices(body)
        moved = {}
        for track in rig.animation_data.nla_tracks:
            action = track.strips[0].action
            keys = next((a["keys"] for a in parts["actions"] if a["name"] == action.name), [(10, 1.0)])
            frame = max(keys, key=lambda kv: kv[1])[0]
            rig.animation_data.action = action
            if hasattr(rig.animation_data, "action_slot") and action.slots:
                rig.animation_data.action_slot = action.slots[0]
            scene.frame_set(int(frame))
            bpy.context.view_layer.update()
            posed, _ = evaluated_vertices(body)
            moved[action.name] = sum(1 for a, b in zip(rest, posed) if (a - b).length > 1e-4)
            report["renders"]["clip-" + action.name] = render("clip-" + action.name, "a")
            rig.animation_data.action = None
            scene.frame_set(1)
            for pb in rig.pose.bones:
                pb.location = (0.0, 0.0, 0.0)
                pb.rotation_euler = (0.0, 0.0, 0.0)
            bpy.context.view_layer.update()
        report["clip_vertices_moved"] = moved
        for name, count in moved.items():
            if count == 0:
                problems.append("clip %s moves no vertices" % name)

    if SURFACE:
        bake = open(base + ".bake.py", encoding="utf-8").read()
        bake = re.sub(r"^BAKE_SIZE = \d+", "BAKE_SIZE = %d" % SIZE, bake, flags=re.M)
        bake = re.sub(r"^BAKE_SAMPLES = \d+", "BAKE_SAMPLES = 8", bake, flags=re.M)
        ns2 = {"bpy": bpy, "result": None}
        t1 = time.time()
        exec(compile(bake, CASE + ".bake.py", "exec"), ns2, ns2)
        report["surfaced"] = {"result": str(ns2.get("result"))[:160], "seconds": round(time.time() - t1, 1)}
        if not str(ns2.get("result")).startswith("Surfaced"):
            problems.append("the bake did not surface: " + str(ns2.get("result"))[:200])
        scene.render.engine = "BLENDER_EEVEE"
        report["renders"]["surfaced-a"] = render("surfaced-a", "a")
        report["renders"]["surfaced-b"] = render("surfaced-b", "b")
    report["ok"] = not problems
except Exception:
    problems.append("EXCEPTION: " + traceback.format_exc()[-2500:])

with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=1)
print("KITCHECK", CASE, "OK" if report["ok"] else "FAIL", json.dumps({k: v for k, v in report.items() if k != "renders"})[:1500])
