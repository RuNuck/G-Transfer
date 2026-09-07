# DCC setup (Blender + Godot) — agent box

Installed **Mon Sep 7, 2026 ~7:48am ET** on the Anvil forge Linux box (official binaries under `/home/box/tools`; `/opt` and `/usr/local/bin` not writable by `box`).

## Versions

| Tool | Version | Install path | PATH symlink |
|---|---|---|---|
| **Blender** | **5.2.1 LTS** (`9e2066aef7ef`, 2026-08-25) | `/home/box/tools/blender-5.2.1-linux-x64/blender` | `/home/box/.local/bin/blender` |
| **Godot** | **4.7.2.stable.official** (`ed1daf0bf`) | `/home/box/tools/godot-4.7.2/Godot_v4.7.2-stable_linux.x86_64` | `/home/box/.local/bin/godot` and `godot4` |

Disk used (approx): Blender tree **~1.2 GiB**, Godot binary **~140 MiB**.

## Environment hints

```bash
export PATH="$HOME/.local/bin:$PATH"
export ANVIL_GODOT="/home/box/tools/godot-4.7.2/Godot_v4.7.2-stable_linux.x86_64"
export ANVIL_BLENDER="/home/box/tools/blender-5.2.1-linux-x64/blender"
```

These are also appended to `/home/box/.bashrc`. New login shells pick up `~/.local/bin` via `~/.profile` as well. Non-login agent shells should `export PATH="$HOME/.local/bin:$PATH"` (or source bashrc) before calling `blender` / `godot`.

## Verify

```bash
which blender; blender --version
which godot || which godot4; godot --version
blender --background --python-expr "import bpy; print(bpy.app.version_string)"
# Godot import smoke (from repo root):
node tools/godot-check/check-import.mjs exports/forge
```

## Sources

- Blender: `https://download.blender.org/release/Blender5.2/blender-5.2.1-linux-x64.tar.xz`
- Godot: `https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_linux.x86_64.zip`

Chose **Blender 5.2.1 LTS** (stable 5.x) over 4.2 LTS (support window ended mid-2026). Godot is official non-.NET Linux x86_64 zip (no AppImage needed).

## Notes for Anvil forge

- Headless Blender: `blender --background …`
- Headless Godot: `godot --headless …` (also what `check-import.mjs` drives)
- Point MCP / forge workers at `ANVIL_BLENDER` / `ANVIL_GODOT` absolute paths above when `PATH` may not include `~/.local/bin`.


## Real forge smoke (Mon Sep 7, 2026 ~8:00am DT)

Headless kit forge is wired. Prefer absolute `ANVIL_*` paths when agent shells omit `~/.local/bin`.

```bash
export PATH="$HOME/.local/bin:$PATH"
export ANVIL_BLENDERT="/home/box/tools/blender-5.2.1-linux-x64/blender"
export ANVIL_GODOT="/home/box/tools/godot-4.7.2/Godot_v4.7.2-stable_linux.x86_64"
# parent of anvil_blender_addon package (part kit + surfacing):
export ANVIL_KIT_DIR="$PWD/public/downloads"

npm run dcc:smoke          # lantern part-kit build → validate ⁊ Godot import
npm run dcc:smoke:bake      # same + procedural bake (~40s, writes textures/)
npm run forge:run -- --kind lantern --engine godot --bake --json
npm run forge:emit -- --kind crate --engine godot
```

### What passed on this box

| Step | Result |
|---|----|
| Blender 5.2.1 `--background` + `ANVIL_KIT_DIR=public/downloads` | **part kit** lantern (`oil_lantern`) |
| Export | `exports/forge-smoke/oil_lantern.glb` |
| Bake (optional) | 2048px brass/glass/generic → `exports/forge-smoke/textures/tex_oil_lantern_{albedo,normal,orm}.png`; re-exported GLB ~6.2 MiB |
| `npm run validate` | `godot_prod` hardFails `[]` |
| `node tools/godot-check/check-import.mjs` | `ok: true`, Godot 4.7.2; with bake, albedo/normal/orm textures bind on all 3 mats |

### Still stubbed / gaps

- `forge_run_asset` **MCP** over HTTP with only `{file}` still validates an existing GLB (does not invent a mesh from a brief alone). Use CLI `--kind` / `dcc:smoke` for real builds.
- Full catalog regression (`tools/blender-check/check-build.py` over every kind×engine) not re-run as overnight smoke.
- Scene compose / jungle kits and `forge_weapon` remain scaffold.
- Interactive anvil-blender TCP add-on bridge not required for headless forge.
