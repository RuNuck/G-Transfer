# Anvil overnight status Phase 0
When: 2026-09-06 22:28 ET
Scope: workspace project only
Baseline: 2.9.0
Done: artifact gates, forge-index, version align, REVIEW banner, reports
Gate results: PASS 5/5 on exports/forge
- closed_great_helm PASS
- iron_banded_oak_loot_chest PASS
- kerosene_lantern PASS
- sci_fi_hover_bike PASS
- us_ammo_can PASS
Checks: typecheck pass; stdio protocol pass; Godot not installed
Limits: GLB JSON heuristics only; no batch forge CLI; no 2-light proof
Remaining: batch forge, index ready status, fixtures, README
Next: Phase 1 jobs MCP and ready-after-gates

## Details

Hard gates: file exists, .glb, readable glTF-2 JSON, meshes, materials, nodes, Godot collision suffixes (-col/-convcol/-colonly/-convcolonly), clips when path suggests rigged.
Soft: skins without clips, Unreal collision leftovers, exported _LOD* siblings, AABB from POSITION min/max.
Index schemaVersion 1; entries include file, mesh, bytes, modified, folderHint, sha256.
Per-asset clips: helm raise_visor; chest open/unhasp; ammo open/unlatch/lift; lantern and hoverbike static.
Report file: exports/forge/godot-prod-report.json

## Remaining Phase 0 checklist

- Batch forge CLI for N catalog kinds
- Wire gate status into index.json (ready only after gates)
- Broken pivot/scale fixtures that fail closed
- 2-light proof notes
- README pointer at index + gates
- Exit criteria: 10 kinds batch-forged, godot-check green
