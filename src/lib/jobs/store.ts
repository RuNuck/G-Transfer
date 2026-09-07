/**
 * Thin Node helpers for MCP / server-side job reads.
 * CLI source of truth lives in tools/forge-run/job-store.mjs — keep shapes aligned with types.ts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ForgeJob } from "./types";

export function anvilJobsDir(projectRoot: string = process.cwd()): string {
  return resolve(projectRoot, ".anvil", "jobs");
}

export function ensureAnvilJobsDir(projectRoot: string = process.cwd()): string {
  const dir = anvilJobsDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readForgeJob(jobId: string, projectRoot: string = process.cwd()): ForgeJob | null {
  const path = join(anvilJobsDir(projectRoot), `${jobId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ForgeJob;
  } catch {
    return null;
  }
}

export function listForgeJobs(projectRoot: string = process.cwd()): ForgeJob[] {
  const dir = anvilJobsDir(projectRoot);
  if (!existsSync(dir)) return [];
  const jobs: ForgeJob[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      jobs.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as ForgeJob);
    } catch {
      // skip
    }
  }
  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return jobs;
}
