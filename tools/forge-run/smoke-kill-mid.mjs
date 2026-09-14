/**
 * P1 kill-mid-job smoke.
 *
 * Real Blender path (Vale bar):
 *   node tools/forge-run/smoke-kill-mid.mjs --blender
 *   node tools/forge-run/smoke-kill-mid.mjs --kind lantern --bake
 *
 * Fake-long unit (no Blender; keep as extra):
 *   node tools/forge-run/smoke-kill-mid.mjs --fake-long
 *
 * Default with no flags: --blender (Vale requires Blender in the process tree).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJob, projectRoot } from "./job-store.mjs";
import { findBlender } from "./find-dcc.mjs";
import { patchIndexShipGate, runGodotImportCheck } from "./ship-gate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enqueue = join(here, "enqueue.mjs");
const worker = join(here, "worker.mjs");
const statusCli = join(here, "status.mjs");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const args = {
    fakeLong: false,
    blender: false,
    kind: null,
    bake: null, // null = default true when blender/kind
    sleepMs: 60000,
    readyId: "forge-smoke.oil_lantern",
    readyFile: "exports/forge-smoke/oil_lantern.glb",
  };
  let sawMode = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fake-long") {
      args.fakeLong = true;
      sawMode = true;
    } else if (a === "--blender") {
      args.blender = true;
      sawMode = true;
    } else if (a === "--kind") {
      args.kind = argv[++i];
      args.blender = true;
      sawMode = true;
    } else if (a.startsWith("--kind=")) {
      args.kind = a.slice(7);
      args.blender = true;
      sawMode = true;
    } else if (a === "--bake") args.bake = true;
    else if (a === "--no-bake") args.bake = false;
    else if (a === "--sleep-ms") args.sleepMs = Number(argv[++i]) || 60000;
    else if (a.startsWith("--sleep-ms=")) args.sleepMs = Number(a.slice(11)) || 60000;
    else if (a === "--ready-id") args.readyId = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`usage:
  node tools/forge-run/smoke-kill-mid.mjs --blender [--kind lantern] [--bake|--no-bake]
  node tools/forge-run/smoke-kill-mid.mjs --fake-long [--sleep-ms 60000]
Default (no flags): --blender --kind lantern --bake`);
      process.exit(0);
    }
  }
  if (!sawMode) {
    args.blender = true;
  }
  if (args.blender && !args.kind) args.kind = "lantern";
  if (args.blender && args.bake === null) args.bake = true;
  if (args.fakeLong && args.blender) {
    console.error("use either --fake-long or --blender/--kind, not both");
    process.exit(2);
  }
  return args;
}

function readIndex() {
  const indexPath = resolve(projectRoot, "exports/index.json");
  if (!existsSync(indexPath)) return null;
  try {
    return JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return null;
  }
}

function indexEntry(idOrMesh) {
  const idx = readIndex();
  if (!idx) return null;
  const entries = idx.entries || idx.assets || idx.items || [];
  const list = Array.isArray(entries) ? entries : Object.values(entries || {});
  return (
    list.find((e) => e.id === idOrMesh || e.mesh === idOrMesh || String(e.file || "").includes(idOrMesh)) ||
    null
  );
}

function indexReadyHitForJob(jobId) {
  const idx = readIndex();
  if (!idx) return false;
  const entries = idx.entries || idx.assets || idx.items || [];
  const list = Array.isArray(entries) ? entries : Object.values(entries || {});
  for (const e of list) {
    const p = String(e.path || e.mesh || e.file || e.id || "");
    if (p.includes(jobId) && (e.ready === true || e.status === "ready")) return true;
  }
  return false;
}

function ensurePublishedReady(args) {
  let entry = indexEntry(args.readyId);
  if (entry && entry.ready === true && entry.status === "ready") {
    return { ok: true, restored: false, entry };
  }
  const abs = resolve(projectRoot, args.readyFile);
  if (!existsSync(abs)) {
    return { ok: false, restored: false, entry, error: "ready baseline GLB missing: " + args.readyFile };
  }
  const ship = runGodotImportCheck(abs);
  if (ship.status !== "ready") {
    return { ok: false, restored: false, entry, ship, error: "could not restore ready baseline shipGate" };
  }
  patchIndexShipGate(args.readyFile, ship);
  entry = indexEntry(args.readyId);
  return {
    ok: Boolean(entry && entry.ready === true && entry.status === "ready"),
    restored: true,
    entry,
    ship,
  };
}

/** Collect PIDs that look like Blender under (or equal to) rootPid via /proc. */
function findBlenderPidsNear(rootPid) {
  const found = new Set();
  let children;
  try {
    children = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    return [];
  }
  for (const pidStr of children) {
    const pid = Number(pidStr);
    let cmdline = "";
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    } catch {
      continue;
    }
    if (!/blender/i.test(cmdline)) continue;
    // Accept if this pid is rootPid, or an ancestor chain reaches rootPid, or ppid chain.
    let cur = pid;
    for (let depth = 0; depth < 12; depth++) {
      if (cur === rootPid) {
        found.add(pid);
        break;
      }
      try {
        const stat = readFileSync(`/proc/${cur}/stat`, "utf8");
        const close = stat.indexOf(")");
        const parts = stat.slice(close + 2).split(" ");
        const ppid = Number(parts[1]);
        if (!ppid || ppid <= 1) break;
        cur = ppid;
      } catch {
        break;
      }
    }
  }
  return [...found];
}

function killPid(pid, sig = "SIGKILL") {
  if (!pid) return false;
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
}

