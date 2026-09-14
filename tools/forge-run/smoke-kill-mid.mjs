/**
 * P1 kill-mid-job smoke:
 * enqueue fake-long → worker --once → kill while building → reconcile → failed + quarantined + no ready.
 *
 *   node tools/forge-run/smoke-kill-mid.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJob, projectRoot } from "./job-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enqueue = join(here, "enqueue.mjs");
const worker = join(here, "worker.mjs");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const enq = spawnSync(
    process.execPath,
    [enqueue, "--fake-long", "--sleep-ms", "60000", "--json"],
    { cwd: projectRoot, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  let enqDoc;
  try {
    enqDoc = JSON.parse(enq.stdout || "{}");
  } catch {
    console.error("enqueue failed", enq.stdout, enq.stderr);
    process.exit(1);
  }
  if (!enqDoc.ok || !enqDoc.jobId) {
    console.error("enqueue payload bad", enqDoc);
    process.exit(1);
  }
  const jobId = enqDoc.jobId;

  const child = spawn(process.execPath, [worker, "--once", "--json"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  const workerPid = child.pid;

  // Wait until job is building (partial written).
  let building = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const j = loadJob(jobId);
    if (j && j.status === "building") {
      building = true;
      break;
    }
    if (j && (j.status === "failed" || j.status === "published")) break;
  }
  if (!building) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* */
    }
    console.error(JSON.stringify({ ok: false, error: "job never reached building", jobId, job: loadJob(jobId) }, null, 2));
    process.exit(1);
  }

  // Kill mid-job
  try {
    process.kill(workerPid, "SIGKILL");
  } catch {
    /* already dead */
  }
  await sleep(300);

  // Reconcile / doctor
  const rec = spawnSync(process.execPath, [worker, "--reconcile-only", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  let recDoc;
  try {
    recDoc = JSON.parse(rec.stdout || "{}");
  } catch {
    recDoc = { raw: rec.stdout, err: rec.stderr };
  }

  const job = loadJob(jobId);
  const artDir = resolve(projectRoot, `exports/forge/${jobId}`);
  const artGone = !existsSync(artDir);
  const quarantined = Boolean(job?.paths?.quarantined) && existsSync(resolve(projectRoot, job.paths.quarantined));

  // Index must not mark this partial as ready
  let indexReadyHit = false;
  const indexPath = resolve(projectRoot, "exports/index.json");
  if (existsSync(indexPath)) {
    try {
      const idx = JSON.parse(readFileSync(indexPath, "utf8"));
      const entries = idx.assets || idx.items || idx.entries || [];
      const list = Array.isArray(entries) ? entries : Object.values(entries || {});
      for (const e of list) {
        const p = String(e.path || e.mesh || e.file || "");
        if (p.includes(jobId) && (e.ready === true || e.status === "ready")) {
          indexReadyHit = true;
        }
      }
    } catch {
      /* ignore */
    }
  }

  const ok =
    job?.status === "failed" &&
    (job?.hardFail === "worker_interrupted" ||
      (job?.validation?.hardFails || []).includes("worker_interrupted")) &&
    job?.status !== "published" &&
    !indexReadyHit &&
    (artGone || quarantined);

  const report = {
    ok,
    jobId,
    workerPid,
    jobStatus: job?.status,
    hardFail: job?.hardFail,
    validationHardFails: job?.validation?.hardFails || [],
    quarantine: job?.paths?.quarantined || null,
    artifactDirPresent: !artGone,
    indexReadyHit,
    reconcile: recDoc,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
