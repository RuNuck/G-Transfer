import { engineNotes, pipelineFor } from "@/lib/assets/pipeline";
import type { AssetSpec } from "@/lib/assets/types";
import { cn } from "@/lib/utils";

export function PipelinePanel({ spec }: { spec: AssetSpec }) {
  const stages = pipelineFor(spec);
  const notes = engineNotes(spec);
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Pipeline</p>
      <h2 className="mt-1 text-base font-medium">Brief → engine</h2>
      <ol className="mt-4 space-y-2">
        {stages.map((stage, i) => (
          <li key={stage.id} className="flex gap-3">
            <span className="font-mono text-[11px] tabular-nums text-subtle">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <p className="text-sm">
                {stage.label}
                <span
                  className={cn(
                    "ml-2 font-mono text-[10px] uppercase",
                    stage.status === "done" ? "text-ok" : "text-muted",
                  )}
                >
                  {stage.status}
                </span>
              </p>
              <p className="text-xs text-muted">{stage.note}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">{spec.engine} notes</p>
      <ul className="mt-2 space-y-1.5">
        {notes.map((note) => (
          <li key={note} className="text-xs leading-relaxed text-muted">
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}
