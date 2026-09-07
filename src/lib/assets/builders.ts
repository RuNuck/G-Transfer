import * as THREE from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { collisionName, materialName, meshName } from "./naming";
import { makeStandard } from "./textures";
import type { AssetSpec, LodLevel } from "./types";

function segs(lod: LodLevel, hi: number, mid: number, lo: number) {
  return lod === 0 ? hi : lod === 1 ? mid : lo;
}

function add(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  rot: [number, number, number] = [0, 0, 0],
  scale?: [number, number, number],
) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  if (scale) mesh.scale.set(...scale);
  group.add(mesh);
  return mesh;
}

function mats(spec: AssetSpec) {
  const seed = spec.seed;
  const primary = spec.materials.find((m) => m.slot === "primary") ?? spec.materials[0];
  const trim = spec.materials.find((m) => m.slot === "trim") ?? primary;
  const secondary = spec.materials.find((m) => m.slot === "secondary") ?? trim;
  const emit = spec.materials.find((m) => m.slot === "emissive");
  const glass = spec.materials.find((m) => m.slot === "glass");
  const kindFor = (slot: string) => {
    if (spec.kind === "crate" || spec.kind === "chest") return slot === "primary" ? "wood" : "metal";
    if (spec.kind === "barrel" || spec.kind === "ammo_can") return "paint";
    if (spec.category === "architecture") return "stone";
    if (spec.category === "weapons") return slot === "secondary" ? "paint" : "gun";
    return "sci";
  };
  const p = makeStandard({
    color: primary.albedo,
    roughness: primary.roughness,
    metalness: primary.metalness,
    kind: kindFor("primary"),
    seed,
  });
  const t = makeStandard({
    color: trim.albedo,
    roughness: trim.roughness,
    metalness: trim.metalness,
    kind: "metal",
    seed: seed + 3,
  });
  const s = makeStandard({
    color: secondary.albedo,
    roughness: secondary.roughness,
    metalness: secondary.metalness,
    kind: kindFor("secondary"),
    seed: seed + 7,
  });
  const e = emit
    ? makeStandard({
        color: emit.albedo,
        roughness: 0.4,
        metalness: 0.2,
        kind: "sci",
        seed,
        emissive: emit.emissive ?? emit.albedo,
        emissiveIntensity: emit.emissiveIntensity ?? 1.6,
      })
    : t;
  const g = glass
    ? makeStandard({
        color: glass.albedo,
        roughness: 0.08,
        metalness: 0,
        kind: "sci",
        seed,
        transparent: true,
        opacity: 0.45,
        emissive: glass.emissive,
        emissiveIntensity: glass.emissiveIntensity,
      })
    : p;
  // Engine-style material names, so the GLB matches the Inspector, QC and Blender script.
  p.name = materialName(spec, primary.name);
  t.name = materialName(spec, trim.name);
  s.name = materialName(spec, secondary.name);
  if (emit) e.name = materialName(spec, emit.name);
  if (glass) g.name = materialName(spec, glass.name);
  return { p, t, s, e, g };
}

function crate(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t } = mats(spec);
  const s = segs(lod, 3, 1, 0);
  add(g, new RoundedBoxGeometry(1, 1, 1, s, 0.04), p, [0, 0.5, 0]);
  if (lod < 2) {
    add(g, new THREE.BoxGeometry(1.02, 0.08, 1.02), t, [0, 0.18, 0]);
    add(g, new THREE.BoxGeometry(1.02, 0.08, 1.02), t, [0, 0.82, 0]);
    for (const y of [0.08, 0.92]) {
      for (const x of [-0.46, 0.46]) {
        for (const z of [-0.46, 0.46]) {
          add(g, new THREE.BoxGeometry(0.1, 0.16, 0.1), t, [x, y, z]);
        }
      }
    }
  }
  if (lod === 0) {
    for (const z of [-0.51, 0.51]) {
      add(g, new THREE.BoxGeometry(0.28, 0.18, 0.04), t, [0, 0.5, z]);
    }
  }
  return g;
}

