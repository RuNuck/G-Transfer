import { readFileSync } from "node:fs";
import { SceneSpecSchema } from "./schema";
import type { SceneSpec } from "./types";

export type SceneLoadResult =
  | { ok: true; spec: SceneSpec }
  | { ok: false; errors: string[] };

/** Validate an unknown value as SceneSpec (zod). */
export function parseSceneSpec(data: unknown): SceneLoadResult {
  const result = SceneSpecSchema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  return { ok: true, spec: result.data as SceneSpec };
}

/** Load + validate a SceneSpec JSON file from disk. */
export function loadSceneSpecFile(path: string): SceneLoadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return { ok: false, errors: [`failed to read ${path}: ${e instanceof Error ? e.message : String(e)}`] };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`invalid JSON in ${path}: ${e instanceof Error ? e.message : String(e)}`] };
  }
  return parseSceneSpec(data);
}
