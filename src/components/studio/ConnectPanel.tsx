import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

const ADDON = "/downloads/anvil_blender_addon.zip";
const SERVER = "/downloads/anvil-mcp-server.mjs";
const EXAMPLE = "/downloads/claude-mcp.example.json";

export function ConnectPanel({ origin }: { origin: string }) {
  const mcpUrl = `${origin}/api/mcp`;
  const httpSnippet = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            anvil: { type: "http", url: mcpUrl },
          },
        },
        null,
        2,
      ),
    [mcpUrl],
  );
  const cli = `claude mcp add --transport http anvil ${mcpUrl}`;
  const localCli = `claude mcp add anvil-blender -- node "<full path to>/anvil-mcp-server.mjs"`;
  const [copied, setCopied] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [probe, setProbe] = useState<string>("");

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNote(null);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setNote("Clipboard unavailable here. Select the text and copy it manually.");
    }
  }

  async function ping() {
    setProbe("Calling initialize + tools/list…");
    try {
      const rpc = async (body: unknown, session?: string | null) => {
        const res = await fetch(mcpUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(session ? { "Mcp-Session-Id": session } : {}),
          },
          body: JSON.stringify(body),
        });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        if (!type.includes("application/json")) throw new Error(`HTTP ${res.status}: not JSON (${type || "no content-type"})`);
        const json = (await res.json()) as { result?: any; error?: { code: number; message: string } };
        if (json.error) throw new Error(`JSON-RPC ${json.error.code}: ${json.error.message}`);
        return { json, session: res.headers.get("Mcp-Session-Id") };
      };
      const init = await rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "anvil-studio", version: "1.0.0" },
        },
      });
      const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, init.session);
      const names = (list.json.result?.tools ?? []).map((t: { name: string }) => t.name);
      const info = init.json.result?.serverInfo ?? {};
      setProbe(`OK ${info.name ?? "?"} v${info.version ?? "?"}\n${names.join(" · ")}`);
    } catch (err) {
      setProbe(`Probe failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Claude Code</p>
      <h2 className="mt-1 text-base font-medium">Point Claude at Anvil</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Remote MCP drives this foundry. Local MCP talks to Blender on your machine through the add-on.
      </p>

      <ol className="mt-4 space-y-3 text-sm">
        <li className="rounded-lg bg-surface-2 p-3">
          <p className="font-medium">1. Remote HTTP MCP</p>
          <p className="mt-1 text-xs text-muted">Works from Claude Code without Blender. Returns production scripts and specs.</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-bg p-2 font-mono text-[11px] text-fg">{cli}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="quiet" onClick={() => copy("cli", cli)}>
              {copied === "cli" ? "Copied" : "Copy command"}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => copy("json", httpSnippet)}>
              {copied === "json" ? "Copied" : "Copy JSON"}
            </Button>
          </div>
        </li>
        <li className="rounded-lg bg-surface-2 p-3">
          <p className="font-medium">2. Blender add-on</p>
          <p className="mt-1 text-xs text-muted">
            Blender 4.2+ · Edit → Preferences → Add-ons → Install from Disk → pick the zip → enable “Anvil: Game Asset MCP” → N-panel → Anvil → Connect. Nothing listens until you press Connect; it writes a token to ~/.anvil/token that the local server reads. The zip also carries the part kit (rifle, shotgun) and the surfacing recipes the generated scripts use; if you installed the older anvil_blender_addon.py, remove it from your add-ons folder first.
          </p>
          <a className="mt-2 inline-flex h-8 items-center rounded-md bg-bg px-3 text-xs hover:bg-surface-3" href={ADDON} download>
            Download add-on
          </a>
        </li>
        <li className="rounded-lg bg-surface-2 p-3">
          <p className="font-medium">3. Local stdio MCP</p>
          <p className="mt-1 text-xs text-muted">
            Runs Python in Blender through the add-on (blender_run_python, blender_ping) using the token from ~/.anvil/token. Needs Node.js 18+. Save the file somewhere permanent and use its full path.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-bg p-2 font-mono text-[11px]">{localCli}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="quiet" onClick={() => copy("local", localCli)}>
              {copied === "local" ? "Copied" : "Copy command"}
            </Button>
            <a className="inline-flex h-8 items-center rounded-md bg-bg px-3 text-xs hover:bg-surface-3" href={SERVER} download>
              MCP server
            </a>
            <a className="inline-flex h-8 items-center rounded-md bg-bg px-3 text-xs hover:bg-surface-3" href={EXAMPLE} download>
              Example JSON
            </a>
          </div>
        </li>
      </ol>
      {note ? <p className="mt-2 text-xs text-warn">{note}</p> : null}

      <div className="mt-4">
        <Button variant="outline" onClick={ping}>
          Probe this MCP
        </Button>
        {probe ? (
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-mono text-[11px] text-muted">
            {probe}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
