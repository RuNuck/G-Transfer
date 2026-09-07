import { listJobs } from "./job-store.mjs";

const jsonOnly = process.argv.includes("--json");
const jobs = listJobs();
if (jsonOnly) {
  console.log(JSON.stringify({ count: jobs.length, jobs }, null, 2));
} else {
  console.log("Anvil forge jobs: " + jobs.length);
  for (const j of jobs) {
    const mesh = j.paths?.mesh || j.inputs?.file || "-";
    console.log([j.id, j.status.padEnd(11), j.updatedAt, mesh].join("  "));
  }
}
