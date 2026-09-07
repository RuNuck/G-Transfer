# Validate fixtures (godot_prod)

Intentionally broken / complete GLBs so artifact gates stay fail-closed.

Harnesses (npm script validate:fixtures):

- expect-fail.mjs -- runs validate on fail/; expects nonzero exit; each gate below must hard-fail >=3 times.
- expect-pass.mjs -- runs validate on pass/; expects exit 0; each gate below must hard-pass >=1 time.

Rebuild synthetics: node tools/validate/fixtures/build-fixtures.mjs

Hard gates under bar:

- meters_bounds FAIL: bad-scale.glb, tiny-scale.glb, no-position-minmax.glb | PASS: prop-meters-ok.glb
- pbr_textures_resolve FAIL: no-textures-pbr.glb, pbr-extras-only.glb, pbr-missing-image.glb | PASS: pbr-resolve-ok.glb
- pivot_weapon_or_rigged FAIL: weapon-missing-pivot.glb (mandatory), pistol-far-root.glb, shotgun-no-grip.glb | PASS: rifle-grip-ok.glb

Other fail fixtures:

- malformed-not-glb.glb -- bad magic / not glTF-2
- no-collision-minimal.glb -- no Godot collision suffix

Notes:

- Missing POSITION min/max is a hard meters_bounds fail for ALL kinds (props included).
- weapon-missing-pivot.glb: weapon-named asset, far root, no grip/hand_socket.