function assertFailedInterrupted(job) {
  return (
    job?.status === "failed" &&
    (job?.hardFail === "worker_interrupted" ||
      (job?.validation?.hardFails || []).includes("worker_interrupted"))
  );
}

async function runFakeLong(args) {
  const enq = spawnSync(
    process.execPath,
    [enqueue, "--fake-long", "--sleep-ms", String(args.sleepMs), "--json"],
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
    killPid(workerPid);
    console.error(
      JSON.stringify({ ok: false, error: "job never reached building", jobId, job: loadJob(jobId) }, null, 2),
    );
    process.exit(1);
  }

  killPid(workerPid);
  await sleep(300);

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
  const quarantined =
    Boolean(job?.paths?.quarantined) && existsSync(resolve(projectRoot, job.paths.quarantined));
  const indexReadyHit = indexReadyHitForJob(jobId);

  const ok =
    assertFailedInterrupted(job) &&
    job?.status !== "published" &&
    !indexReadyHit &&
    (artGone || quarantined);

  const report = {
    ok,
    mode: "fake-long",
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

async function runBlenderKillMid(args) {
  const blender = findBlender();
  if (!blender.available) {
    console.error(
      JSON.stringify(
        { ok: false, error: "Blender not found — Vale bar requires real Blender in process tree", blender },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const baseline = ensurePublishedReady(args);
  if (!baseline.ok) {
    console.error(JSON.stringify({ ok: false, error: "ready baseline missing", baseline }, null, 2));
    process.exit(1);
  }
  const readyBefore = {
    id: baseline.entry.id,
    status: baseline.entry.status,
    ready: baseline.entry.ready,
    file: baseline.entry.file,
  };

  const enqArgs = [enqueue, "--kind", args.kind, "--json"];
  if (args.bake) enqArgs.splice(3, 0, "--bake");
  const enq = spawnSync(process.execPath, enqArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  });
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

  let blenderPid = null;
  let blenderSeenVia = null;
  let stageAtKill = null;
  const deadline = Date.now() + 120000; // Blender may take a few seconds to start
  while (Date.now() < deadline) {
    await sleep(100);
    const j = loadJob(jobId);
    if (!j) continue;
    stageAtKill = j.status;
    if (j.status === "failed" || j.status === "published") {
      killPid(workerPid);
      console.error(
        JSON.stringify(
          {
            ok: false,
            error: "job reached terminal before Blender kill window",
            jobId,
            job: j,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    if (j.worker?.blenderPid) {
      blenderPid = j.worker.blenderPid;
      blenderSeenVia = "job.worker.blenderPid";
      break;
    }
    const near = findBlenderPidsNear(workerPid);
    if (near.length) {
      blenderPid = near[0];
      blenderSeenVia = "proc_tree";
      break;
    }
  }

  if (!blenderPid) {
    killPid(workerPid);
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "Blender never appeared under worker (Vale requires Blender in process tree)",
          jobId,
          workerPid,
          job: loadJob(jobId),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  // Kill Blender child first (avoid orphan finishing GLB after quarantine), then worker.
  const blenderPids = new Set([blenderPid, ...findBlenderPidsNear(workerPid)]);
  for (const p of blenderPids) killPid(p);
  killPid(workerPid);
  await sleep(400);
  // Reap any stragglers
  for (const p of findBlenderPidsNear(workerPid)) killPid(p);

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
  const quarantined =
    Boolean(job?.paths?.quarantined) && existsSync(resolve(projectRoot, job.paths.quarantined));
  const indexReadyHit = indexReadyHitForJob(jobId);

  // Re-poll same job stays failed
  const poll1 = loadJob(jobId);
  await sleep(50);
  const poll2 = loadJob(jobId);
  const statusPoll = spawnSync(process.execPath, [statusCli, jobId, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  let statusDoc = null;
  try {
    statusDoc = JSON.parse(statusPoll.stdout || "{}");
  } catch {
    statusDoc = null;
  }

  const readyAfter = indexEntry(args.readyId);
  const publishedStillReady =
    readyAfter && readyAfter.ready === true && readyAfter.status === "ready";

  const ok =
    assertFailedInterrupted(job) &&
    job?.status !== "published" &&
    !indexReadyHit &&
    (artGone || quarantined) &&
    publishedStillReady &&
    poll1?.status === "failed" &&
    poll2?.status === "failed" &&
    statusDoc?.status === "failed" &&
    Boolean(blenderPid);

  const report = {
    ok,
    mode: "blender",
    kind: args.kind,
    bake: Boolean(args.bake),
    jobId,
    workerPid,
    blenderPid,
    blenderSeenVia,
    blenderPath: blender.path,
    stageAtKill,
    jobStatus: job?.status,
    hardFail: job?.hardFail,
    validationHardFails: job?.validation?.hardFails || [],
    quarantine: job?.paths?.quarantined || null,
    artifactDirPresent: !artGone,
    indexReadyHit,
    publishedReadyBefore: readyBefore,
    publishedReadyAfter: readyAfter
      ? { id: readyAfter.id, status: readyAfter.status, ready: readyAfter.ready, file: readyAfter.file }
      : null,
    publishedStillReady,
    rePoll: {
      load1: poll1?.status,
      load2: poll2?.status,
      statusCli: statusDoc?.status,
      hardFail: statusDoc?.hardFail || poll2?.hardFail,
    },
    reconcile: recDoc,
    baselineRestored: baseline.restored,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.fakeLong) return runFakeLong(args);
  return runBlenderKillMid(args);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
