"""Host the real Anvil add-on inside headless Blender for an end-to-end test.

Background Blender never runs bpy.app.timers, so this drives the add-on's _drain() from the main
thread every 50 ms, which is exactly what the registered timer does in a GUI session.

blender --background --python addon_host.py -- <addon.py> <stop_file> <max_seconds>
"""
import os
import sys
import time

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
ADDON, STOP, MAX = argv[0], argv[1], float(argv[2])

# ADDON is the add-on package directory (or a file inside it); import it by name like Blender does.
package_dir = ADDON if os.path.isdir(ADDON) else os.path.dirname(ADDON)
sys.path.insert(0, os.path.dirname(os.path.abspath(package_dir)))
import anvil_blender_addon as mod  # noqa: E402

mod.start_server()
print("ADDON_HOST listening", mod.STATE.status, flush=True)

deadline = time.time() + MAX
while time.time() < deadline and not os.path.exists(STOP):
    mod._drain()
    time.sleep(0.05)
mod.stop_server()
print("ADDON_HOST stopped", flush=True)
