/**
 * Lightweight GLB (glTF 2 binary) parser: JSON chunk + optional POSITION AABB.
 * No external deps — enough for artifact gates without Godot/Blender.
 */
import { readFileSync, statSync } from "node:fs";

const GODOT_COL_RE = /-(?:conv)?col(?:only)?$/i;
const UNREAL_COL_RE = /^(?:UBX|USP|UCP|UCX)_/i;

export function isGodotCollisionName(name) {
  return typeof name === "string" && GODOT_COL_RE.test(name);
}

export function isUnrealCollisionName(name) {
  return typeof name === "string" && UNREAL_COL_RE.test(name);
}

/** Path/filename hints that the asset is expected to be rigged with clips. */
export function suggestsRigged(filePath) {
  const s = String(filePath).toLowerCase().replace(/\\/g, "/");
  return (
    /(^|\/)[^/]*rigged[^/]*\.glb$/.test(s) ||
    /\/rifle-rigged\//.test(s) ||
    /\.rigged\.glb$/.test(s) ||
    /_rigged\.glb$/.test(s) ||
    /\/rig\//.test(s)
  );
}


/** Path/filename hints that the asset is a weapon (pivot/grip expectations). */
export function suggestsWeapon(filePath) {
  const s = String(filePath).toLowerCase().replace(/\\/g, "/");
  return (
    /(^|\/)(rifle|pistol|shotgun|smg|weapon|gun|m4|ak)[^/]*\.glb$/.test(s) ||
    /\/(weapons?|guns?)\//.test(s) ||
    /_weapon\.glb$/.test(s)
  );
}

/**
 * Collect material texture refs. Returns { claimedPbr, missing, refs }.
 * claimedPbr = material has pbrMetallicRoughness with at least one *Texture map.
 */
export function materialTextureReport(json) {
  const textures = json.textures || [];
  const images = json.images || [];
  const refs = [];
  const missing = [];
  let claimedPbr = 0;
  const slots = [
    ["pbrMetallicRoughness", "baseColorTexture"],
    ["pbrMetallicRoughness", "metallicRoughnessTexture"],
    [null, "normalTexture"],
    [null, "occlusionTexture"],
    [null, "emissiveTexture"],
  ];
  for (let mi = 0; mi < (json.materials || []).length; mi++) {
    const mat = json.materials[mi] || {};
    const name = mat.name || ("material_" + mi);
    let matClaimed = false;
    for (const [parent, key] of slots) {
      const container = parent ? mat[parent] : mat;
      const texInfo = container && container[key];
      if (!texInfo || texInfo.index == null) continue;
      matClaimed = true;
      const ti = texInfo.index;
      const tex = textures[ti];
      const imageIndex = tex && tex.source != null ? tex.source : null;
      const okTex = Boolean(tex);
      const okImg = imageIndex != null && Boolean(images[imageIndex]);
      const ref = { material: name, slot: key, textureIndex: ti, imageIndex, ok: okTex && okImg };
      refs.push(ref);
      if (!ref.ok) missing.push(ref);
    }
    if (matClaimed) claimedPbr += 1;
    // Explicit claim via extras
    if (mat.extras && (mat.extras.anvilPbr || mat.extras.anvil_pbr || mat.extras.pbr === true)) {
      if (!matClaimed) {
        claimedPbr += 1;
        missing.push({ material: name, slot: "(extras.anvilPbr)", textureIndex: null, imageIndex: null, ok: false });
      }
    }
  }
  return { claimedPbr, missing, refs, textureCount: textures.length, imageCount: images.length };
}

/**
 * Root / grip pivot heuristic for weapons and rigged assets.
 */
export function pivotReport(json, filePath) {
  const nodes = json.nodes || [];
  const names = nodes.map((n) => (n && n.name) || "");
  const grip = names.find((n) => /grip|hand_socket|ik_hand|weapon_root/i.test(n || ""));
  let rootTranslation = null;
  if (nodes[0] && Array.isArray(nodes[0].translation)) rootTranslation = nodes[0].translation.map(Number);
  const nearOrigin = rootTranslation
    ? rootTranslation.every((v) => Number.isFinite(v) && Math.abs(v) <= 2)
    : null;
  return {
    suggestsWeapon: suggestsWeapon(filePath),
    suggestsRigged: suggestsRigged(filePath),
    gripNode: grip || null,
    rootTranslation,
    rootNearOrigin: nearOrigin,
  };
}

