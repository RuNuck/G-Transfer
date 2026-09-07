import type { McpLogEntry } from "@/lib/assets/types";

export function McpLog({ logs }: { logs: McpLogEntry[] }) {
  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 items-center justify-between border-b border-border px-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">MCP</p>
        <p className="font-mono text-[10px] text-subtle">{logs.length} events</p>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {logs.map((log) => (
          <li key={log.id} className="border-b border-border/60 py-1.5 last:border-0">
            <p className="flex gap-2 font-mono text-[11px]">
              <span className="text-subtle">{log.direction}</span>
              <span className="text-fg">{log.method}</span>
            </p>
            <p className="truncate text-[11px] text-muted">{log.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
