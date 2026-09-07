import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { buildAsset, collisionMesh, disposeGroup } from "./builders";
import { lodName, meshName } from "./naming";
import type { AssetSpec, LodLevel } from "./types";

/**
 * One GLB with the whole export set: the base mesh, its LOD1/LOD2 copies and the
 * collision primitive, named the way the target engine expects (the same names the
 * Inspector, QC and Blender script use).
 */
export async function exportGlb(spec: AssetSpec): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  const lods = ([0, 1, 2] as LodLevel[]).map((lod) => {
    const group = buildAsset(spec, lod);
    group.name = lod === 0 ? meshName(spec) : lodName(spec, lod);
    scene.add(group);
    return group;
  });
  const collision = collisionMesh(spec, lods[0]);
  scene.add(collision);
  const exporter = new GLTFExporter();
  const data = await exporter.parseAsync(scene, { binary: true });
  for (const group of lods) disposeGroup(group);
  collision.geometry.dispose();
  (collision.material as THREE.Material).dispose();
  if (data instanceof ArrayBuffer) return data;
  return new TextEncoder().encode(JSON.stringify(data)).buffer;
}

export function downloadGlb(spec: AssetSpec, buffer: ArrayBuffer) {
  const blob = new Blob([buffer], { type: "model/gltf-binary" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${meshName(spec)}.glb`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
