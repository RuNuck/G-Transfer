#!/usr/bin/env node
/**
 * Anvil local MCP server for Claude Code (stdio transport).
 *
 * Speaks the MCP stdio transport exactly: one JSON-RPC message per line on stdin and
 * stdout, UTF-8, no Content-Length headers. Nothing else is ever written to stdout;
 * diagnostics go to stderr when ANVIL_DEBUG=1.
 *
 * It relays Python to the Anvil Blender add-on ("Anvil: Game Asset MCP") listening on
 * 127.0.0.1:9876 and returns whatever the script assigned to `result`, or the traceback.
 * Scripts come from the Anvil app's HTTP MCP server (forge_create_asset, forge_blender_script,
 * forge_bake_plan); this server only executes.
 *
 * Install with the FULL path of this file (needs Node.js 18+):
 *   claude mcp add anvil-blender -- node "C:\Users\you\anvil\anvil-mcp-server.mjs"
 *   claude mcp add anvil-blender -- node /Users/you/anvil/anvil-mcp-server.mjs
 *
 * Auth: requests carry the token from ~/.anvil/token (created by Connect in Blender) or ANVIL_BLENDER_TOKEN.
 * Environment: ANVIL_BLENDER_HOST (127.0.0.1), ANVIL_BLENDER_PORT (9876), ANVIL_BLENDER_TOKEN,
 * ANVIL_BLENDER_TIMEOUT_MS (600000 overall), ANVIL_BLENDER_IDLE_MS (30000), ANVIL_DEBUG=1.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const HOST = process.env.ANVIL_BLENDER_HOST ?? "127.0.0.1";
const PORT = Number(process.env.ANVIL_BLENDER_PORT ?? 9876);
const DEFAULT_TIMEOUT_MS = Number(process.env.ANVIL_BLENDER_TIMEOUT_MS ?? 600000);
const IDLE_MS = Number(process.env.ANVIL_BLENDER_IDLE_MS ?? 30000); // the add-on sends a keepalive every 5 s while a script runs
const TOKEN_PATH = join(homedir(), ".anvil", "token");
const DEBUG = process.env.ANVIL_DEBUG === "1";

const SERVER_INFO = { name: "anvil-blender", title: "Anvil Blender bridge", version: "2.3.1" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "Local bridge into Blender. Generate scripts with the Anvil HTTP server (forge_create_asset returns blenderScript, " +
  "forge_bake_plan returns blender), then pass that Python as `code` to blender_run_python. Call blender_ping first if unsure " +
  "the add-on is connected. Scripts run on Blender's main thread; assign `result = \"...\"` to return a value.";

const NOT_LISTENING =
  `Blender add-on not reachable at ${HOST}:${PORT}. Open Blender, enable "Anvil: Game Asset MCP" ` +
  "(Edit > Preferences > Add-ons > Install from Disk), open the N-panel > Anvil tab and press Connect, then retry.";

/** The shared secret: ANVIL_BLENDER_TOKEN, else the file the add-on writes on Connect. Read per call so a fresh Connect is picked up. */
function token() {
  if (process.env.ANVIL_BLENDER_TOKEN) return process.env.ANVIL_BLENDER_TOKEN;
  try {
    return readFileSync(TOKEN_PATH, "utf8").trim();
  } catch {
    return "";
  }
}

const TOOLS = [
  {
    name: "blender_ping",
    description: "Check that the Anvil Blender add-on is listening. Returns pong, or what to do if it is not.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "blender_run_python",
    description:
      "Run Python inside the connected Blender (bpy available, main thread, __name__ == '__main__'). Returns the string the " +
      "script assigned to `result` plus any print() output, or the Python traceback as an error result. Scripts may run for " +
      "up to 10 minutes by default (the add-on's Script timeout preference).",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python source to execute in Blender. Assign `result = \"...\"` to return a value." },
        timeout_ms: { type: "integer", minimum: 1000, description: `Overall wait in ms (default ${DEFAULT_TIMEOUT_MS}); the add-on keeps the connection alive while the script runs.` },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
];

function log(...args) {
  if (DEBUG) console.error("[anvil-blender]", ...args);
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message, data) => ({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });
const text = (value, isError = false) => (isError ? { content: [{ type: "text", text: value }], isError: true } : { content: [{ type: "text", text: value }] });

class RelayError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

/** Send one JSON object to the add-on and return its parsed reply. */
function relay(payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn(value);
    };
    // The add-on sends blank lines as keepalives while a script runs; the reply is the first non-blank complete line.
    const completeLine = (raw) => raw.split("\n").slice(0, -1).find((l) => l.trim());
    const finish = (final) => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const line = completeLine(raw) ?? (final ? raw.split("\n").find((l) => l.trim()) : undefined);
      if (line === undefined) {
        if (final) settle(reject, new RelayError("The add-on closed the connection without replying.", "empty"));
        return;
      }
      try {
        settle(resolve, JSON.parse(line));
      } catch {
        settle(resolve, { status: "ok", result: line });
      }
    };
    const socket = net.connect({ host: HOST, port: PORT });
    socket.setTimeout(IDLE_MS);
    const deadline = setTimeout(
      () =>
        settle(
          reject,
          new RelayError(`The script has been running for more than ${Math.round(timeoutMs / 1000)} s; check Blender before retrying.`, "deadline"),
        ),
      timeoutMs,
    );
    socket.on("close", () => clearTimeout(deadline));
    socket.on("connect", () => socket.write(JSON.stringify({ ...payload, token: token() }) + "\n"));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      finish(false);
    });
    socket.on("end", () => finish(true));
    socket.on("close", () => {
      if (chunks.length) finish(true);
      else settle(reject, new RelayError(NOT_LISTENING, "closed"));
    });
    socket.on("timeout", () =>
      settle(
        reject,
        new RelayError(
          `No data from the Blender add-on for ${IDLE_MS} ms (it sends a keepalive every 5 s while a script runs). Check Blender before retrying.`,
          "timeout",
        ),
      ),
    );
    socket.on("error", (err) => {
      if (err && (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "EHOSTUNREACH")) {
        settle(reject, new RelayError(NOT_LISTENING, "unreachable"));
      } else {
        settle(reject, new RelayError(`Connection to the Blender add-on failed: ${err?.message ?? err}`, "socket"));
      }
    });
  });
}

