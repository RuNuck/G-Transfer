#!/usr/bin/env node
/**
 * Lightweight WeaponGraph instance check (no ajv).
 *
 *   node tools/validate/check-weapon-graph.mjs [path]
 *   Default: docs/schemas/examples/m4-carbine.weapon.json
 *
 * Exit 0 on pass, 1 on fail. Prints a short human summary.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function findProjectRoot() {
  for (const start of [here, process.cwd()]) {
    let dir = start;
    for (;;) {
      const pkg = join(dir, "package.json");
      if (existsSync(pkg)) {
        try {
          if (JSON.parse(readFileSync(pkg, "utf8")).name === "anvil") return dir;
        } catch {
          /* ignore */
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return resolve(process.cwd());
}

const root = findProjectRoot();
const DEFAULT = "docs/schemas/examples/m4-carbine.weapon.json";
const input = process.argv[2] ?? DEFAULT;
const path = resolve(root, input);

/** @type {string[]} */
const errors = [];

function req(obj, key, where) {
  if (obj == null || typeof obj !== "object" || !(key in obj) || obj[key] === undefined || obj[key] === null) {
    errors.push(`${where}: missing required field "${key}"`);
    return false;
  }
  return true;
}

function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function checkPart(part, i) {
  const where = `parts[${i}]`;
  if (!part || typeof part !== "object") {
    errors.push(`${where}: must be an object`);
    return;
  }
  req(part, "id", where);
  req(part, "role", where);
  req(part, "kitFamily", where);
}

function checkSocket(socket, i) {
  const where = `sockets[${i}]`;
  if (!socket || typeof socket !== "object") {
    errors.push(`${where}: must be an object`);
    return;
  }
  req(socket, "id", where);
  req(socket, "parentPart", where);
  req(socket, "kind", where);
  if (req(socket, "localTransform", where)) {
    const lt = socket.localTransform;
    if (!lt || typeof lt !== "object") {
      errors.push(`${where}.localTransform: must be an object`);
    } else {
      if (!Array.isArray(lt.translation) || lt.translation.length !== 3) {
        errors.push(`${where}.localTransform.translation: need [x,y,z]`);
      }
      if (!Array.isArray(lt.rotationDeg) || lt.rotationDeg.length !== 3) {
        errors.push(`${where}.localTransform.rotationDeg: need [x,y,z]`);
      }
    }
  }
}

function checkClip(clip, i) {
  const where = `clips[${i}]`;
  if (!clip || typeof clip !== "object") {
    errors.push(`${where}: must be an object`);
    return;
  }
  req(clip, "name", where);
  req(clip, "part", where);
  if (req(clip, "motion", where)) {
    const m = clip.motion;
    if (!m || typeof m !== "object") {
      errors.push(`${where}.motion: must be an object`);
    } else {
      req(m, "type", `${where}.motion`);
      req(m, "axis", `${where}.motion`);
    }
  }
}

function main() {
  if (!existsSync(path)) {
    console.error(`FAIL: file not found: ${input}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`FAIL: JSON parse error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.error("FAIL: root must be a JSON object");
    process.exit(1);
  }

  for (const key of ["schemaVersion", "id", "preset", "parts", "sockets", "pivot", "clips", "materials"]) {
    req(data, key, "root");
  }

  if (data.schemaVersion !== 1) {
    errors.push(`root.schemaVersion: expected 1, got ${JSON.stringify(data.schemaVersion)}`);
  }
  if (typeof data.id === "string" && !/^weapon\.[a-z0-9_.-]+$/.test(data.id)) {
    errors.push(`root.id: must match ^weapon\\.[a-z0-9_.-]+$ (got ${JSON.stringify(data.id)})`);
  }

  if (!isNonEmptyArray(data.parts)) {
    errors.push("root.parts: must be a non-empty array");
  } else {
    data.parts.forEach(checkPart);
  }

  if (!Array.isArray(data.sockets)) {
    errors.push("root.sockets: must be an array");
  } else {
    data.sockets.forEach(checkSocket);
  }

  if (!data.pivot || typeof data.pivot !== "object") {
    errors.push("root.pivot: must be an object");
  } else {
    req(data.pivot, "kind", "pivot");
    req(data.pivot, "part", "pivot");
    if (!Array.isArray(data.pivot.localTranslation) || data.pivot.localTranslation.length !== 3) {
      errors.push("pivot.localTranslation: need [x,y,z]");
    }
  }

  if (!isNonEmptyArray(data.clips)) {
    errors.push("root.clips: must be a non-empty array");
  } else {
    data.clips.forEach(checkClip);
  }

  if (!isNonEmptyArray(data.materials)) {
    errors.push("root.materials: must be a non-empty array");
  }

  // Cross-refs: socket parentPart and clip.part should exist in parts[].id
  if (isNonEmptyArray(data.parts)) {
    const ids = new Set(data.parts.map((p) => p?.id).filter(Boolean));
    if (Array.isArray(data.sockets)) {
      for (const s of data.sockets) {
        if (s?.parentPart && !ids.has(s.parentPart)) {
          errors.push(`socket "${s.id}": parentPart "${s.parentPart}" not in parts`);
        }
      }
    }
    if (Array.isArray(data.clips)) {
      for (const c of data.clips) {
        if (c?.part && !ids.has(c.part)) {
          errors.push(`clip "${c.name}": part "${c.part}" not in parts`);
        }
      }
    }
    if (data.pivot?.part && !ids.has(data.pivot.part)) {
      errors.push(`pivot.part "${data.pivot.part}" not in parts`);
    }
  }

  if (errors.length) {
    console.error(`FAIL: ${input} (${errors.length} issue${errors.length === 1 ? "" : "s"})`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const partN = data.parts.length;
  const sockN = Array.isArray(data.sockets) ? data.sockets.length : 0;
  const clipN = data.clips.length;
  console.log(`OK: ${input}`);
  console.log(`  id=${data.id} preset=${data.preset} parts=${partN} sockets=${sockN} clips=${clipN}`);
}

main();
