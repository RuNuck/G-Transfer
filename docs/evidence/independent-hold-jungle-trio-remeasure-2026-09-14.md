# Independent HOLD re-measure — jungle trio (2026-09-14)

Anti-rubber-stamp. Measured from GLB BIN POSITION (world), **visual vs col separated**. Do not use combined AABB for HOLD geometry.

## Files verified

| File | bytes | mtime UTC |
|---|---|---|
| `fallen_log_a.glb` | 124068 | 2026-09-14T13:16:52.023Z |
| `tree_root_a.glb` | 230232 | 2026-09-14T13:16:52.027Z |
| `shrub_a.glb` | 374636 | 2026-09-14T13:16:52.027Z |

## Verdict: **CLEAR** (trio hard blockers fixed → lift HOLD for these three)

### 1. fallen_log_a — PASS (col no longer ~6× / square pad)

| | X | Y | Z |
|---|---|---|---|
| **visual AABB** | **2.800** | 0.417 | **0.428** |
| **col AABB** | **2.800** | 0.426 | **0.428** |
| combined (Bill-style) | 2.800 | 0.426 | 0.428 |

- colZ / visualZ = **1.00** (was ~6×)
- col is elongated along X matching log; **not** 2.81×2.81 XZ square
- node: `fallen_log_a_col-convcolonly`; hull unique verts **18** (≤32); visual tris **124**

### 2. tree_root_a — PASS (visual height within ~3%)

| | value |
|---|---|
| **visual height** | **0.686 m** |
| spec | 0.70 m |
| error | **−2.0% / −14 mm** |
| col height | 0.690 m |
| combined (Bill) | 0.690 m (−1.4%) |

Tol ~3% of 0.70 ≈ 21 mm (6 mm is tighter absolute; 14 mm still inside 3% band). Prior fail was 0.39 (−44%).

### 3. shrub_a — PASS (visual XZ not short of 1.4×1.4)

| | X | Z |
|---|---|---|
| **visual XZ** | **1.534** | **1.414** |
| spec | 1.4 | 1.4 |
| vs spec | +9.6% | +1.0% |
| combined/col (Bill) | 1.544 | 1.544 |

Slight over OK; neither axis short. Prior fail 1.15×0.97.

## Quick gates (all three)

| Check | fallen_log | tree_root | shrub |
|---|---|---|---|
| tris (visual) ≤5k | 124 | 116 | 504 |
| hull unique ≤32 pref | 18 | 18 | 16 |
| Godot `-col` / `-convcolonly` | yes | yes | yes |
| meters + bottom pivot (minY≈0) | yes | yes | yes |
| `validate` hardFails | [] | [] | [] |

## Soft nits (not trio HOLD blockers)

- `shrub_a` catalog still lists `collision: "capsule"`; GLB ships convex `-convcolonly`.
- Bill/Quinn prior table used **combined** AABB (col inflates shrub XZ and tree_root Y slightly). Visual-separated numbers above are authoritative for HOLD geometry.
- Full jungle set soft nits outside this trio not re-audited here.
