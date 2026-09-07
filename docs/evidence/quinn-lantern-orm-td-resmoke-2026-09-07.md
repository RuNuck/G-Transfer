# Quinn lantern ORM metallic + TD resmoke (2026-09-07)

Quinn RE-VETOED `88102bb` / `exports/forge-smoke/oil_lantern.glb`:
1. ORM metallic (B) on brass still plateaued ~B≈204 (~0.80) — factor-only binary insufficient
2. Measured TD ≈2691 px/m on 2048² (env target ~512 / mid ~1024)

## Fixes
- **Surfacing recipes** (`public/downloads/anvil_blender_addon/surfacing/__init__.py`):
  - brass / blued_steel / bare_steel → hard `metal = 1.0` (dirt/wear stay on albedo+roughness)
  - painted_steel → wear chips `0→1` only (AA fringe OK); no paint mid-metal 0.25
  - generic → binary `1.0 if metallic>=0.5 else 0.0`
  - metal bake fill → `(0,0,0)` (not slot-mean ~0.33 empty-UV plateau)
  - `pack()` snaps mid-gray metallic plateaus `(0.12,0.88)` to 0|1; keeps thin AA fringe
- **TD / bake size**:
  - lantern catalog `texelDensity` 1024 → **512** (env prop)
  - `atlasSize()` now dimension-aware: `TD × maxDim` snapped to 512/1024/2048
    - lantern: `512 × 0.36 ≈ 184` → **512²** bake (was 2048²)

## Commands
```bash
node tools/forge-run/run-asset.mjs --kind lantern --engine godot --bake --out-dir exports/forge-smoke --json
node tools/validate/run.mjs --profile godot_prod exports/forge-smoke/oil_lantern.glb --json
node tools/godot-check/check-import.mjs exports/forge-smoke/oil_lantern.glb
```

## Results
| Item | Value |
|------|-------|
| GLB | `/workspace/project/exports/forge-smoke/oil_lantern.glb` |
| bytes | 717344 |
| job | `job_20260907133827_501189` |
| bake | **512px** surfaced (`mat_brass=brass`, `mat_glass=glass`, `mat_flame=generic`) |
| images.length | 3 |
| mat_brass metallicFactor | 1 (metallic encoded in ORM B) |
| collision tris | 28 (≤32) |
| LOD0 tris | 2856 |
| pivot / meters | bottom / ~0.19×0.37×0.19 m |
| validate godot_prod | **ok** (passed 1 / failed 0) |
| godot-check import | **ok** (Godot 4.7.2, problems []) |

### ORM B histogram (brass islands / whole map)
PNG `tex_oil_lantern_orm.png` 512²:
- **B=255** ≈ 60.9%
- **B=0** ≈ 39.0%
- mid 160–230 (old ~0.80 plateau): **0.01%** (was ~21% / B=204 dominant)
- plateaus >1% in B∈[40,220]: **none**
- AA fringe only (~0.1%)

Glass/flame islands + empty UV → metallic **0**; brass → **255**.

### Texel density
- Prior Quinn measure: **≈2691 px/m** at 2048²
- Scaled estimate at 512²: **≈673 px/m** (near env ~512; under mid ~1024)
- Declared catalog TD: **512 px/m**; atlas **512**

## Success criteria
- [x] New GLB at smoke path
- [x] ORM B brass ~0/255 only (no ~0.80 plateau)
- [x] Glass/flame metallic 0 in ORM B
- [x] TD near env/mid (~512–1024)
- [x] validate + godot-check green
- [x] Evidence written
