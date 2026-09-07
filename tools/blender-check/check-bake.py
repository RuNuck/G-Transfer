"""Run the build script then the bake script for a case at a small size and verify the outputs.

blender --background --python tools/blender-check/check-bake.py -- tools/blender-check/out/gen <case> tools/blender-check/out/bake-<case>.json

With ANVIL_KIT_DIR set to the folder that contains the anvil_blender_addon package (public/downloads)
the add-on's surfacing runs and is checked; without it the generated script's plain bake is checked.
"""
import json
import os
import re
import sys
import traceback

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1 :]
GEN, CASE, REPORT = argv
KIT_DIR = os.environ.get("ANVIL_KIT_DIR")
NO_ADDON = bool(os.environ.get("ANVIL_NO_ADDON"))  # exercise the plain bake even where the add-on is installed
for _name in [n for n in list(sys.modules) if n == "anvil_blender_addon" or n.startswith("anvil_blender_addon.")]:
    del sys.modules[_name]
if NO_ADDON:
    sys.modules["anvil_blender_addon"] = None
elif KIT_DIR:
    sys.path.insert(0, KIT_DIR)
SIZE = 128
base = os.path.join(GEN, CASE)
meta = json.load(open(base + ".json", encoding="utf-8"))
mesh, textures, spec = meta["mesh"], meta["textures"], meta["spec"]
tex_dir = os.path.join(GEN, "textures", CASE)
os.environ["ANVIL_TEXTURE_DIR"] = tex_dir
os.environ.pop("ANVIL_EXPORT_PATH", None)

report = {"case": CASE, "ok": False, "problems": [], "kit_dir": bool(KIT_DIR)}


def pixels(img):
    buf = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    return buf.reshape(-1, 4)


