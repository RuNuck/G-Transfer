/**
 * Godot import ship gate for forge-run finish + index honesty.
 * ready = validate ok AND Godot present AND import ok.
 * Otherwise: validated_glb_only (Godot missing) or blocked (import failed).
 * forge-run refuses published+ok unless status===ready (godot_absent/godot_import hardFail).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { projectRoot } from "./job-store.mjs";
import { findGodot } from "./find-dcc.mjs";

/** @returns {{ ran: boolean, available: boolean, ok: boolean|null, status: string, problems: string[], note: string, path?: string|null, source?: string, godotVersion?: string|null, exitCode?: number }} */
export function runGodotImportCheck(absGlb) {
  const godot = findGodot();
  if (!godot.available) {
    return {
      ran: false,
      available: false,
      ok: null,
      status: "validated_glb_only",
      problems: [],
      source: godot.source,
      path: godot.path,
      note: "Godot not available — refuse ready; validated_glb_only",
    };
  }
  const checker = resolve(projectRoot, "tools/godot-check/check-import.mjs");
  if (!existsSync(checker)) {
    return {
      ran: false,
      available: true,
      ok: false,
      status: "blocked",
      problems: ["check-import.mjs missing"],
      source: godot.source,
      path: godot.path,
      note: "godot-check script missing — blocked",
    };
  }
  const env = { ...process.env, ANVIL_GODOT: godot.path };
  const r = spawnSync(process.execPath, [checker, absGlb], {
    cwd: projectRoot,
    encoding: "utf8",
    env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 600000,
  });
  let doc = null;
  const raw = (r.stdout || "").trim();
  try {
    doc = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}\s*$/);
    if (m) {
      try {
        doc = JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
  }
  const ok = Boolean(doc?.ok) && (r.status ?? 1) === 0;
  return {
    ran: true,
    available: true,
    ok,
    status: ok ? "ready" : "blocked",
    exitCode: r.status ?? 1,
    source: godot.source,
    path: godot.path,
    problems: doc?.problems ?? (ok ? [] : ["godot-check failed (no JSON)"]),
    godotVersion: doc?.godot ?? null,
    note: ok ? "Godot headless import ok" : "Godot import gate failed — blocked (not ready)",
  };
}

/** After index rebuild, set honest status on the forged mesh entry. Never fake ready. */
export function patchIndexShipGate(relMesh, ship) {
  const indexPath = resolve(projectRoot, "exports/index.json");
  if (!existsSync(indexPath)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return null;
  }
  const entries = doc.entries || [];
  const candidates = new Set([
    relMesh,
    String(relMesh).replace(/^exports\//, ""),
    relMesh.startsWith("exports/") ? relMesh : "exports/" + relMesh,
  ]);
  let hit = null;
  for (const e of entries) {
    const f = String(e.file || "");
    if (candidates.has(f) || candidates.has("exports/" + f) || candidates.has(f.replace(/^exports\//, ""))) {
      hit = e;
      break;
    }
  }
  if (!hit) return null;
  if (ship.status === "ready") {
    hit.ready = true;
    hit.status = "ready";
  } else if (ship.status === "blocked") {
    hit.ready = false;
    hit.status = "blocked";
  } else {
    hit.ready = false;
    hit.status = "validated_glb_only";
  }
  hit.shipGate = {
    status: ship.status,
    godotImportOk: ship.ok,
    godotAvailable: ship.available,
    problems: ship.problems || [],
    note: ship.note,
  };
  let ready = 0,
    failed = 0,
    blocked = 0,
    validatedOnly = 0;
  for (const e of entries) {
    if (e.status === "ready") ready++;
    else if (e.status === "blocked") blocked++;
    else if (e.status === "validated_glb_only") validatedOnly++;
    else if (e.status === "failed") failed++;
  }
  doc.counts = {
    ...(doc.counts || {}),
    assets: entries.length,
    ready,
    failed,
    blocked,
    validated_glb_only: validatedOnly,
  };
  doc.updatedAt = new Date().toISOString();
  writeFileSync(indexPath, JSON.stringify(doc, null, 2) + "\n");
  return hit.status;
}

/**
 * Re-apply shipGate onto index entries from durable published jobs.
 * Index rebuild alone marks validate-ok as validated_glb_only; published jobs with
 * shipGate===ready must keep honest ready (same as the finishPublished patch).
 * @returns {{ patched: number, ready: number }}
 */
export function reapplyShipGatesFromJobs() {
  const jobsDir = resolve(projectRoot, ".anvil/jobs");
  if (!existsSync(jobsDir)) return { patched: 0, ready: 0 };
  let names;
  try {
    names = readdirSync(jobsDir).filter((n) => n.endsWith(".json"));
  } catch {
    return { patched: 0, ready: 0 };
  }
  let patched = 0;
  let ready = 0;
  for (const name of names) {
    let job;
    try {
      job = JSON.parse(readFileSync(join(jobsDir, name), "utf8"));
    } catch {
      continue;
    }
    if (job?.status !== "published") continue;
    const mesh = job.paths?.mesh;
    if (!mesh || typeof mesh !== "string") continue;
    const ship =
      job.godotImport && typeof job.godotImport === "object"
        ? job.godotImport
        : job.shipGate === "ready"
          ? {
              status: "ready",
              ok: true,
              available: true,
              problems: [],
              note: "reapplied from published job shipGate",
            }
          : null;
    if (!ship || ship.status !== "ready") continue;
    const st = patchIndexShipGate(mesh, ship);
    if (st) {
      patched++;
      if (st === "ready") ready++;
    }
  }
  return { patched, ready };
}

