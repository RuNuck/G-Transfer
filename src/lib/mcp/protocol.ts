export const PROTOCOL_VERSION = "2025-03-26";
export const SERVER_NAME = "anvil";
export const SERVER_VERSION = "2.9.0";

export type JsonRpcId = string | number | null;
export type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

export type McpPrompt = {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
};

export function ok(id: JsonRpcId | undefined, result: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function fail(id: JsonRpcId | undefined, code: number, message: string, data?: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

export function corsHeaders(extra?: Record<string, string>) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "MCP-Protocol-Version",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    ...extra,
  };
}
