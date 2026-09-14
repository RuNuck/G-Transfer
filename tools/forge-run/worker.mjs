/**
 * Single-process durable forge worker.
 * One Blender job at a time. On start (and --reconcile-only): mark orphan inflight failed.
 *
 *   node tools/forge-run/worker.mjs --once
 *   node tools/forge-run/worker.mjs --loop [--poll-ms 2000]
 *   node tools/forge-run/worker.mjs --reconcile-only
 *   node tools/forge-run/worker.mjs --doctor   # alias for reconcile-only
 */
import {
  claimNextQueued,
  clearWorkerPidFile,
  hasInflightJob,
  listJobs,
  loadJob,
  projectRoot,
  reconcileInterruptedJobs,
  writeWorkerPidFile,
} from "./job-store.mjs";
import { executeAssetJob } from "./execute-asset.mjs";
import { executeWeaponJob } from "./execute-weapon.mjs";

function parseArgs(argv) {
  const args = {
    once: false,
    loop: false,
    reconcileOnly: false,
    pollMs: 2000,
    jsonOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") args.once = true;
    else if (a === "--loop") args.loop = true;
    else if (a === "--reconcile-only" || a === "--doctor") args.reconcileOnly = true;
    else if (a === "--json") args.jsonOnly = true;
    else if (a === "--poll-ms") args.pollMs = Number(argv[++i]) || 2000;
    else if (a.startsWith("--poll-ms=")) args.pollMs = Number(a.slice(10)) || 2000;
    else if (a === "--help" || a === "-h") {
      console.log(`usage:
  node tools/forge-run/worker.mjs --once
  node tools/forge-run/worker.mjs --loop [--poll-ms 2000]
  node tools/forge-run/worker.mjs --reconcile-only|--doctor`);
      process.exit(0);
    }
  }
  if (!args.once && !args.loop && !args.reconcileOnly) args.once = true;
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runReconcile(jsonOnly) {
  const results = reconcileInterruptedJobs();
  const payload = {
    ok: true,
    action: "reconcile",
    interruptedFailed: results.filter((r) => r.action === "failed_worker_interrupted").length,
    results,
  };
  if (jsonOnly) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`reconcile: ${payload.interruptedFailed} job(s) -> failed/worker_interrupted`);
    for (const r of results) {
      console.log(`  ${r.id}  ${r.action}`);
    }
  }
  return payload;
}

async function processOne() {
  const job = claimNextQueued({ hostname: "local" });
  if (!job) {
    return { processed: false, reason: hasInflightJob() ? "inflight_busy" : "empty" };
  }
  const result = await (
    job.type === "weapon" || job.inputs?.mode === "weapon-graph"
      ? executeWeaponJob(job)
      : executeAssetJob(job)
  );
  const final = loadJob(job.id) || result.job;
  return {
    processed: true,
    ok: result.ok,
    jobId: final.id,
    status: final.status,
    type: final.type,
    hardFail: final.hardFail || null,
    paths: final.paths,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.reconcileOnly) {
    runReconcile(args.jsonOnly);
    process.exit(0);
  }

  writeWorkerPidFile({ mode: args.loop ? "loop" : "once" });
  const onExit = () => {
    clearWorkerPidFile();
  };
  process.on("exit", onExit);
  process.on("SIGINT", () => {
    onExit();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    onExit();
    process.exit(143);
  });

  // Always reconcile orphans before claiming work.
  const reconciled = reconcileInterruptedJobs();
  if (!args.jsonOnly && reconciled.length) {
    console.log(`worker ${process.pid}: reconciled ${reconciled.length} inflight orphan(s)`);
  }

  if (args.once) {
    const out = await processOne();
    const payload = {
      ok: out.processed ? Boolean(out.ok) : true,
      workerPid: process.pid,
      reconciled,
      ...out,
    };
    // Ensure top-level ok reflects job outcome when processed
    if (out.processed) payload.ok = Boolean(out.ok);
    if (args.jsonOnly) console.log(JSON.stringify(payload, null, 2));
    else if (out.processed) console.log(`worker done ${out.jobId} -> ${out.status}`);
    else console.log(`worker idle (${out.reason})`);
    clearWorkerPidFile();
    process.exit(out.processed && !out.ok ? 1 : 0);
  }

  // loop mode
  if (!args.jsonOnly) console.log(`worker ${process.pid} looping @ ${projectRoot}`);
  while (true) {
    const out = await processOne();
    if (out.processed) {
      if (!args.jsonOnly) console.log(`done ${out.jobId} -> ${out.status}`);
    } else {
      await sleep(args.pollMs);
    }
  }
}

main().catch((e) => {
  console.error(e);
  clearWorkerPidFile();
  process.exit(1);
});
