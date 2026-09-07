// HTTP MCP transport test. node test-http.mjs [mcpUrl]
const MCP = process.argv[2] ?? "http://localhost:8080/api/mcp";
const problems = [];
const expect = (cond, what) => { if (!cond) problems.push(what); };
const json = { "content-type": "application/json", accept: "application/json" };
const post = (body, headers = {}) => fetch(MCP, { method: "POST", headers: { ...json, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });

// GET stream -> 405; plain GET -> info JSON; other methods -> 405, never the SPA page.
const sse = await fetch(MCP, { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(5000) });
expect(sse.status === 405 && /POST/.test(sse.headers.get("allow") ?? ""), `GET event-stream -> ${sse.status}`);
const info = await fetch(MCP, { headers: { accept: "application/json" } });
expect(info.status === 200 && (await info.json()).transport === "streamable-http", "plain GET info");
for (const method of ["PUT", "PATCH"]) {
  const r = await fetch(MCP, { method, headers: json, body: "{}" });
  expect(r.status === 405 && !(r.headers.get("content-type") ?? "").includes("text/html"), `${method} -> ${r.status} ${r.headers.get("content-type")}`);
}
const head = await fetch(MCP, { method: "HEAD" });
expect(head.status === 200 || head.status === 405, `HEAD -> ${head.status}`);

// No session header is minted.
const init = await post(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
expect(init.status === 200 && !init.headers.get("mcp-session-id"), `session header minted: ${init.headers.get("mcp-session-id")}`);
expect((await init.json()).result.protocolVersion === "2025-03-26", "initialize protocol version");

// Notifications and id-less requests: 202, no body.
for (const body of [{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", method: "notifications/whatever" }, { jsonrpc: "2.0", method: "tools/list" }]) {
  const r = await post(body);
  expect(r.status === 202 && (await r.text()) === "", `notification ${body.method} -> ${r.status}`);
}

// A throwing message inside a batch: its own -32603, the others answered.
const batch = await post([rpc("ping", {}, 1), rpc("tools/call", { name: "forge_create_asset", arguments: { brief: { toString: 1 } } }, 2), rpc("ping", {}, 3)]);
const batchBody = await batch.json();
expect(batch.status === 200 && Array.isArray(batchBody) && batchBody.length === 3, `batch -> ${batch.status} ${JSON.stringify(batchBody).slice(0, 120)}`);
const second = Array.isArray(batchBody) ? batchBody.find((m) => m.id === 2) : null;
expect(second && second.error && (second.error.code === -32602 || second.error.code === -32603), `throwing message code: ${JSON.stringify(second?.error)}`);
expect(Array.isArray(batchBody) && batchBody.filter((m) => m.result && m.id !== 2).length === 2, "other batch messages answered");

// Strict validation -> -32602 with a message naming the field.
const cases = [
  [{ name: "forge_create_asset", arguments: { brief: "crate", engine: "unreal5" } }, /engine/],
  [{ name: "forge_create_asset", arguments: { brief: "crate", kind: "dragon" } }, /kind/],
  [{ name: "forge_create_asset", arguments: {} }, /brief/],
  [{ name: "forge_create_asset", arguments: { brief: "x".repeat(5000) } }, /4000/],
  [{ name: "forge_kit_module", arguments: { theme: "stone", grid: "big" } }, /grid/],
  [{ name: "forge_kit_module", arguments: {} }, /theme/],
  [{ name: "no_such_tool", arguments: {} }, /Unknown tool/],
];
for (const [params, re] of cases) {
  const r = await post(rpc("tools/call", params));
  const b = await r.json();
  expect(r.status === 200 && b.error?.code === -32602 && re.test(b.error.message), `${JSON.stringify(params).slice(0, 70)} -> ${JSON.stringify(b.error)}`);
}
const okCall = await (await post(rpc("tools/call", { name: "forge_create_asset", arguments: { brief: "wooden crate", engine: "godot", kind: "crate" } }))).json();
expect(okCall.result?.content?.[0]?.text?.includes('"engine": "godot"'), "valid call still works");
const missingUri = await (await post(rpc("resources/read", {}))).json();
expect(missingUri.error?.code === -32602, `missing uri -> ${JSON.stringify(missingUri.error)}`);
const unknownUri = await (await post(rpc("resources/read", { uri: "anvil://nope" }))).json();
expect(unknownUri.error?.code === -32002, `unknown uri -> ${JSON.stringify(unknownUri.error)}`);
const missingPrompt = await (await post(rpc("prompts/get", {}))).json();
expect(missingPrompt.error?.code === -32602, `missing prompt name -> ${JSON.stringify(missingPrompt.error)}`);
const missingArg = await (await post(rpc("prompts/get", { name: "hero_weapon", arguments: {} }))).json();
expect(missingArg.error?.code === -32602 && /weapon/.test(missingArg.error.message), `missing prompt arg -> ${JSON.stringify(missingArg.error)}`);

// Size caps.
const big = await post(JSON.stringify(rpc("ping", { pad: "x".repeat(1_100_000) })));
expect(big.status === 413, `1.1 MB body -> ${big.status}`);
const hugeBatch = await post(Array.from({ length: 51 }, (_, i) => rpc("ping", {}, i)));
expect(hugeBatch.status === 400 && (await hugeBatch.json()).error?.code === -32600, `51-message batch -> ${hugeBatch.status}`);
const emptyBatch = await post([]);
expect(emptyBatch.status === 400, `empty batch -> ${emptyBatch.status}`);

// Origin guard for a loopback server.
const evil = await post(rpc("ping", {}), { origin: "http://evil.example" });
expect(evil.status === 403, `foreign origin on loopback -> ${evil.status}`);
const same = await post(rpc("ping", {}), { origin: "http://localhost:8080" });
expect(same.status === 200, `loopback origin -> ${same.status}`);

console.log(JSON.stringify({ ok: problems.length === 0, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