try:
    bpy.ops.wm.read_homefile(use_empty=True)
    build = open(base + ".py", encoding="utf-8").read()
    bake = open(base + ".bake.py", encoding="utf-8").read()
    bake = re.sub(r"^BAKE_SIZE = \d+", "BAKE_SIZE = %d" % SIZE, bake, flags=re.M)
    bake = re.sub(r"^BAKE_SAMPLES = \d+", "BAKE_SAMPLES = 4", bake, flags=re.M)
    ns = {"bpy": bpy, "result": None}
    exec(compile(build, CASE + ".py", "exec"), ns, ns)
    body = bpy.data.objects[mesh]
    mats_before = [m.name for m in body.data.materials]
    nodes_before = {m.name: len(m.node_tree.nodes) for m in body.data.materials}
    engine_before = bpy.context.scene.render.engine

    ns2 = {"bpy": bpy, "result": None}
    exec(compile(bake, CASE + ".bake.py", "exec"), ns2, ns2)
    problems = report["problems"]
    result = ns2.get("result")
    surfaced = isinstance(result, str) and result.startswith("Surfaced")
    report["surfaced"] = surfaced
    if KIT_DIR and not surfaced:
        problems.append("kit dir set but the bake did not surface: " + str(result)[:200])
    if NO_ADDON and surfaced:
        problems.append("ANVIL_NO_ADDON set but the bake surfaced")

    for key in ("normal", "packed", "albedo"):
        path = os.path.join(tex_dir, textures[key] + ".png")
        if not os.path.exists(path) or os.path.getsize(path) < 100:
            problems.append(f"{key} png missing: {path}")
    n_img = bpy.data.images.get(textures["normal"])
    p_img = bpy.data.images.get(textures["packed"])
    a_img = bpy.data.images.get(textures["albedo"])
    if n_img is None or p_img is None or a_img is None:
        problems.append("images missing in bpy.data")
    else:
        if n_img.colorspace_settings.name != "Non-Color":
            problems.append(f"normal colorspace {n_img.colorspace_settings.name}")
        if p_img.colorspace_settings.name != "Non-Color":
            problems.append(f"packed colorspace {p_img.colorspace_settings.name}")
        if a_img.colorspace_settings.name == "Non-Color":
            problems.append("albedo colorspace is Non-Color")
        if tuple(n_img.size) != (SIZE, SIZE):
            problems.append(f"normal size {tuple(n_img.size)}")
        n = pixels(n_img)
        report["normal_mean"] = [round(float(v), 3) for v in n[:, :3].mean(axis=0)]
        report["normal_std"] = [round(float(v), 4) for v in n[:, :3].std(axis=0)]
        if not (0.4 < n[:, 2].mean() < 1.01):
            problems.append(f"normal map blue channel mean {n[:, 2].mean():.3f} (expected ~1 for tangent space)")
        if float(n[:, :2].std()) < 0.003:
            problems.append(f"normal map is flat (std {float(n[:, :2].std()):.5f})")
        p = pixels(p_img)
        report["packed_mean"] = [round(float(v), 3) for v in p.mean(axis=0)]
        rough = spec["materials"][0]["roughness"]
        metal = spec["materials"][0]["metalness"]
        if spec["engine"] == "unity":
            ao, rough_ch, metal_ch = p[:, 1], 1.0 - p[:, 3], p[:, 0]
        else:
            ao, rough_ch, metal_ch = p[:, 0], p[:, 1], p[:, 2]
        # The bake pre-fills each map with a neutral instead of clearing to black, so a texel's
        # value no longer says whether it is inside an island: measure atlas use from the UVs.
        uv_layer = body.data.uv_layers[0].data
        uv_used = 0.0
        for poly in body.data.polygons:
            pts = [uv_layer[i].uv for i in poly.loop_indices]
            acc = 0.0
            for i in range(len(pts)):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % len(pts)]
                acc += x1 * y2 - x2 * y1
            uv_used += abs(acc) / 2
        covered = np.ones(ao.shape, dtype=bool)
        report["coverage"] = round(float(uv_used), 3)
        report["ao_mean"] = round(float(ao.mean()), 3)
        if float(ao.mean()) < 0.2:
            problems.append(f"AO nearly black (mean {report['ao_mean']})")
        if uv_used < 0.25:
            problems.append(f"UV atlas use only {report['coverage']}")
        a = pixels(a_img)
        report["albedo_mean"] = [round(float(v), 3) for v in a[covered, :3].mean(axis=0)] if covered.any() else None
        if surfaced:
            report["rough_mean"] = round(float(rough_ch[covered].mean()), 3)
            report["metal_mean"] = round(float(metal_ch[covered].mean()), 3)
            # expected channel means weighted by the surface area each material slot covers
            areas = {}
            for poly in body.data.polygons:
                areas[poly.material_index] = areas.get(poly.material_index, 0.0) + poly.area
            total = sum(areas.values()) or 1.0
            expect_rough = sum(a * spec["materials"][min(i, len(spec["materials"]) - 1)]["roughness"] for i, a in areas.items()) / total
            expect_metal = sum(a * spec["materials"][min(i, len(spec["materials"]) - 1)]["metalness"] for i, a in areas.items()) / total
            report["expected"] = {"roughness": round(expect_rough, 3), "metalness": round(expect_metal, 3)}
            if float(rough_ch[covered].std()) < 0.01:
                problems.append("surfaced roughness is flat")
            if abs(report["rough_mean"] - expect_rough) > 0.35:
                problems.append(f"surfaced roughness mean {report['rough_mean']} far from the spec's {expect_rough:.2f}")
            if abs(report["metal_mean"] - expect_metal) > 0.35:
                problems.append(f"surfaced metallic mean {report['metal_mean']} far from the spec's {expect_metal:.2f}")
            if float(a[covered, :3].std()) < 0.005:
                problems.append("surfaced albedo is flat")
            for suffix in ("_AO", "_Edge"):
                path = os.path.join(tex_dir, "maps", mesh + suffix + ".png")
                if not os.path.exists(path):
                    problems.append("mesh map missing: " + path)
        else:
            if spec["engine"] == "unity":
                if abs(p[:, 0].mean() - metal) > 0.02:
                    problems.append("unity mask R != metallic")
                if abs(p[:, 3].mean() - (1 - rough)) > 0.02:
                    problems.append("unity mask A != smoothness")
            else:
                if abs(p[:, 1].mean() - rough) > 0.02:
                    problems.append("ORM G != roughness")
                if abs(p[:, 2].mean() - metal) > 0.02:
                    problems.append("ORM B != metallic")

    if "HP_" + mesh in bpy.data.objects:
        problems.append("high-poly copy not removed")
    if [m.name for m in body.data.materials] != mats_before:
        problems.append("materials changed by bake")
    if surfaced:
        for m in body.data.materials:
            images = {n.image.name for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeTexImage" and n.image}
            if not {textures["normal"], textures["packed"], textures["albedo"]} <= images:
                problems.append(f"{m.name} not wired to the baked textures: {sorted(images)}")
            if not m.get("anvil_surfaced"):
                problems.append(f"{m.name} lacks anvil_surfaced")
            recipe = bpy.data.materials.get(m.name + "_recipe")
            if recipe is None or not recipe.get("anvil_recipe"):
                problems.append(f"recipe material for {m.name} missing")
        if any(m.name.startswith("Anvil_meshmaps_") for m in bpy.data.materials):
            problems.append("mesh-map material left behind")
        if any(i.name in ("Anvil_rough_temp", "Anvil_metal_temp") for i in bpy.data.images):
            problems.append("temporary bake images left behind")
        report["recipes"] = {m.name: m.get("anvil_recipe") for m in bpy.data.materials if m.name.endswith("_recipe")}
    else:
        for m in body.data.materials:
            if len(m.node_tree.nodes) != nodes_before[m.name]:
                problems.append(f"bake target node left in {m.name}")
    if bpy.context.scene.render.engine != engine_before:
        problems.append(f"render engine left as {bpy.context.scene.render.engine}")
    if not isinstance(result, str) or ("Baked" not in result and "Surfaced" not in result):
        problems.append(f"result not set: {result!r}")
    report["result"] = result
    report["ok"] = not problems
except Exception:
    report["problems"].append("EXCEPTION: " + traceback.format_exc()[-2000:])

with open(REPORT, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=1)
print("BAKE", CASE, "OK" if report["ok"] else "FAIL", json.dumps(report)[:1500])
