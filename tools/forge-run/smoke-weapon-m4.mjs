/**
 * Phase 2 smoke: enqueue forge_weapon m4_carbine → worker --once → published|failed.
 *
 *   node tools/forge-run/smoke-weapon-m4.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJob, projectRoot } from "./job-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enqueue = join(here, "enqueue-weapon.mjs");
const worker = join(here, "worker.mjs");

function main() {
  const enq = spawnSync(
    process.execPath,
    [enqueue, "--preset", "m4_carbine", "--bake", "--json"],
    { cwd: projectRoot, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, env: process.env },
  );
  let enqDoc;
  try {
    enqDoc = JSON.parse(enq.stdout || "{}");
  } catch {
    console.error("enqueue parse fail", enq.stdout, enq.stderr);
    process.exit(1);
  }
  if (!enqDoc.ok || !enqDoc.jobId) {
    console.error("enqueue failed", enqDoc);
    process.exit(1);
  }
  const jobId = enqDoc.jobId;
  console.error(`enqueued ${jobId} — running worker --once (Blender+bake; may take several minutes)`);

  const wr = spawnSync(process.execPath, [worker, "--once", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
    timeout: 900000,
  });
  let wrDoc = null;
  try {
    wrDoc = JSON.parse((wr.stdout || "").trim() || "{}");
  } catch {
    wrDoc = { raw: (wr.stdout || "").slice(-2000), stderr: (wr.stderr || "").slice(-2000), status: wr.status };
  }

  const job = loadJob(jobId);
  const mesh = job?.paths?.mesh || null;
  const meshAbs = mesh ? join(projectRoot, mesh) : null;
  const buildSource = job?.blender?.buildSource || null;
  const kitReal =
    buildSource === "part kit" || (typeof buildSource === "string" && buildSource.includes("kit"));

  const payload = {
    ok: Boolean(job && (job.status === "published" || job.status === "failed")),
    smokeOk: Boolean(job && job.status === "published" && job.shipGate === "ready"),
    jobId,
    enqueue: enqDoc,
    workerExit: wr.status,
    worker: wrDoc,
    jobStatus: job?.status || null,
    shipGate: job?.shipGate || null,
    hardFail: job?.hardFail || null,
    honesty: job?.honesty || job?.blender?.honesty || null,
    buildSource,
    mesh,
    meshExists: Boolean(meshAbs && existsSync(meshAbs)),
    weaponGates: job?.weaponGates
      ? { ok: job.weaponGates.ok, hardFails: job.weaponGates.hardFails, details: job.weaponGates.details }
      : null,
    validationHardFails: job?.validation?.hardFails || [],
    notes: job?.notes || [],
  };

  console.log(JSON.stringify(payload, null, 2));
  writeFileSync(join(here, "_smoke-weapon-result.json"), JSON.stringify(payload, null, 2) + "\n");

  const evidenceDir = join(projectRoot, "docs/evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, "forge-weapon-m4-2026-09-14.md");
  const et = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const meshLine = mesh ? `- \`${mesh}\`` : "- _(none — job did not publish a mesh)_";
  const kitLine = kitReal
    ? "**Real** — parametric rifle-family kit sized to `overallLengthM` (kit carbine; **not** CAD-accurate M4 parts)"
    : payload.meshExists
      ? `Built (\`buildSource=${buildSource}\`) — inspect honesty`
      : "**Failed / absent** — fail closed (no fake ready)";

  const md = `# forge_weapon M4 smoke — 2026-09-14 ET

**Box:** \`/workspace/project\` (Bill)  
**When:** ${et} ET  
**Job:** \`${jobId}\`

## Goal

Agent cold path: \`forge_weapon\` preset \`m4_carbine\` → \`jobId\` → poll \`forge_job_status\` → ready GLB (~0.84 m, grip pivot, convcol, clips, Godot import ok).

## Commands

\`\`\`bash
node tools/forge-run/enqueue-weapon.mjs --preset m4_carbine --bake --json
node tools/forge-run/worker.mjs --once --json
# or:
npm run forge:smoke:weapon-m4
\`\`\`

## Result

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

## Real vs stubbed

| Piece | Status |
|---|---|
| Durable enqueue \`type=weapon\` | **Real** — \`.anvil/jobs/<id>.json\` queued → worker claim |
| MCP \`forge_weapon\` | **Real** — calls enqueue-weapon + \`--kick-worker\` |
| WeaponGraph preset \`m4_carbine\` | **Real** — example JSON + \`check:weapon-graph\` |
| Mesh forge | ${kitLine} |
| Clips / rig | \`ANVIL_RIG=1\` + kit demo actions; gated when graph claims clips |
| Validate + Godot ship gate | Fail closed (same as asset forge; never published+ok without Godot import when Godot present) |
| Kill-mid queue | Unchanged (shared single-worker claim / reconcile / quarantine) |
| CAD-accurate M4 part kit | **Stubbed / out of scope** — WeaponGraph parts/sockets drive validation intent; mesh is rifle kit assembly |

## GLB

${meshLine}

## Agent path

1. \`forge_weapon({ preset: "m4_carbine" })\` → \`{ jobId, status: "queued" }\`
2. Poll \`forge_job_status\` until \`published\` or \`failed\`
3. Ready only after weapon gates + Godot import ok
`;

  writeFileSync(evidencePath, md);
  console.error(`wrote ${evidencePath}`);

  if (!payload.ok) process.exit(1);
  // Prefer green published; still exit 0 if fail-closed terminal so CI can archive evidence —
  // but this smoke wants ready when DCC present.
  process.exit(payload.smokeOk ? 0 : 1);
}

main();
