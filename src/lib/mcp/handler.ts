import {
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  corsHeaders,
  fail,
  ok,
  type JsonRpcMessage,
} from "./protocol";
import { InvalidParams, PROMPTS, RESOURCES, TOOLS, callTool, promptBody, resourceBody } from "./tools";

/** Bodies larger than this are refused before parsing; briefs are capped separately in tools.ts. */
const MAX_BODY_BYTES = 1_000_000;
const MAX_BATCH = 50;

function isMessage(value: unknown): value is JsonRpcMessage {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (value as JsonRpcMessage).jsonrpc === "2.0";
}

function initializeResult() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
      prompts: { listChanged: false },
    },
    serverInfo: {
      name: SERVER_NAME,
      title: "Anvil — Production Game Asset MCP",
      version: SERVER_VERSION,
    },
    instructions:
      "Anvil forges production game assets. Read anvil://guide/agent first. Plan = forge_create_asset (spec/script only). Run = forge_run_asset / forge_scene + forge_job_status; never declare success without forge_validate (godot_prod). Scene = compose kits (anvil://schemas/scene-spec), not a mega-mesh. WeaponGraph schema: anvil://schemas/weapon-graph. blender_execute on this HTTP server never runs code — use blender_run_python on local anvil-blender (anvil://blender/addon). Also: anvil://pipeline/godot.",
  };
}

/**
 * Handle one JSON-RPC message. Notifications (no id) never get a reply, whatever the
 * method. Tool argument problems are -32602; anything thrown by a tool is -32603 for
 * that message only, so the rest of a batch still gets its answers.
 */
export function dispatch(message: JsonRpcMessage): JsonRpcMessage | null {
  const { id, method, params } = message;
  const isNotification = id === undefined;
  const reply = (response: JsonRpcMessage) => (isNotification ? null : response);
  if (typeof method !== "string" || !method) return reply(fail(id, -32600, "Invalid request: missing method"));
  const p = (params && typeof params === "object" && !Array.isArray(params) ? params : {}) as Record<string, unknown>;

  try {
    switch (method) {
      case "initialize":
        return reply(ok(id, initializeResult()));
      case "ping":
        return reply(ok(id, {}));
      case "tools/list":
        return reply(ok(id, { tools: TOOLS }));
      case "tools/call": {
        const name = typeof p.name === "string" ? p.name : "";
        const args = (p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {}) as Record<string, unknown>;
        const result = callTool(name, args);
        if (!result) return reply(fail(id, -32602, `Unknown tool: ${name || "(missing name)"}`));
        return reply(ok(id, result));
      }
      case "resources/list":
        return reply(ok(id, { resources: RESOURCES }));
      case "resources/templates/list":
        return reply(ok(id, { resourceTemplates: [] }));
      case "resources/read": {
        if (typeof p.uri !== "string" || !p.uri) return reply(fail(id, -32602, "Invalid params: uri is required"));
        const body = resourceBody(p.uri);
        if (!body) return reply(fail(id, -32002, `Unknown resource: ${p.uri}`));
        return reply(ok(id, { contents: [{ uri: p.uri, mimeType: body.mimeType, text: body.text }] }));
      }
      case "prompts/list":
        return reply(ok(id, { prompts: PROMPTS }));
      case "prompts/get": {
        if (typeof p.name !== "string" || !p.name) return reply(fail(id, -32602, "Invalid params: name is required"));
        const known = PROMPTS.some((item) => item.name === p.name);
        if (!known) return reply(fail(id, -32602, `Unknown prompt: ${p.name}`));
        const args = (p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {}) as Record<string, unknown>;
        return reply(ok(id, promptBody(p.name, args)));
      }
      default:
        if (method.startsWith("notifications/")) return null;
        return reply(fail(id, -32601, `Method not found: ${method}`));
    }
  } catch (err) {
    if (err instanceof InvalidParams) return reply(fail(id, -32602, `Invalid params: ${err.message}`));
    return reply(fail(id, -32603, `Internal error: ${err instanceof Error ? err.message : String(err)}`));
  }
}

function hostOf(value: string) {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname === "0.0.0.0";
}

export async function handleMcpHttp(request: Request): Promise<Response> {
  const headers = corsHeaders();

  // DNS-rebinding guard for local servers: a page on another site must not drive a loopback server.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (origin && isLoopback(hostOf(host)) && !isLoopback(hostOf(origin))) {
    return new Response("Forbidden: cross-site requests to a local MCP server are not allowed.", { status: 403, headers });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method === "DELETE") {
    // Stateless: there is no session to end. 204 keeps well-behaved clients quiet.
    return new Response(null, { status: 204, headers });
  }
  if (request.method === "GET") {
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/event-stream")) {
      // No server-initiated messages: the spec's answer is 405, which clients treat as "no stream".
      return new Response("This server does not open server-to-client streams. Send JSON-RPC by POST.", {
        status: 405,
        headers: { ...headers, Allow: "POST, OPTIONS, DELETE" },
      });
    }
    return Response.json(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        protocol: PROTOCOL_VERSION,
        transport: "streamable-http",
        tools: TOOLS.map((tool) => tool.name),
      },
      { headers },
    );
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { ...headers, Allow: "GET, POST, OPTIONS, DELETE" } });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return new Response(`Payload too large: bodies are capped at ${MAX_BODY_BYTES} bytes.`, { status: 413, headers });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return new Response(`Payload too large: bodies are capped at ${MAX_BODY_BYTES} bytes.`, { status: 413, headers });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400, headers });
  }

  if (Array.isArray(body)) {
    if (body.length === 0) return Response.json(fail(null, -32600, "Invalid request: empty batch"), { status: 400, headers });
    if (body.length > MAX_BATCH) {
      return Response.json(fail(null, -32600, `Invalid request: batches are capped at ${MAX_BATCH} messages`), { status: 400, headers });
    }
  }
  const messages = Array.isArray(body) ? body : [body];
  const responses: JsonRpcMessage[] = [];
  for (const item of messages) {
    if (!isMessage(item)) {
      responses.push(fail(null, -32600, "Invalid request: expected a JSON-RPC 2.0 object"));
      continue;
    }
    const result = dispatch(item);
    if (result) responses.push(result);
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202, headers });
  }
  const payload = Array.isArray(body) ? responses : responses[0];
  return Response.json(payload, { headers });
}