function sciCrate(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t, e } = mats(spec);
  const s = segs(lod, 4, 2, 0);
  add(g, new RoundedBoxGeometry(0.8, 0.7, 0.8, s, 0.045), p, [0, 0.35, 0]);
  if (lod < 2) {
    add(g, new RoundedBoxGeometry(0.62, 0.08, 0.62, 2, 0.02), t, [0, 0.72, 0]);
    add(g, new THREE.BoxGeometry(0.8, 0.06, 0.06), e, [0, 0.35, 0.41]);
    add(g, new THREE.BoxGeometry(0.18, 0.1, 0.04), e, [0.22, 0.55, 0.41]);
  }
  if (lod === 0) {
    for (const x of [-0.38, 0.38]) {
      add(g, new THREE.BoxGeometry(0.08, 0.62, 0.08), t, [x, 0.35, 0.38]);
      add(g, new THREE.BoxGeometry(0.08, 0.62, 0.08), t, [x, 0.35, -0.38]);
    }
    add(g, new THREE.BoxGeometry(0.36, 0.04, 0.12), t, [0, 0.74, 0.28]);
  }
  return g;
}

function barrel(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t } = mats(spec);
  const n = segs(lod, 24, 12, 8);
  add(g, new THREE.CylinderGeometry(0.3, 0.3, 0.88, n, 1, false), p, [0, 0.44, 0]);
  if (lod < 2) {
    add(g, new THREE.TorusGeometry(0.3, 0.025, 8, n), t, [0, 0.16, 0], [Math.PI / 2, 0, 0]);
    add(g, new THREE.TorusGeometry(0.3, 0.025, 8, n), t, [0, 0.72, 0], [Math.PI / 2, 0, 0]);
  }
  if (lod === 0) {
    add(g, new THREE.CylinderGeometry(0.31, 0.31, 0.04, n), t, [0, 0.86, 0]);
    add(g, new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), t, [0.12, 0.89, 0]);
  }
  return g;
}

function chest(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t } = mats(spec);
  const s = segs(lod, 3, 1, 0);
  add(g, new RoundedBoxGeometry(1.1, 0.42, 0.7, s, 0.04), p, [0, 0.21, 0]);
  add(g, new THREE.CylinderGeometry(0.35, 0.35, 1.1, segs(lod, 16, 10, 6), 1, false, 0, Math.PI), p, [0, 0.42, 0], [0, 0, Math.PI / 2]);
  if (lod < 2) {
    add(g, new THREE.BoxGeometry(0.08, 0.7, 0.72), t, [-0.5, 0.32, 0]);
    add(g, new THREE.BoxGeometry(0.08, 0.7, 0.72), t, [0.5, 0.32, 0]);
    add(g, new THREE.BoxGeometry(0.16, 0.12, 0.06), t, [0, 0.32, 0.36]);
  }
  return g;
}

function ammoCan(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t } = mats(spec);
  add(g, new RoundedBoxGeometry(0.28, 0.2, 0.18, segs(lod, 2, 1, 0), 0.012), p, [0, 0.1, 0]);
  if (lod < 2) {
    add(g, new THREE.TorusGeometry(0.07, 0.008, 6, 12), t, [0, 0.22, 0], [Math.PI / 2, 0, 0]);
    add(g, new THREE.BoxGeometry(0.08, 0.03, 0.04), t, [0.1, 0.18, 0.09]);
  }
  return g;
}

function sword(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t, s } = mats(spec);
  const blade = new THREE.BoxGeometry(0.04, 0.78, 0.012);
  blade.translate(0, 0.52, 0);
  add(g, blade, p, [0, 0, 0]);
  if (lod === 0) {
    const fuller = new THREE.BoxGeometry(0.008, 0.62, 0.014);
    fuller.translate(0, 0.5, 0);
    add(g, fuller, t, [0, 0, 0]);
  }
  add(g, new THREE.BoxGeometry(0.18, 0.03, 0.04), t, [0, 0.12, 0]);
  add(g, new THREE.CylinderGeometry(0.018, 0.02, 0.14, segs(lod, 10, 6, 5)), s, [0, 0.04, 0]);
  add(g, new THREE.SphereGeometry(0.028, segs(lod, 12, 8, 5), segs(lod, 8, 6, 4)), t, [0, -0.04, 0]);
  g.position.y = 0.04;
  return g;
}

function dagger(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t, s } = mats(spec);
  add(g, new THREE.BoxGeometry(0.03, 0.26, 0.01), p, [0, 0.26, 0]);
  add(g, new THREE.BoxGeometry(0.1, 0.02, 0.03), t, [0, 0.12, 0]);
  add(g, new THREE.CylinderGeometry(0.014, 0.016, 0.1, segs(lod, 8, 6, 5)), s, [0, 0.06, 0]);
  add(g, new THREE.SphereGeometry(0.02, 8, 6), t, [0, 0.0, 0]);
  return g;
}

