# Validate failure fixtures

Intentionally broken / incomplete GLBs so artifact gates stay fail-closed.

| File | Fault |
|---|---|
| malformed-not-glb.glb | Bad magic / not glTF-2 |
| no-collision-minimal.glb | Valid minimal GLB JSON, but no Godot collision suffix |

Harness: node tools/validate/fixtures/expect-fail.mjs (package script validate:fixtures).
