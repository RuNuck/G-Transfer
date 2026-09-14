# Quinn soft nits after CLEAR (376103d) — 2026-09-14 ET

**Box:** `/workspace/project` (Bill)

1. **Index ready honesty:** `finishPublished` re-applies shipGate from published jobs after index rebuild and fails closed if the mesh entry is not `ready` when shipGate is ready (no soft `validated_glb_only` claim). `forge-index` preserves prior shipGate ready/blocked across bare rebuilds.
2. **WeaponGraph pivot:** `docs/schemas/examples/m4-carbine.weapon.json` (+ schema example) `pivot.localTranslation` updated from inject scaffold `[0,-0.02,0.01]` to kit Empty grip `[-0.128,-0.052,0]`.

`check:weapon-graph` OK.