function pistol(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t, s } = mats(spec);
  add(g, new RoundedBoxGeometry(0.18, 0.055, 0.032, segs(lod, 2, 1, 0), 0.006), t, [0.02, 0.11, 0]);
  add(g, new RoundedBoxGeometry(0.08, 0.1, 0.028, 1, 0.006), s, [-0.04, 0.04, 0], [0, 0, 0.18]);
  add(g, new THREE.BoxGeometry(0.06, 0.03, 0.024), t, [0.1, 0.1, 0]);
  if (lod < 2) {
    add(g, new THREE.BoxGeometry(0.02, 0.07, 0.02), p, [-0.02, 0.04, 0]);
    add(g, new THREE.BoxGeometry(0.012, 0.018, 0.008), t, [0.08, 0.145, 0]);
  }
  return g;
}

function rifle(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t, s } = mats(spec);
  add(g, new RoundedBoxGeometry(0.28, 0.06, 0.045, segs(lod, 2, 1, 0), 0.006), t, [0.05, 0.12, 0]);
  add(g, new THREE.BoxGeometry(0.32, 0.04, 0.04), s, [-0.22, 0.115, 0]);
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.34, segs(lod, 10, 6, 5)), t, [0.36, 0.125, 0], [0, 0, Math.PI / 2]);
  add(g, new RoundedBoxGeometry(0.14, 0.09, 0.03, 1, 0.004), s, [-0.32, 0.07, 0]);
  add(g, new THREE.BoxGeometry(0.05, 0.1, 0.025), p, [0.0, 0.05, 0]);
  if (lod === 0) {
    add(g, new THREE.BoxGeometry(0.22, 0.012, 0.03), t, [0.08, 0.16, 0]);
    add(g, new THREE.BoxGeometry(0.04, 0.03, 0.04), t, [0.52, 0.125, 0]);
    add(g, new THREE.BoxGeometry(0.08, 0.03, 0.05), s, [-0.18, 0.09, 0]);
  }
  g.position.x = -0.1;
  return g;
}

function shotgun(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t, s } = mats(spec);
  add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.55, segs(lod, 10, 6, 5)), t, [0.18, 0.12, 0], [0, 0, Math.PI / 2]);
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.4, segs(lod, 8, 6, 5)), t, [0.1, 0.09, 0], [0, 0, Math.PI / 2]);
  add(g, new RoundedBoxGeometry(0.18, 0.07, 0.04, 1, 0.006), p, [-0.12, 0.1, 0]);
  add(g, new RoundedBoxGeometry(0.16, 0.08, 0.03, 1, 0.004), s, [-0.32, 0.07, 0]);
  if (lod === 0) add(g, new THREE.BoxGeometry(0.16, 0.02, 0.05), t, [0.2, 0.15, 0]);
  return g;
}

function shield(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t } = mats(spec);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.6);
  shape.lineTo(0.32, 0.35);
  shape.lineTo(0.28, -0.45);
  shape.lineTo(0, -0.6);
  shape.lineTo(-0.28, -0.45);
  shape.lineTo(-0.32, 0.35);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: lod === 0, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
  geo.center();
  add(g, geo, p, [0, 0.62, 0]);
  if (lod < 2) add(g, new THREE.CylinderGeometry(0.07, 0.07, 0.05, segs(lod, 12, 8, 6)), t, [0, 0.7, 0.03], [Math.PI / 2, 0, 0]);
  return g;
}

function helmet(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t, s } = mats(spec);
  const n = segs(lod, 24, 12, 8);
  add(g, new THREE.SphereGeometry(0.14, n, segs(lod, 16, 10, 6), 0, Math.PI * 2, 0, Math.PI * 0.62), p, [0, 0.18, 0]);
  add(g, new THREE.CylinderGeometry(0.13, 0.135, 0.08, n, 1, true), p, [0, 0.12, 0]);
  if (lod < 2) {
    add(g, new THREE.BoxGeometry(0.18, 0.04, 0.16), t, [0, 0.16, 0.08]);
    add(g, new THREE.BoxGeometry(0.16, 0.012, 0.04), s, [0, 0.17, 0.14]);
  }
  return g;
}

