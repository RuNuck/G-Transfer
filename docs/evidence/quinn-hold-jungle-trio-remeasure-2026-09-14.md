# Quinn HOLD re-measure — Kevin trio bake (2026-09-14)

Authoring `cdd5d21`. Kevin baked on his machine (G-Transfer clone). GLBs gitignored.

| Piece | Job | AABB (m) | Col type (Blender log) | vs HOLD |
|---|---|---|---|---|
| `fallen_log_a` | `job_20260914130915_9b55ad` | **2.800 × 0.426 × 0.427** | convex `*-convcolonly` | was 2.81×2.81 XZ pad around ~0.43m log — **XZ now matches visual ~0.43m** |
| `tree_root_a` | `job_20260914130925_22ae18` | 2.057 × **0.690** × 2.132 | convex | spec 0.70m; was 0.39m (−44%) — **now −1.4%** |
| `shrub_a` | `job_20260914130935_6f3a9a` | **1.544 × 1.066 × 1.544** | capsule (catalog still capsule) | spec 1.4×1.4; was 1.15×0.97 — **now +10% over 1.4** (not short) |

All three: `status=published`, `hardFails=[]`, Godot import ok, `shipGate=ready`, PBR maps resolve.

Caveat: combined AABB includes col mesh. Log col is convex (not capsule). Shrub col still capsule in kit catalog — footprint is visual AABB.

Also attached (unrelated): lantern smoke `job_20260914125156_2d24e3` AABB 0.190×0.370×0.190 — not part of this HOLD.