function describeReply(reply) {
  if (!reply || typeof reply !== "object") return text(String(reply));
  const output = typeof reply.output === "string" && reply.output.trim() ? `\n--- output ---\n${reply.output.trimEnd()}` : "";
  if (reply.status === "error") {
    const detail = String(reply.result ?? "(no detail)");
    if (detail.startsWith("timeout")) return text(`${detail}. Split long work into shorter scripts, or raise the add-on's Script timeout preference.${output}`, true);
    if (detail.startsWith("unauthorized")) return text(detail, true);
    return text(`Python raised inside Blender:\n${detail}${output}`, true);
  }
  const value = reply.result;
  if (value === undefined || value === null || value === "") return text(`Script finished. It set no \`result\`; assign result = "..." to return a value.${output}`);
  return text(`${String(value)}${output}`);
}

async function callTool(name, args) {
  if (name === "blender_ping") {
    try {
      const reply = await relay({ type: "ping", id: randomUUID() }, Math.min(DEFAULT_TIMEOUT_MS, 5000));
      if (reply?.result !== "pong") return describeReply(reply);
      const auth =
        reply.auth === "ok"
          ? "token accepted"
          : `token missing or wrong: copy it from ${reply.token_path ?? TOKEN_PATH} (Connect in Blender creates it) into ANVIL_BLENDER_TOKEN, or let this server read the file`;
      return text(`pong from the Anvil add-on ${reply.version ?? ""} at ${HOST}:${PORT}; ${auth}`, reply.auth !== "ok");
    } catch (err) {
      return text(err.message, true);
    }
  }
  if (name === "blender_run_python") {
    if (typeof args.code !== "string" || !args.code.trim()) {
      return fail(null, -32602, "Invalid params: `code` must be a non-empty string of Python.");
    }
    const timeout = Number.isInteger(args.timeout_ms) && args.timeout_ms >= 1000 ? args.timeout_ms : DEFAULT_TIMEOUT_MS;
    try {
      const reply = await relay({ type: "execute", id: randomUUID(), code: args.code }, timeout);
      return describeReply(reply);
    } catch (err) {
      return text(err.message, true);
    }
  }
  return fail(null, -32602, `Unknown tool: ${name}`);
}

function negotiateProtocol(requested) {
  return typeof requested === "string" && SUPPORTED_PROTOCOLS.includes(requested) ? requested : "2025-03-26";
}

/** Handle one JSON-RPC message; returns the response or null for notifications. */
async function handle(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
    const id = message && typeof message === "object" && !Array.isArray(message) && (typeof message.id === "string" || typeof message.id === "number") ? message.id : null;
    return fail(id, -32600, "Invalid Request: expected a JSON-RPC 2.0 object.");
  }
  const { id, method, params } = message;
  const isNotification = id === undefined;
  if (typeof method !== "string") {
    return isNotification ? null : fail(id, -32600, "Invalid Request: missing method.");
  }
  const p = params && typeof params === "object" && !Array.isArray(params) ? params : {};
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: negotiateProtocol(p.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = typeof p.name === "string" ? p.name : "";
      const args = p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {};
      const result = await callTool(name, args);
      if (result && result.error) return fail(id, result.error.code, result.error.message);
      return ok(id, result);
    }
    default:
      if (method.startsWith("notifications/")) return null;
      return isNotification ? null : fail(id, -32601, `Method not found: ${method}`);
  }
}

async function dispatchLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    write(fail(null, -32700, `Parse error: ${err.message}`));
    return;
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return write(fail(null, -32600, "Invalid Request: empty batch."));
    const responses = (await Promise.all(parsed.map((m) => handle(m)))).filter(Boolean);
    if (responses.length) write(responses);
    return;
  }
  const response = await handle(parsed);
  if (response) write(response);
}

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, newline).replace(/\r$/, "").trim();
    pending = pending.slice(newline + 1);
    if (line) dispatchLine(line).catch((err) => log("dispatch failed", err));
  }
});
process.stdin.on("end", () => {
  log("stdin closed, exiting");
  process.exit(0);
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
log(`ready; relaying to ${HOST}:${PORT}, overall timeout ${DEFAULT_TIMEOUT_MS} ms, idle ${IDLE_MS} ms, token ${token() ? "loaded" : "not found at " + TOKEN_PATH}`);
