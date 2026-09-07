"""Run an Anvil build (+ optional bake) script headlessly.

  blender --background --python tools/forge-run/headless-run.py -- build.py [bake.py]

Env:
  ANVIL_KIT_DIR       parent of anvil_blender_addon (enables part kit)
  ANVIL_EXPORT_PATH   GLB output path (also used by bake re-export)
  ANVIL_TEXTURE_DIR   bake PNG output folder
  ANVIL_RIG           set 1/true to rig kit moving parts
  ANVIL_NO_ADDON      set to force blockout path
"""
import os
import sys
import traceback

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
if not argv:
    print("usage: blender --background --python headless-run.py -- build.py [bake.py]", flush=True)
    sys.exit(2)

build_path = os.path.abspath(argv[0])
bake_path = os.path.abspath(argv[1]) if len(argv) > 1 else None

kit_dir = os.environ.get("ANVIL_KIT_DIR")
for _name in [n for n in list(sys.modules) if n == "anvil_blender_addon" or n.startswith("anvil_blender_addon.")]:
    del sys.modules[_name]
if os.environ.get("ANVIL_NO_ADDON"):
    sys.modules["anvil_blender_addon"] = None
elif kit_dir:
    sys.path.insert(0, kit_dir)
    print("ANVIL_KIT_DIR=", kit_dir, flush=True)

bpy.ops.wm.read_homefile(use_empty=True)

def run_py(path):
    ns = {"bpy": bpy, "result": None}
    code = open(path, encoding="utf-8").read()
    exec(compile(code, path, "exec"), ns, ns)
    return ns.get("result")

try:
    print("ANVIL_HEADLESS build", build_path, flush=True)
    build_result = run_py(build_path)
    print("ANVIL_BUILD_RESULT", build_result, flush=True)
    bake_result = None
    if bake_path:
        print("ANVIL_HEADLESS bake", bake_path, flush=True)
        bake_result = run_py(bake_path)
        print("ANVIL_BAKE_RESULT", bake_result, flush=True)
    export = os.environ.get("ANVIL_EXPORT_PATH", "")
    if export and os.path.exists(export):
        print("ANVIL_EXPORT_OK", export, os.path.getsize(export), flush=True)
    else:
        print("ANVIL_EXPORT_MISSING", export, flush=True)
        sys.exit(1)
except Exception:
    traceback.print_exc()
    sys.exit(1)