function pillar(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, s } = mats(spec);
  const n = segs(lod, 16, 10, 6);
  add(g, new THREE.BoxGeometry(0.8, 0.18, 0.8), s, [0, 0.09, 0]);
  add(g, new THREE.CylinderGeometry(0.22, 0.26, 3.5, n), p, [0, 1.93, 0]);
  add(g, new THREE.BoxGeometry(0.7, 0.22, 0.7), s, [0, 3.78, 0]);
  if (lod === 0) {
    add(g, new THREE.BoxGeometry(0.86, 0.06, 0.86), s, [0, 0.2, 0]);
    add(g, new THREE.BoxGeometry(0.76, 0.06, 0.76), s, [0, 3.66, 0]);
  }
  return g;
}

function wall(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, s } = mats(spec);
  add(g, new THREE.BoxGeometry(2, 3, 0.28), p, [0, 1.5, 0]);
  if (lod < 2) {
    add(g, new THREE.BoxGeometry(2.02, 0.12, 0.34), s, [0, 0.06, 0]);
    add(g, new THREE.BoxGeometry(2.02, 0.1, 0.34), s, [0, 2.94, 0]);
  }
  return g;
}

function stairs(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, s } = mats(spec);
  const steps = lod === 2 ? 4 : 8;
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps;
    add(g, new THREE.BoxGeometry(1.6, 0.12, 2 / steps + 0.02), p, [0, i * (2 / steps) + 0.06, 1 - t * 2 + 1 / steps]);
  }
  if (lod < 2) {
    add(g, new THREE.BoxGeometry(0.08, 1.1, 2.05), s, [-0.84, 1.1, 0]);
    add(g, new THREE.BoxGeometry(0.08, 1.1, 2.05), s, [0.84, 1.1, 0]);
  }
  return g;
}

function pipe(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t } = mats(spec);
  const n = segs(lod, 16, 10, 6);
  add(g, new THREE.CylinderGeometry(0.16, 0.16, 1.2, n), p, [0, 0.25, 0], [0, 0, Math.PI / 2]);
  add(g, new THREE.CylinderGeometry(0.16, 0.16, 0.6, n), p, [0, 0.45, 0]);
  if (lod < 2) {
    add(g, new THREE.CylinderGeometry(0.22, 0.22, 0.06, n), t, [-0.58, 0.25, 0], [0, 0, Math.PI / 2]);
    add(g, new THREE.CylinderGeometry(0.22, 0.22, 0.06, n), t, [0.58, 0.25, 0], [0, 0, Math.PI / 2]);
    add(g, new THREE.CylinderGeometry(0.22, 0.22, 0.06, n), t, [0, 0.74, 0]);
  }
  return g;
}

function door(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t, e } = mats(spec);
  add(g, new RoundedBoxGeometry(1.2, 2.2, 0.12, segs(lod, 2, 1, 0), 0.02), p, [0, 1.1, 0]);
  add(g, new THREE.BoxGeometry(1.4, 2.3, 0.08), t, [0, 1.1, -0.08]);
  if (lod < 2) {
    add(g, new THREE.TorusGeometry(0.12, 0.02, 8, segs(lod, 16, 10, 6)), t, [0, 1.2, 0.08]);
    add(g, new THREE.BoxGeometry(0.4, 0.08, 0.04), e, [0, 1.85, 0.08]);
  }
  return g;
}

function vent(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t } = mats(spec);
  add(g, new THREE.BoxGeometry(1, 0.06, 1), p, [0, 0.06, 0]);
  if (lod < 2) {
    for (let i = -3; i <= 3; i++) {
      add(g, new THREE.BoxGeometry(0.9, 0.02, 0.04), t, [0, 0.1, i * 0.12]);
    }
  }
  add(g, new THREE.BoxGeometry(1.02, 0.04, 1.02), t, [0, 0.02, 0]);
  return g;
}

function lantern(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { t, e, g: glass } = mats(spec);
  add(g, new THREE.CylinderGeometry(0.07, 0.08, 0.04, segs(lod, 12, 8, 6)), t, [0, 0.02, 0]);
  add(g, new THREE.CylinderGeometry(0.055, 0.055, 0.16, segs(lod, 12, 8, 6), 1, true), glass, [0, 0.14, 0]);
  add(g, new THREE.CylinderGeometry(0.065, 0.05, 0.05, segs(lod, 12, 8, 6)), t, [0, 0.24, 0]);
  add(g, new THREE.SphereGeometry(0.03, 8, 6), e, [0, 0.13, 0]);
  if (lod === 0) {
    add(g, new THREE.TorusGeometry(0.05, 0.006, 6, 12), t, [0, 0.3, 0]);
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      add(g, new THREE.BoxGeometry(0.012, 0.16, 0.012), t, [Math.cos(a) * 0.055, 0.14, Math.sin(a) * 0.055]);
    }
  }
  return g;
}

