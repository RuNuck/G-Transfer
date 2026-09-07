import { lazy, Suspense, useEffect, useState } from "react";
import { Hammer, Box, Cable, Layers, ScrollText } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { CATALOG } from "@/lib/assets/catalog";
import { ENGINES, ENGINE_LABEL, type Category } from "@/lib/assets/types";
import { localForge, useForge } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CatalogPanel } from "./CatalogPanel";
import { ConnectPanel } from "./ConnectPanel";
import { InspectorPanel } from "./InspectorPanel";
import { McpLog } from "./McpLog";
import { PipelinePanel } from "./PipelinePanel";

const Viewport = lazy(() => import("./Viewport").then((mod) => ({ default: mod.Viewport })));

const TABS = [
  { id: "catalog" as const, label: "Kit", icon: Box },
  { id: "inspect" as const, label: "Inspect", icon: Layers },
  { id: "pipeline" as const, label: "Pipeline", icon: Hammer },
  { id: "connect" as const, label: "Connect", icon: Cable },
];
// Phones have no room for the desktop log strip, so the log is a sheet of its own there.
const MOBILE_TABS = [...TABS, { id: "log" as const, label: "Log", icon: ScrollText }];
type MobileTab = (typeof MOBILE_TABS)[number]["id"];

export function Studio() {
  // Select what the shell renders; the log has its own subscriber so a log line
  // does not re-render the whole studio.
  const store = useForge(
    useShallow((state) => ({
      engine: state.engine,
      brief: state.brief,
      spec: state.spec,
      library: state.library,
      lod: state.lod,
      viewMode: state.viewMode,
      panel: state.panel,
      forging: state.forging,
      origin: state.origin,
      setEngine: state.setEngine,
      setBrief: state.setBrief,
      setPanel: state.setPanel,
      setLod: state.setLod,
      setViewMode: state.setViewMode,
      pickKind: state.pickKind,
      applySpec: state.applySpec,
      loadFromLibrary: state.loadFromLibrary,
      removeFromLibrary: state.removeFromLibrary,
      pushLog: state.pushLog,
      setForging: state.setForging,
    })),
  );
  const [category, setCategory] = useState<Category | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [mobileSheet, setMobileSheet] = useState<MobileTab | null>(null);

  useEffect(() => {
    // Rehydrate BEFORE the first write: persist saves the whole partialized state on
    // every set, so writing first would replace the saved state with the defaults.
    // localStorage hydration completes synchronously, and the store's storage
    // also refuses writes until hydration has happened.
    void useForge.persist.rehydrate();
    const origin = window.location.origin;
    const state = useForge.getState();
    state.setOrigin(origin);
    state.pushLog({
      direction: "sys",
      method: "resources/list",
      summary: `${origin}/api/mcp`,
    });
  }, []);

  const spec = store.spec;

  function forge() {
    if (!store.brief.trim() || store.forging) return;
    setError(null);
    store.setForging(true);
    store.pushLog({ direction: "in", method: "forge_create_asset", summary: store.brief });
    try {
      const next = localForge(store.brief, store.engine);
      store.pushLog({
        direction: "out",
        method: "forge_create_asset",
        summary: `${next.name} · ${next.kind} · ${next.engine}`,
      });
      store.applySpec(next);
      setMobileSheet(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Forge failed");
    } finally {
      store.setForging(false);
    }
  }

  return (
    <div className="relative flex h-dvh min-h-0 flex-col bg-bg text-fg">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
        <AnvilMark />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-none">Anvil</p>
          <p className="hidden text-[11px] text-muted sm:block">Production game asset MCP</p>
        </div>
        <div className="ml-auto flex items-center gap-1 overflow-x-auto">
          {ENGINES.map((engine) => (
            <button
              key={engine}
              type="button"
              onClick={() => store.setEngine(engine)}
              className={cn(
                "h-11 rounded-sm px-2 text-[11px] font-medium lg:h-8",
                store.engine === engine ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
              )}
            >
              {ENGINE_LABEL[engine]}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hidden w-72 shrink-0 border-r border-border lg:flex lg:flex-col">
          <SideTabs panel={store.panel} onPanel={store.setPanel} />
          <div className="min-h-0 flex-1">
            {store.panel === "catalog" ? (
              <CatalogPanel
                active={spec?.kind}
                category={category}
                onCategory={setCategory}
                library={store.library}
                activeId={spec?.id}
                onLoad={store.loadFromLibrary}
                onRemove={store.removeFromLibrary}
                onPick={(kind) => {
                  store.pickKind(kind);
                  store.pushLog({ direction: "in", method: "forge_list_prototypes", summary: kind });
                }}
              />
            ) : null}
            {store.panel === "inspect" && spec ? (
              <InspectorPanel
                spec={spec}
                lod={store.lod}
                viewMode={store.viewMode}
                onLod={store.setLod}
                onView={store.setViewMode}
              />
            ) : null}
            {store.panel === "pipeline" && spec ? <PipelinePanel spec={spec} /> : null}
            {store.panel === "connect" ? <ConnectPanel origin={store.origin || ""} /> : null}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <form
            className="flex shrink-0 flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              forge();
            }}
          >
            <input
              aria-label="Brief"
              value={store.brief}
              onChange={(e) => store.setBrief(e.target.value)}
              placeholder="Sci-fi crate, 0.8 m, Unreal, weathered hull…"
              className="h-11 min-w-0 flex-1 rounded-md bg-surface-2 px-3 text-sm text-fg outline-none ring-ring/60 placeholder:text-subtle focus:ring-2"
            />
            <Button type="submit" size="lg" disabled={store.forging}>
              {store.forging ? "Forging…" : "Forge"}
            </Button>
          </form>
          {error ? <p className="px-3 py-2 text-xs text-danger">{error}</p> : null}
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2 lg:hidden">
            {CATALOG.map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => store.pickKind(item.kind)}
                className={cn(
                  "h-11 shrink-0 rounded-sm px-3 text-xs",
                  spec?.kind === item.kind ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
                )}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {spec ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center bg-bg text-sm text-muted">
                    Lighting viewport
                  </div>
                }
              >
                <Viewport spec={spec} lod={store.lod} viewMode={store.viewMode} />
              </Suspense>
            ) : null}
          </div>
          <div className="hidden h-36 shrink-0 border-t border-border lg:block">
            <McpLogPanel />
          </div>
        </main>

        <aside className="hidden w-80 shrink-0 border-l border-border xl:block">
          {spec ? (
            <InspectorPanel
              spec={spec}
              lod={store.lod}
              viewMode={store.viewMode}
              onLod={store.setLod}
              onView={store.setViewMode}
            />
          ) : null}
        </aside>
      </div>

      <nav className="flex shrink-0 border-t border-border lg:hidden">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMobileSheet((cur) => (cur === tab.id ? null : tab.id))}
            className={cn(
              "flex h-14 min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
              mobileSheet === tab.id ? "text-fg" : "text-muted",
            )}
          >
            <tab.icon className="size-4" strokeWidth={1.75} />
            {tab.label}
          </button>
        ))}
      </nav>

      {mobileSheet ? (
        <div className="absolute inset-x-0 bottom-14 top-12 z-10 flex flex-col bg-surface lg:hidden">
          <div className="flex h-11 items-center justify-between border-b border-border px-3">
            <p className="text-sm font-medium">{MOBILE_TABS.find((t) => t.id === mobileSheet)?.label}</p>
            <button type="button" className="h-11 px-3 text-sm text-muted" onClick={() => setMobileSheet(null)}>
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {mobileSheet === "catalog" ? (
              <CatalogPanel
                active={spec?.kind}
                category={category}
                onCategory={setCategory}
                library={store.library}
                activeId={spec?.id}
                onLoad={store.loadFromLibrary}
                onRemove={store.removeFromLibrary}
                onPick={(kind) => {
                  store.pickKind(kind);
                  setMobileSheet(null);
                }}
              />
            ) : null}
            {mobileSheet === "inspect" && spec ? (
              <InspectorPanel
                spec={spec}
                lod={store.lod}
                viewMode={store.viewMode}
                onLod={store.setLod}
                onView={store.setViewMode}
              />
            ) : null}
            {mobileSheet === "pipeline" && spec ? <PipelinePanel spec={spec} /> : null}
            {mobileSheet === "connect" ? <ConnectPanel origin={store.origin || ""} /> : null}
            {mobileSheet === "log" ? <McpLogPanel /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SideTabs({
  panel,
  onPanel,
}: {
  panel: (typeof TABS)[number]["id"];
  onPanel: (id: (typeof TABS)[number]["id"]) => void;
}) {
  return (
    <div className="flex border-b border-border p-2">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onPanel(tab.id)}
          className={cn(
            "flex h-9 flex-1 items-center justify-center rounded-sm text-[11px] font-medium",
            panel === tab.id ? "bg-surface-3 text-fg" : "text-muted hover:text-fg",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function McpLogPanel() {
  const logs = useForge((state) => state.logs);
  return <McpLog logs={logs} />;
}

function AnvilMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-7 text-accent" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 7.2h16v2.1H4zm2.2 2.1h11.6v1.4c0 1.2-.7 2.3-1.8 2.8l1.4 4.3H7.6l1.4-4.3A3.15 3.15 0 0 1 7.2 10.7V9.3zM9 19.2h6v1.6H9z"
      />
    </svg>
  );
}