export function readGlb(filePath) {
  const st = statSync(filePath);
  if (!st.isFile()) throw new Error("not a file");
  const buf = readFileSync(filePath);
  if (buf.length < 20) throw new Error("file too small to be a GLB");
  const magic = buf.toString("utf8", 0, 4);
  if (magic !== "glTF") throw new Error(`bad magic "${magic}" (expected glTF)`);
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported glTF version ${version}`);
  const totalLength = buf.readUInt32LE(8);
  if (totalLength > buf.length) throw new Error(`GLB length ${totalLength} exceeds file ${buf.length}`);

  const chunk0Len = buf.readUInt32LE(12);
  const chunk0Type = buf.toString("utf8", 16, 20);
  if (chunk0Type !== "JSON") throw new Error(`first chunk is ${JSON.stringify(chunk0Type)}, expected JSON`);
  if (20 + chunk0Len > buf.length) throw new Error("JSON chunk truncated");

  let json;
  try {
    // JSON chunk is padded with spaces to 4-byte alignment
    json = JSON.parse(buf.toString("utf8", 20, 20 + chunk0Len));
  } catch (e) {
    throw new Error(`JSON chunk parse failed: ${e.message}`);
  }

  let bin = null;
  let offset = 20 + chunk0Len;
  if (offset + 8 <= buf.length) {
    const chunk1Len = buf.readUInt32LE(offset);
    const chunk1Type = buf.toString("utf8", offset + 4, offset + 8);
    if (chunk1Type === "BIN\0" || chunk1Type === "BIN ") {
      const start = offset + 8;
      if (start + chunk1Len <= buf.length) bin = buf.subarray(start, start + chunk1Len);
    }
  }

  return { bytes: st.size, modified: st.mtimeMs, version, json, bin };
}

function readAccessorMinMax(json, accessorIndex) {
  const acc = json.accessors?.[accessorIndex];
  if (!acc || acc.type !== "VEC3" || acc.componentType !== 5126) return null;
  if (acc.min?.length === 3 && acc.max?.length === 3) {
    return { min: acc.min.map(Number), max: acc.max.map(Number) };
  }
  return null;
}

/** Union mesh POSITION accessor min/max when present in the JSON (common exporter practice). */
export function meshBounds(json) {
  let min = null;
  let max = null;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const pos = prim.attributes?.POSITION;
      if (pos == null) continue;
      const mm = readAccessorMinMax(json, pos);
      if (!mm) continue;
      if (!min) {
        min = [...mm.min];
        max = [...mm.max];
      } else {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], mm.min[i]);
          max[i] = Math.max(max[i], mm.max[i]);
        }
      }
    }
  }
  if (!min) return null;
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return { min, max, size };
}

export function summarizeGlb(parsed, filePath) {
  const { json, bytes, modified } = parsed;
  const nodes = (json.nodes ?? []).map((n) => n?.name ?? "");
  const meshes = (json.meshes ?? []).map((m) => m?.name ?? "");
  const materials = (json.materials ?? []).map((m) => m?.name ?? "");
  const animations = (json.animations ?? []).map((a) => a?.name ?? "");
  const skins = json.skins?.length ?? 0;
  const godotCol = nodes.filter(isGodotCollisionName);
  const unrealCol = nodes.filter(isUnrealCollisionName);
  const bounds = meshBounds(json);
  return {
    file: filePath,
    bytes,
    modified,
    nodes,
    meshes,
    materials,
    animations,
    skins,
    godotCollisionNodes: godotCol,
    unrealCollisionNodes: unrealCol,
    bounds,
    suggestsRigged: suggestsRigged(filePath),
    suggestsWeapon: suggestsWeapon(filePath),
    textures: materialTextureReport(json),
    pivot: pivotReport(json, filePath),
  };
}
