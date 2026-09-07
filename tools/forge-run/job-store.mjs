/**
 * Filesystem job store under .anvil/jobs/<id>.json
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const STAGES = ["queued", "building", "baking", "validating", "published", "failed"];

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, "../..");
export const jobsDir = join(projectRoot, ".anvil", "jobs");

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
  };
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
