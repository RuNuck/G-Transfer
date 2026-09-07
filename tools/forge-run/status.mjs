import { loadJob, projectRoot } from "./job-store.mjs";

const args = process.argv.slice(2);
const jsonOnly = args.includes("--json");
const id = args.find((a) => !a.startsWith("-"));
if (!id) {
  console.error("usage: node tools/forge-run/status.mjs <jobId> [--json]");
  process.exit(2);
}
const job = loadJob(id);
if (!job) {
  console.error("job not found: " + id + " (looked in " + projectRoot + "/.anvil/jobs)");
  process.exit(1);
}
if (jsonOnly) console.log(JSON.stringify(job, null, 2));
else {
  console.log(job.id + "  " + job.status);
  console.log("updated: " + job.updatedAt);
  if (job.paths?.mesh) console.log("mesh: " + job.paths.mesh);
  if (job.validation) console.log("validation ok: " + job.validation.ok);
  if (job.errors?.length) console.log("errors: " + job.errors.map((e) => e.message).join("; "));
  console.log(JSON.stringify(job, null, 2));
}
