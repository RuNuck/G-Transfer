/**
 * Resolve WeaponGraph from preset name, file path, or inline JSON + shallow overrides.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "./job-store.mjs";

export const PRESET_FILES = {
  m4_carbine: "docs/schemas/examples/m4-carbine.weapon.json",
  // CQBR shares the M4 example graph with a shorter overall length override.
  m4_cqbr: "docs/schemas/examples/m4-carbine.weapon.json",
};

const PRESET_DEFAULT_OVERRIDES = {
  m4_cqbr: {
    preset: "m4_cqbr",
    id: "weapon.m4.cqbr",
    displayName: "M4-style CQBR",
    overallLengthM: 0.72,
  },
};

/** Shallow top-level merge; nested objects replaced wholesale. */
export function applyOverrides(graph, overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return graph;
  return { ...graph, ...overrides };
}

export function loadPresetGraph(preset) {
  const rel = PRESET_FILES[preset];
  if (!rel) {
    throw new Error(
      `unknown weapon preset "${preset}" (known: ${Object.keys(PRESET_FILES).join(", ")}). For ar15_custom/custom pass weaponGraph or graphPath.`,
    );
  }
  const abs = resolve(projectRoot, rel);
  if (!existsSync(abs)) throw new Error(`preset file missing: ${rel}`);
  let graph = JSON.parse(readFileSync(abs, "utf8"));
  if (PRESET_DEFAULT_OVERRIDES[preset]) {
    graph = applyOverrides(graph, PRESET_DEFAULT_OVERRIDES[preset]);
  }
  return graph;
}

export function validateWeaponGraphData(graph, { writeTempAs } = {}) {
  const checker = resolve(projectRoot, "tools/validate/check-weapon-graph.mjs");
  let path = writeTempAs;
  if (!path) {
    const dir = join(projectRoot, ".anvil", "weapon-graphs");
    mkdirSync(dir, { recursive: true });
    path = join(dir, `validate_${Date.now()}.weapon.json`);
  }
  writeFileSync(path, JSON.stringify(graph, null, 2) + "\n");
  const r = spawnSync(process.execPath, [checker, path], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    ok: (r.status ?? 1) === 0,
    exitCode: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    path: path.replace(projectRoot + "/", "").split("\\").join("/"),
  };
}

export function resolveWeaponGraphInput({
  preset = null,
  graphPath = null,
  graphJson = null,
  overrides = null,
} = {}) {
  let graph = null;
  let source = null;

  if (graphJson != null) {
    graph = typeof graphJson === "string" ? JSON.parse(graphJson) : graphJson;
    source = "inline";
  } else if (graphPath) {
    const abs = resolve(projectRoot, graphPath);
    if (!existsSync(abs)) throw new Error("weapon graph file not found: " + graphPath);
    graph = JSON.parse(readFileSync(abs, "utf8"));
    source = graphPath;
  } else if (preset) {
    graph = loadPresetGraph(preset);
    source = `preset:${preset}`;
  } else {
    throw new Error("forge_weapon requires preset, weaponGraph, or graphPath");
  }

  if (overrides) graph = applyOverrides(graph, overrides);
  if (preset && !graph.preset) graph.preset = preset;

  const check = validateWeaponGraphData(graph);
  if (!check.ok) {
    const msg = (check.stderr || check.stdout || "weapon graph invalid").trim();
    const err = new Error(msg);
    err.check = check;
    throw err;
  }

  return { graph, source, check };
}
