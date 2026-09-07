/**
 * Build tiny intentional pass/fail GLB fixtures for godot_prod gates.
 *   node tools/validate/fixtures/build-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const failDir = join(here, "fail");
const passDir = join(here, "pass");
mkdirSync(failDir, { recursive: true });
mkdirSync(passDir, { recursive: true });

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

function writeGlb(filePath, json, bin = null) {
  const jsonStr = JSON.stringify(json);
  const jsonPad = pad4(Buffer.byteLength(jsonStr));
  const jsonBytes = Buffer.concat([Buffer.from(jsonStr, "utf8"), Buffer.alloc(jsonPad, 0x20)]);
  let binBytes = null;
  let binPad = 0;
  if (bin && bin.length) {
    binPad = pad4(bin.length);
    binBytes = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  } else {
    // 3 VEC3 floats (triangle) zeros when buffer declared
    const declared = json.buffers?.[0]?.byteLength ?? 0;
    if (declared > 0) {
      binPad = pad4(declared);
      binBytes = Buffer.alloc(declared + binPad, 0);
    }
  }
  const chunks = [];
  chunks.push(Buffer.alloc(12)); // header filled later
  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonChunkHeader.write("JSON", 4, 4, "ascii");
  chunks.push(jsonChunkHeader, jsonBytes);
  if (binBytes) {
    const binChunkHeader = Buffer.alloc(8);
    binChunkHeader.writeUInt32LE(binBytes.length - binPad + binPad, 0); // full padded length
    // glTF requires chunk length include padding; type BIN\0
    binChunkHeader.writeUInt32LE(binBytes.length, 0);
    binChunkHeader.write("BIN\0", 4, 4, "ascii");
    chunks.push(binChunkHeader, binBytes);
  }
  const body = Buffer.concat(chunks.slice(1));
  const total = 12 + body.length;
  const header = chunks[0];
  header.write("glTF", 0, 4, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  writeFileSync(filePath, Buffer.concat([header, body]));
  console.log("wrote", filePath, total, "bytes");
}

function baseDoc({
  nodeName = "prop-col-convcolonly",
  meshName = "SM_Prop",
  matName = "M_Plain",
  min = [0, 0, 0],
  max = [1, 1, 1],
  translation = null,
  material = null,
  textures = null,
  images = null,
  extras = null,
  includeMinMax = true,
  hasPosition = true,
}) {
  const mat = material || {
    name: matName,
    pbrMetallicRoughness: {
      baseColorFactor: [0.7, 0.7, 0.7, 1],
      metallicFactor: 0,
      roughnessFactor: 0.5,
    },
  };
  if (extras) mat.extras = extras;

  const accessor = {
    type: "VEC3",
    componentType: 5126,
    count: 3,
    bufferView: 0,
  };
  if (includeMinMax) {
    accessor.min = min;
    accessor.max = max;
  }

  const node = { name: nodeName, mesh: 0 };
  if (translation) node.translation = translation;

  const doc = {
    asset: { version: "2.0", generator: "anvil-validate-fixture" },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [node],
    meshes: [
      {
        name: meshName,
        primitives: [
          {
            attributes: hasPosition ? { POSITION: 0 } : {},
            material: 0,
          },
        ],
      },
    ],
    materials: [mat],
    accessors: hasPosition ? [accessor] : [],
    bufferViews: hasPosition
      ? [{ buffer: 0, byteOffset: 0, byteLength: 36 }]
      : [],
    buffers: hasPosition ? [{ byteLength: 36 }] : [],
  };
  if (textures) doc.textures = textures;
  if (images) doc.images = images;
  return doc;
}

// --- FAIL: meters_bounds ---
writeGlb(
  join(failDir, "bad-scale.glb"),
  baseDoc({
    nodeName: "huge_prop_col-convcolonly",
    meshName: "SM_Huge",
    min: [0, 0, 0],
    max: [500, 500, 500],
  }),
);
writeGlb(
  join(failDir, "tiny-scale.glb"),
  baseDoc({
    nodeName: "tiny_prop_col-convcolonly",
    meshName: "SM_Tiny",
    min: [0, 0, 0],
    max: [0.005, 0.005, 0.005],
  }),
);
writeGlb(
  join(failDir, "no-position-minmax.glb"),
  baseDoc({
    nodeName: "prop_col-convcolonly",
    meshName: "SM_NoBounds",
    includeMinMax: false,
  }),
);

// --- FAIL: pbr_textures_resolve ---
writeGlb(
  join(failDir, "no-textures-pbr.glb"),
  baseDoc({
    nodeName: "prop_col-convcolonly",
    meshName: "SM_NoTex",
    max: [1, 1, 1],
    material: {
      name: "M_ClaimedPBR",
      extras: { anvilPbr: true },
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicRoughnessTexture: { index: 1 },
      },
      normalTexture: { index: 2 },
    },
  }),
);
writeGlb(
  join(failDir, "pbr-extras-only.glb"),
  baseDoc({
    nodeName: "prop_col-convcolonly",
    meshName: "SM_ExtrasPbr",
    max: [1, 1, 1],
    extras: { anvilPbr: true },
  }),
);
writeGlb(
  join(failDir, "pbr-missing-image.glb"),
  baseDoc({
    nodeName: "prop_col-convcolonly",
    meshName: "SM_MissingImg",
    max: [1, 1, 1],
    material: {
      name: "M_BrokenTex",
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
      },
    },
    textures: [{ source: 0 }],
    images: [], // texture points at missing image
  }),
);

// --- FAIL: pivot_weapon_or_rigged (weapon-missing-pivot mandatory) ---
writeGlb(
  join(failDir, "weapon-missing-pivot.glb"),
  baseDoc({
    nodeName: "rifle_body_col-convcolonly",
    meshName: "SM_Rifle",
    max: [0.8, 0.2, 0.1],
    translation: [25, 0, 0], // far from origin, no grip node
  }),
);
writeGlb(
  join(failDir, "pistol-far-root.glb"),
  baseDoc({
    nodeName: "pistol_mesh_col-convcolonly",
    meshName: "SM_Pistol",
    max: [0.3, 0.15, 0.05],
    translation: [0, 10, 0],
  }),
);
writeGlb(
  join(failDir, "shotgun-no-grip.glb"),
  baseDoc({
    nodeName: "shotgun_col-convcolonly",
    meshName: "SM_Shotgun",
    max: [1.0, 0.25, 0.12],
    translation: [5, 5, 5],
  }),
);

// keep legacy fail fixtures that aren't meters/pbr/pivot-specific
writeGlb(
  join(failDir, "no-collision-minimal.glb"),
  baseDoc({
    nodeName: "prop_no_col",
    meshName: "prop_no_col",
    max: [0.2, 0.2, 0.2],
  }),
);
writeFileSync(join(failDir, "malformed-not-glb.glb"), Buffer.from("NOT A GLTF FILE AT ALL!!!!!\n"));
console.log("wrote", join(failDir, "malformed-not-glb.glb"));

// --- PASS fixtures ---
// Honest pass assets must claim resolvable PBR (claimedPbr===0 is now hard-fail).
const okPbr = {
  material: {
    name: "M_OkPbr",
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      metallicRoughnessTexture: { index: 1 },
    },
    normalTexture: { index: 2 },
  },
  textures: [{ source: 0 }, { source: 1 }, { source: 2 }],
  images: [{ name: "albedo" }, { name: "orm" }, { name: "normal" }],
};

writeGlb(
  join(passDir, "prop-meters-ok.glb"),
  baseDoc({
    nodeName: "crate_col-convcolonly",
    meshName: "SM_Crate",
    max: [0.5, 0.5, 0.5],
    ...okPbr,
    material: { ...okPbr.material, name: "M_CratePbr" },
  }),
);

writeGlb(
  join(passDir, "pbr-resolve-ok.glb"),
  baseDoc({
    nodeName: "textured_col-convcolonly",
    meshName: "SM_Textured",
    max: [1, 1, 1],
    ...okPbr,
  }),
);

const rifleOk = baseDoc({
  nodeName: "grip",
  meshName: "SM_RifleOk",
  max: [0.7, 0.2, 0.08],
  translation: [0, 0, 0],
  ...okPbr,
  material: { ...okPbr.material, name: "M_RiflePbr" },
});
rifleOk.nodes = [
  { name: "grip", mesh: 0, translation: [0, 0, 0] },
  { name: "rifle_col-convcolonly" },
];
rifleOk.scenes = [{ nodes: [0, 1] }];
writeGlb(join(passDir, "rifle-grip-ok.glb"), rifleOk);

console.log("fixtures built");
