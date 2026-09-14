/**
 * Ensure GLB has a grip/hand_socket node so pivot_weapon_or_rigged passes.
 * Rifle kit joins parts (grip mesh name is lost); FPS needs an explicit socket.
 */
import { readFileSync, writeFileSync } from "node:fs";

export function ensureGripPivotInGlb(absGlb, graph = {}) {
  const buf = readFileSync(absGlb);
  if (buf.length < 20 || buf.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("not a GLB: " + absGlb);
  }
  const chunk0Len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + chunk0Len));
  const nodes = json.nodes || (json.nodes = []);
  const hasGrip = nodes.some((n) => /grip|hand_socket|ik_hand|weapon_root/i.test((n && n.name) || ""));
  if (hasGrip) return { patched: false, reason: "already_has_grip" };

  const lt = graph.pivot?.localTranslation || [0, -0.02, 0.01];
  const gripNode = {
    name: "grip",
    translation: [Number(lt[0]) || 0, Number(lt[1]) || 0, Number(lt[2]) || 0],
  };
  const gripIndex = nodes.length;
  nodes.push(gripNode);

  if (Array.isArray(json.scenes) && json.scenes[0]) {
    const scene = json.scenes[0];
    scene.nodes = scene.nodes || [];
    scene.nodes.push(gripIndex);
  }

  const jsonStr = JSON.stringify(json);
  const jsonPad = jsonStr + " ".repeat((4 - (jsonStr.length % 4)) % 4);
  const jsonBytes = Buffer.from(jsonPad, "utf8");

  let bin = null;
  let offset = 20 + chunk0Len;
  if (offset + 8 <= buf.length) {
    const chunk1Len = buf.readUInt32LE(offset);
    const chunk1Type = buf.toString("utf8", offset + 4, offset + 8);
    if (chunk1Type === "BIN\0" || chunk1Type.startsWith("BIN")) {
      const start = offset + 8;
      if (start + chunk1Len <= buf.length) bin = buf.subarray(start, start + chunk1Len);
    }
  }

  const parts = [];
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.write("JSON", 4, 4, "ascii");
  parts.push(jsonHeader, jsonBytes);

  let total = 12 + 8 + jsonBytes.length;
  if (bin && bin.length) {
    const binPadLen = (4 - (bin.length % 4)) % 4;
    const binPadded = binPadLen ? Buffer.concat([bin, Buffer.alloc(binPadLen)]) : Buffer.from(bin);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binPadded.length, 0);
    binHeader.write("BIN\0", 4, 4, "ascii");
    parts.push(binHeader, binPadded);
    total += 8 + binPadded.length;
  }

  const header = Buffer.alloc(12);
  header.write("glTF", 0, 4, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  writeFileSync(absGlb, Buffer.concat([header, ...parts]));
  return { patched: true, gripIndex, translation: gripNode.translation };
}
