# Milestone — 2026-09-14 — Playable jungle + Windows handoff

Honest bar: **prototype / open-in-Godot with real kits**, not AAA product exit.

## Closed this milestone

| Exit | Tip / evidence |
|------|----------------|
| Jungle kits ≥12 (13/13 shipGate) | `440be4b` … Quinn HOLD fixes `cdd5d21` + Kevin bake |
| Playable-jungle instance snap | `4b4ef3e` — 157 PackedScene kits, 0 `anvil_placeholder` |
| Relative `kits/` symlinks | `2765474` |
| Ori `forge_scene` PackedScene / `real_instances` | `ad612f5` |
| Shrub capsule → convex (catalog) | `0a058a7` |
| Windows `.env` DCC + inspector forged LOD | merge `e7cb2ff` ← `windows-env-and-inspector-lod` @ `7e28119` |

## Soft honesty still open

- Helper DirectionalLights / empty WorldEnvironment → **real lights pass in flight**
- Kit carbine ≠ CAD M4; TOOLS surface still fat; MCP HTTP cold transcript optional
- Not claiming Claude/Codex → AAA zero-babysit yet

## Smoke (re-run locally; GLBs gitignored)

```bash
npm run forge:scene -- --spec docs/schemas/examples/jungle-clearing.scene.json --json
```

Expect `ANVIL_SCENE_OK` + `godot_import.ok` when Godot is on PATH / in `.env`.

## Branch note

`windows-env-and-inspector-lod` merged into `main` (`.env.example`, `tools/load-env.mjs`, inspector LOD counts forged GLB). Safe to delete remote branch after push.