function potion(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { s, e, g: glass } = mats(spec);
  add(g, new THREE.SphereGeometry(0.055, segs(lod, 16, 10, 8), segs(lod, 12, 8, 6)), glass, [0, 0.07, 0]);
  add(g, new THREE.SphereGeometry(0.04, 10, 8), e, [0, 0.065, 0]);
  add(g, new THREE.CylinderGeometry(0.018, 0.022, 0.07, segs(lod, 10, 6, 5)), glass, [0, 0.14, 0]);
  add(g, new THREE.CylinderGeometry(0.022, 0.02, 0.03, 8), s, [0, 0.185, 0]);
  return g;
}

function hoverbike(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p, t, e, s } = mats(spec);
  add(g, new RoundedBoxGeometry(1.6, 0.18, 0.42, segs(lod, 3, 1, 0), 0.06), p, [0, 0.42, 0]);
  add(g, new RoundedBoxGeometry(0.7, 0.16, 0.36, 2, 0.04), s, [-0.2, 0.56, 0]);
  add(g, new THREE.CylinderGeometry(0.12, 0.16, 0.5, segs(lod, 12, 8, 6)), t, [0.7, 0.28, 0.22], [Math.PI / 2, 0, 0]);
  add(g, new THREE.CylinderGeometry(0.12, 0.16, 0.5, segs(lod, 12, 8, 6)), t, [0.7, 0.28, -0.22], [Math.PI / 2, 0, 0]);
  add(g, new THREE.CylinderGeometry(0.1, 0.14, 0.4, segs(lod, 12, 8, 6)), t, [-0.7, 0.26, 0], [Math.PI / 2, 0, 0]);
  if (lod < 2) {
    add(g, new THREE.TorusGeometry(0.08, 0.012, 8, 16), t, [0.55, 0.62, 0.16], [Math.PI / 2, 0, 0.4]);
    add(g, new THREE.TorusGeometry(0.08, 0.012, 8, 16), t, [0.55, 0.62, -0.16], [Math.PI / 2, 0, -0.4]);
    add(g, new THREE.BoxGeometry(0.18, 0.04, 0.3), e, [0.72, 0.28, 0]);
  }
  return g;
}

function mannequin(spec: AssetSpec, lod: LodLevel) {
  const g = new THREE.Group();
  const { p } = mats(spec);
  const n = segs(lod, 12, 8, 6);
  add(g, new THREE.SphereGeometry(0.11, n, n), p, [0, 1.62, 0]);
  add(g, new THREE.CylinderGeometry(0.05, 0.07, 0.1, n), p, [0, 1.48, 0]);
  add(g, new RoundedBoxGeometry(0.34, 0.48, 0.16, 1, 0.04), p, [0, 1.18, 0]);
  add(g, new THREE.CylinderGeometry(0.05, 0.045, 0.42, n), p, [-0.12, 0.62, 0]);
  add(g, new THREE.CylinderGeometry(0.05, 0.045, 0.42, n), p, [0.12, 0.62, 0]);
  add(g, new THREE.SphereGeometry(0.055, n, n), p, [-0.12, 0.38, 0]);
  add(g, new THREE.SphereGeometry(0.055, n, n), p, [0.12, 0.38, 0]);
  add(g, new THREE.CylinderGeometry(0.045, 0.05, 0.4, n), p, [-0.12, 0.18, 0]);
  add(g, new THREE.CylinderGeometry(0.045, 0.05, 0.4, n), p, [0.12, 0.18, 0]);
  add(g, new THREE.CylinderGeometry(0.04, 0.04, 0.42, n), p, [-0.28, 1.18, 0], [0, 0, Math.PI / 2.4]);
  add(g, new THREE.CylinderGeometry(0.04, 0.04, 0.42, n), p, [0.28, 1.18, 0], [0, 0, -Math.PI / 2.4]);
  return g;
}

