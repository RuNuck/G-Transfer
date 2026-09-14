/**
 * Filesystem job store under .anvil/jobs/<id>.json
 * Durable queue helpers: claim, reconcile interrupted inflight, quarantine.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const STAGES = ["queued", "building", "baking", "validating", "published", "failed"];
/** Stages that mean a worker was mid-flight; kill leaves these unclean. */
export const INFLIGHT_STAGES = ["building", "baking", "validating"];

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, "../..");
export const jobsDir = join(projectRoot, ".anvil", "jobs");
export const anvilDir = join(projectRoot, ".anvil");
export const workerPidPath = join(anvilDir, "worker.pid");
export const quarantineRoot = join(projectRoot, "exports", "forge", "_quarantine");

export function ensureJobsDir() {
  mkdirSync(jobsDir, { recursive: true });
  return jobsDir;
}

export function newJobId() {
  const t = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return "job_" + t + "_" + randomBytes(3).toString("hex");
}

export function jobPath(id) {
  return join(jobsDir, id + ".json");
}

export function artifactDirFor(jobId) {
  return join(projectRoot, "exports", "forge", jobId);
}

export function createJob(seed = {}) {
  ensureJobsDir();
  const now = new Date().toISOString();
  const id = seed.id || newJobId();
  const job = {
    schemaVersion: 1,
    id,
    type: seed.type || "asset",
    status: seed.status || "queued",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    inputs: seed.inputs || {},
    paths: seed.paths || {},
    stages: seed.stages || [],
    notes: seed.notes || [],
    errors: seed.errors || [],
    validation: seed.validation || null,
    blender: seed.blender || { available: false, note: "not checked" },
    worker: seed.worker || null,
  };
  // Default durable artifact root (ship-gated publish still required for ready).
  if (!job.paths.artifactDir) {
    job.paths.artifactDir = `exports/forge/${id}`;
  }
  saveJob(job);
  return job;
}

export function loadJob(id) {
  const path = jobPath(id);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveJob(job) {
  ensureJobsDir();
  job.updatedAt = new Date().toISOString();
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2) + "\n");
  return job;
}

export function listJobs() {
  ensureJobsDir();
  const files = readdirSync(jobsDir).filter((f) => f.endsWith(".json"));
  const jobs = [];
  for (const f of files) {
    try {
      jobs.push(JSON.parse(readFileSync(join(jobsDir, f), "utf8")));
    } catch {
      // skip corrupt
    }
  }
  jobs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return jobs;
}

export function advanceStage(job, status, note) {
  if (!STAGES.includes(status)) throw new Error("invalid status: " + status);
  job.status = status;
  const entry = { status, at: new Date().toISOString(), note: note || null };
  job.stages = job.stages || [];
  job.stages.push(entry);
  if (note) {
    job.notes = job.notes || [];
    job.notes.push(note);
  }
  if (status === "building" && !job.startedAt) job.startedAt = entry.at;
  if (status === "published" || status === "failed") job.finishedAt = entry.at;
  return saveJob(job);
}

export function failJob(job, error) {
  job.errors = job.errors || [];
  job.errors.push({ at: new Date().toISOString(), message: String(error) });
  return advanceStage(job, "failed", String(error));
}

/** Fail closed with a hardFail id (never leaves published/ready). */
export function failJobHard(job, hardFailId, message) {
  job.validation = job.validation || { ok: false, hardFails: [] };
  job.validation.ok = false;
  job.validation.hardFails = [...new Set([...(job.validation.hardFails || []), hardFailId])];
  job.shipGate = job.shipGate && job.shipGate !== "ready" ? job.shipGate : "failed";
  if (job.paths) {
    delete job.paths.indexStatus;
    if (job.paths.indexStatus === "ready") job.paths.indexStatus = "failed";
  }
  job.hardFail = hardFailId;
  return failJob(job, message || hardFailId);
}

