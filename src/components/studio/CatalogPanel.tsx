import { CATALOG } from "@/lib/assets/catalog";
import { ENGINE_LABEL, type AssetKind, type AssetSpec, type Category } from "@/lib/assets/types";
import { cn } from "@/lib/utils";

const CATS: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "props", label: "Props" },
  { id: "weapons", label: "Weapons" },
  { id: "architecture", label: "Arch" },
  { id: "vehicles", label: "Vehicles" },
  { id: "characters", label: "Chars" },
];

export function CatalogPanel({
  active,
  category,
  onCategory,
  onPick,
  library,
  activeId,
  onLoad,
  onRemove,
}: {
  active?: AssetKind;
  category: Category | "all";
  onCategory: (c: Category | "all") => void;
  onPick: (kind: AssetKind) => void;
  library: AssetSpec[];
  activeId?: string;
  onLoad: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const items = CATALOG.filter((item) => category === "all" || item.category === category);
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 overflow-x-auto px-3 pb-2 pt-3">
        {CATS.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => onCategory(cat.id)}
            className={cn(
              "h-11 shrink-0 rounded-sm px-2.5 text-xs font-medium transition-colors duration-150 lg:h-8",
              category === cat.id ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const on = item.kind === active;
            return (
              <li key={item.kind}>
                <button
                  type="button"
                  onClick={() => onPick(item.kind)}
                  className={cn(
                    "w-full rounded-md px-3 py-2.5 text-left transition-colors duration-150",
                    on ? "bg-surface-3 text-fg" : "text-fg hover:bg-surface-2",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="font-mono text-[10px] tabular-nums text-subtle">
                      {item.triangleBudget.lod0}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{item.blurb}</p>
                </button>
              </li>
            );
          })}
        </ul>
        {library.length > 0 ? (
          <section className="mt-3 border-t border-border pt-2" data-testid="library">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Saved</p>
            <ul className="mt-1 flex flex-col gap-1">
              {library.map((item) => (
                <li
                  key={item.id}
                  className={cn("flex items-center gap-1 rounded-md pl-2 text-xs", item.id === activeId ? "bg-surface-3" : "")}
                >
                  <button
                    type="button"
                    onClick={() => onLoad(item.id)}
                    className="min-w-0 flex-1 truncate py-2.5 text-left text-fg"
                    title={item.brief}
                  >
                    {item.name} <span className="text-subtle">· {ENGINE_LABEL[item.engine]}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name} from the library`}
                    onClick={() => onRemove(item.id)}
                    className="h-11 px-3 text-subtle hover:text-danger lg:h-8"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
