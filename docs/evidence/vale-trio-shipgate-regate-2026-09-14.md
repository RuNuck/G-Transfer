# Vale HOLD — remade trio ship-gate re-run (2026-09-14)

Kevin remade GLBs copied onto box 13:16Z. Index hashes were stale vs disk.

## Commands (re-runnable)

```bash
node tools/validate/run.mjs \
  exports/forge/biome/jungle/fallen_log_a.glb \
  exports/forge/biome/jungle/tree_root_a.glb \
  exports/forge/biome/jungle/shrub_a.glb --json
# ok true, 3/3 passed, hardFails []

node tools/godot-check/check-import.mjs exports/forge/biome/jungle/fallen_log_a.glb
node tools/godot-check/check-import.mjs exports/forge/biome/jungle/tree_root_a.glb
node tools/godot-check/check-import.mjs exports/forge/biome/jungle/shrub_a.glb
# each: ok true, problems []

npm run forge:index
# then patchIndexShipGate ready on the three
```

## After patch (`exports/index.json` on box)

| file | bytes | hash (disk=index) | status | godotImportOk |
|---|---|---|---|---|
| fallen_log_a.glb | 124068 | `sha256:55f3bdc1…2eda6f3a` | ready | true |
| tree_root_a.glb | 230232 | `sha256:60b6a810…17cc88cb` | ready | true |
| shrub_a.glb | 374636 | `sha256:54926d74…e8a4f5cb39` | ready | true |

13/13 jungle entries ready. Godot 4.7.2. GLBs gitignored; index is local box state.

Visual-only sizes from this godot-check (Quinn already CLEARED): log 2.800×0.417×0.427; root 2.028×0.686×2.132; shrub 1.534×1.056×1.414.