const BUILDERS: Record<AssetSpec["kind"], (spec: AssetSpec, lod: LodLevel) => THREE.Group> = {
  crate,
  sci_crate: sciCrate,
  barrel,
  chest,
  ammo_can: ammoCan,
  sword,
  dagger,
  pistol,
  rifle,
  shotgun,
  shield,
  helmet,
  pillar,
  wall,
  stairs,
  pipe,
  door,
  vent,
  lantern,
  potion,
  hoverbike,
  mannequin,
};

/**
 * Scale and place a blockout so its bounding box equals the spec dimensions exactly
 * and it sits per the spec pivot: bottom kinds rest on y = 0, centre kinds are
 * centred on the origin. The builders sketch proportions; the spec owns the size.
 */
function fitToSpec(built: THREE.Group, spec: AssetSpec): THREE.Group {
  const root = new THREE.Group();
  root.add(built);
  const size = new THREE.Box3().setFromObject(built).getSize(new THREE.Vector3());
  const target = new THREE.Vector3(spec.dimensions.x, spec.dimensions.y, spec.dimensions.z);
  built.scale.set(
    size.x > 1e-6 ? target.x / size.x : 1,
    size.y > 1e-6 ? target.y / size.y : 1,
    size.z > 1e-6 ? target.z / size.z : 1,
  );
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(built);
  const center = box.getCenter(new THREE.Vector3());
  built.position.x -= center.x;
  built.position.z -= center.z;
  built.position.y -= spec.pivot === "center" ? center.y : box.min.y;
  root.updateMatrixWorld(true);
  return root;
}

export function buildAsset(spec: AssetSpec, lod: LodLevel): THREE.Group {
  const group = fitToSpec(BUILDERS[spec.kind](spec, lod), spec);
  const base = meshName(spec);
  group.name = base;
  let part = 0;
  group.traverse((obj) => {
    obj.userData.anvil = spec.id;
    if (obj instanceof THREE.Mesh) {
      obj.name = `${base}_${String(part++).padStart(2, "0")}`;
    }
  });
  return group;
}

/** World-space bounds of a built asset. */
export function boundsOf(group: THREE.Object3D) {
  group.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(group);
}

/**
 * The collision primitive the spec asks for, sized from the built LOD0, named the
 * way the target engine's importer expects. Convex uses the hull of the mesh vertices.
 */
export function collisionMesh(spec: AssetSpec, reference: THREE.Object3D): THREE.Mesh {
  const box = boundsOf(reference);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const pad = 0.005;
  let geometry: THREE.BufferGeometry;
  if (spec.collision === "sphere") {
    geometry = new THREE.SphereGeometry(Math.max(size.x, size.y, size.z) / 2 + pad, 12, 8);
  } else if (spec.collision === "capsule") {
    const radius = Math.max(size.x, size.z) / 2 + pad;
    geometry = new THREE.CapsuleGeometry(radius, Math.max(0, size.y + 2 * pad - 2 * radius), 4, 12);
  } else if (spec.collision === "convex" || spec.collision === "trimesh") {
    const points: THREE.Vector3[] = [];
    reference.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const position = obj.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i += Math.max(1, Math.floor(position.count / 400))) {
        points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(obj.matrixWorld));
      }
    });
    geometry = points.length >= 4 ? new ConvexGeometry(points) : new THREE.BoxGeometry(size.x + 2 * pad, size.y + 2 * pad, size.z + 2 * pad);
    if (points.length >= 4) center.set(0, 0, 0); // hull points are already in world space
  } else {
    geometry = new THREE.BoxGeometry(size.x + 2 * pad, size.y + 2 * pad, size.z + 2 * pad);
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#7d9a78", wireframe: true }));
  mesh.position.copy(center);
  mesh.name = collisionName(spec);
  mesh.userData.anvil = spec.id;
  mesh.userData.collision = spec.collision;
  return mesh;
}

export function disposeGroup(group: THREE.Object3D) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      // The viewport may have swapped in an unlit material; dispose both variants once.
      const swapped = [obj.userData.anvilLit, obj.userData.anvilUnlit].filter(
        (m): m is THREE.Material => m instanceof THREE.Material,
      );
      for (const mat of new Set([...materials, ...swapped])) mat.dispose();
    }
  });
}

export function countTriangles(group: THREE.Object3D) {
  let tris = 0;
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const geo = obj.geometry;
      const index = geo.index;
      if (index) tris += index.count / 3;
      else tris += (geo.attributes.position?.count ?? 0) / 3;
    }
  });
  return Math.round(tris);
}