export function isPidAlive(pid) {
  if (!pid || typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readWorkerPidFile() {
  if (!existsSync(workerPidPath)) return null;
  try {
    return JSON.parse(readFileSync(workerPidPath, "utf8"));
  } catch {
    return null;
  }
}

export function writeWorkerPidFile(extra = {}) {
  mkdirSync(anvilDir, { recursive: true });
  const doc = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ...extra,
  };
  writeFileSync(workerPidPath, JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

export function clearWorkerPidFile() {
  try {
    if (existsSync(workerPidPath)) rmSync(workerPidPath);
  } catch {
    /* ignore */
  }
}

/**
 * Move half-written job outputs out of the forge tree so index never sees them as ready.
 * Prefer quarantine over delete for forensics.
 */
export function quarantineJobArtifacts(job) {
  const rel =
    job.paths?.artifactDir ||
    (job.id ? `exports/forge/${job.id}` : null);
  if (!rel) return { quarantined: false, reason: "no artifactDir" };
  const abs = resolve(projectRoot, rel);
  const forgeRoot = resolve(projectRoot, "exports", "forge");
  // Only quarantine under exports/forge/<jobId> — never touch unrelated forge assets.
  if (!abs.startsWith(forgeRoot + "/") && abs !== forgeRoot) {
    return { quarantined: false, reason: "artifactDir outside exports/forge" };
  }
  if (!existsSync(abs)) {
    return { quarantined: false, reason: "missing", path: rel };
  }
  // Do not quarantine shared legacy dirs (biome, textures, known kit names).
  const base = abs.split("/").pop();
  if (base === "_quarantine" || base === "biome" || base === "textures") {
    return { quarantined: false, reason: "shared dir skipped" };
  }
  mkdirSync(quarantineRoot, { recursive: true });
  const dest = join(quarantineRoot, `${job.id}_${Date.now()}`);
  try {
    renameSync(abs, dest);
    job.paths = job.paths || {};
    job.paths.quarantined = dest.replace(projectRoot + "/", "").split("\\").join("/");
    if (job.paths.mesh && String(job.paths.mesh).startsWith(rel)) {
      job.paths.meshQuarantined = job.paths.mesh;
      delete job.paths.mesh;
    }
    saveJob(job);
    return { quarantined: true, from: rel, to: job.paths.quarantined };
  } catch (e) {
    return { quarantined: false, reason: String(e.message || e) };
  }
}

/**
 * Mark inflight jobs failed with worker_interrupted when the owning worker is dead
 * (or unknown). Never upgrades to published/ready.
 */
export function reconcileInterruptedJobs({ forceAllInflight = false } = {}) {
  const results = [];
  for (const job of listJobs()) {
    if (!INFLIGHT_STAGES.includes(job.status)) continue;
    // Never touch terminal published — reconcile only inflight.
    if (job.status === "published" || job.status === "failed") continue;

    const ownerPid = job.worker?.pid ?? null;
    const alive = isPidAlive(ownerPid);
    const shouldFail = forceAllInflight || !ownerPid || !alive;
    if (!shouldFail) {
      results.push({ id: job.id, status: job.status, action: "skip_alive", workerPid: ownerPid });
      continue;
    }

    const q = quarantineJobArtifacts(job);
    failJobHard(
      job,
      "worker_interrupted",
      `worker interrupted mid-stage (${job.status}); ownerPid=${ownerPid || "none"} alive=${alive}`,
    );
    job.worker = { ...(job.worker || {}), interrupted: true, reconciledAt: new Date().toISOString() };
    saveJob(job);
    results.push({
      id: job.id,
      action: "failed_worker_interrupted",
      previousStatus: job.stages?.[job.stages.length - 2]?.status || null,
      quarantine: q,
      hardFail: "worker_interrupted",
    });
  }
  return results;
}

/** True if any job is currently claimed inflight (one Blender at a time). */
export function hasInflightJob() {
  return listJobs().some((j) => INFLIGHT_STAGES.includes(j.status));
}

/**
 * Claim the oldest queued job for this worker. Returns null if none or another inflight exists.
 */
export function claimNextQueued(workerInfo = {}) {
  if (hasInflightJob()) return null;
  const queued = listJobs()
    .filter((j) => j.status === "queued")
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const next = queued[0];
  if (!next) return null;
  // Re-load to reduce race window
  const job = loadJob(next.id);
  if (!job || job.status !== "queued") return null;
  if (hasInflightJob()) return null;
  job.worker = {
    pid: process.pid,
    claimedAt: new Date().toISOString(),
    ...workerInfo,
  };
  advanceStage(job, "building", `claimed by worker pid ${process.pid}`);
  return job;
}
