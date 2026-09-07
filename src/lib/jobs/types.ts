/** Forge job model (Phase 1). Persisted as JSON under .anvil/jobs/. */

export const FORGE_JOB_STAGES = [
  "queued",
  "building",
  "baking",
  "validating",
  "published",
  "failed",
] as const;

export type ForgeJobStage = (typeof FORGE_JOB_STAGES)[number];

export type ForgeJobType = "asset" | "weapon" | "scene";

export type ForgeJobStageEvent = {
  status: ForgeJobStage;
  at: string;
  note?: string | null;
};

export type ForgeJobError = {
  at: string;
  message: string;
};

export type ForgeJob = {
  schemaVersion: 1;
  id: string;
  type: ForgeJobType;
  status: ForgeJobStage;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  inputs: Record<string, unknown>;
  paths: {
    mesh?: string;
    index?: string;
    report?: string;
    [key: string]: string | undefined;
  };
  stages: ForgeJobStageEvent[];
  notes: string[];
  errors: ForgeJobError[];
  validation: {
    ok: boolean;
    exitCode?: number;
    hardFails?: string[];
    counts?: Record<string, number> | null;
    report?: unknown;
  } | null;
  blender: {
    available: boolean;
    path?: string | null;
    note?: string;
  };
};
