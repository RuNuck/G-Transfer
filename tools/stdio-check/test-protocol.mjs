// Protocol test for the stdio server: spawn it, speak newline-delimited JSON-RPC, assert on every reply.
// node test-protocol.mjs <path-to-server.mjs>
import { spawn } from "node:child_process";

const SERVER = process.argv[2];
const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ANVIL_BLENDER_PORT: "9" } });
let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (d) => (stdout += d));
child.stderr.on("data", (d) => (stderr += d));

const send = (obj) => child.stdin.write((typeof obj === "string" ? obj : JSON.stringify(obj)) + "\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "ping" });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope", arguments: {} } });
send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "blender_run_python", arguments: {} } });
send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "blender_ping", arguments: {} } });
send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "blender_run_python", arguments: { code: "result = 1" } } });
send({ jsonrpc: "2.0", id: 7, method: "resources/list" });
send("{not json");
send({ jsonrpc: "2.0", id: 8, method: "initialize", params: { protocolVersion: "1999-01-01" } });
send([{ jsonrpc: "2.0", id: 9, method: "ping" }, { jsonrpc: "2.0", method: "notifications/cancelled" }]);
send({ id: 10, method: "ping" });
await wait(1500);
child.stdin.end();
await new Promise((r) => child.on("exit", r));

const lines = stdout.split("\n").filter((l) => l.length);
const problems = [];
const byId = {};
const batches = [];
for (const line of lines) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    problems.push(`non-JSON stdout line: ${line.slice(0, 120)}`);
    continue;
  }
  if (line.includes("Content-Length")) problems.push("Content-Length framing present");
  if (Array.isArray(msg)) batches.push(msg);
  else byId[msg.id === null ? "null" : msg.id] = msg;
}
const expect = (cond, what) => { if (!cond) problems.push(what); };
expect(lines.length === 12, `expected 12 reply lines, got ${lines.length}`);
expect(byId[0]?.result?.protocolVersion === "2025-06-18", "initialize should echo a supported protocol version");
expect(byId[0]?.result?.serverInfo?.name === "anvil-blender", "serverInfo name");
expect(Array.isArray(byId[1]?.result?.tools) && byId[1].result.tools.map((t) => t.name).join(",") === "blender_ping,blender_run_python", "tools/list names");
expect(JSON.stringify(byId[2]?.result) === "{}", "ping -> {}");
expect(byId[3]?.error?.code === -32602, "unknown tool -> -32602");
expect(byId[4]?.error?.code === -32602, "missing code -> -32602");
expect(byId[5]?.result?.isError === true && /not reachable/.test(byId[5].result.content[0].text), "blender_ping without add-on -> isError with remediation");
expect(byId[6]?.result?.isError === true && /not reachable/.test(byId[6].result.content[0].text), "run_python without add-on -> isError with remediation");
expect(byId[7]?.error?.code === -32601, "unknown method -> -32601");
expect(byId["null"]?.error?.code === -32700, "invalid JSON -> -32700 with id null");
expect(byId[8]?.result?.protocolVersion === "2025-03-26", "unsupported protocol -> 2025-03-26");
expect(batches.length === 1 && batches[0].length === 1 && batches[0][0].id === 9, "batch -> array with one response");
expect(byId[10]?.error?.code === -32600, "missing jsonrpc -> -32600");
expect(stderr.length === 0, `stderr should be silent without ANVIL_DEBUG: ${stderr.slice(0, 100)}`);
console.log(JSON.stringify({ ok: problems.length === 0, replies: lines.length, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
