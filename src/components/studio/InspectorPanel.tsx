import { useEffect, useState } from "react";
import { blenderScript } from "@/lib/assets/blender-script";
import { downloadGlb, downloadText, exportGlb } from "@/lib/assets/export-gltf";
import { collisionName, folderHint, meshName, textureSet } from "@/lib/assets/naming";
import { qcFor, texelSheet } from "@/lib/assets/pipeline";
import type { AssetSpec, LodLevel, ViewMode } from "@/lib/assets/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function InspectorPanel({
  spec,
  lod,
  viewMode,
  onLod,
  onView,
}: {
  spec: AssetSpec;
  lod: LodLevel;
  viewMode: ViewMode;
  onLod: (lod: LodLevel) => void;
  onView: (mode: ViewMode) => void;
}) {
  const tex = textureSet(spec);
  const qc = qcFor(spec);
  const mesh = meshName(spec);
  // Actual triangle counts per LOD from the same builder the viewport and GLB use (client only).
  const [lodTris, setLodTris] = useState<number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLodTris(null);
    void import("@/lib/assets/builders").then(({ buildAsset, countTriangles, disposeGroup }) => {
      if (cancelled) return;
      setLodTris(
        ([0, 1, 2] as LodLevel[]).map((level) => {
          const group = buildAsset(spec, level);
          const count = countTriangles(group);
          disposeGroup(group);
          return count;
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [spec]);

  async function onGlb() {
    const buf = await exportGlb(spec);
    downloadGlb(spec, buf);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <section className="border-b border-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Mesh</p>
        <h2 className="mt-1 text-base font-medium">{mesh}</h2>
        <p className="mt-1 text-xs text-muted">{folderHint(spec)}</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {(["lit", "clay", "wire", "unlit"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onView(mode)}
              className={cn(
                "h-10 rounded-sm px-2.5 text-xs capitalize lg:h-8",
                viewMode === mode ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1">
          {([0, 1, 2] as LodLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onLod(level)}
              className={cn(
                "h-10 flex-1 rounded-sm text-xs font-mono lg:h-8",
                lod === level ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
              )}
            >
              LOD{level} · {lodTris ? lodTris[level].toLocaleString() : "…"} / {spec.triangleBudget[`lod${level}` as const]}
            </button>
          ))}
        </div>
      </section>

      <section className="border-b border-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">PBR</p>
        <ul className="mt-2 flex flex-col gap-2">
          {spec.materials.map((mat) => (
            <li key={mat.name} className="flex items-center gap-2">
              <span
                className="size-4 rounded-sm shadow-[var(--shadow-border)]"
                style={{ background: mat.albedo }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{mat.name}</p>
                <p className="font-mono text-[10px] text-muted">
                  R {mat.roughness.toFixed(2)} · M {mat.metalness.toFixed(2)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted">
          {tex.albedo} · {tex.normal} · {tex.packed}
        </p>
      </section>

      <section className="border-b border-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Texel</p>
        <ul className="mt-2 space-y-1 font-mono text-[11px] tabular-nums text-muted">
          {texelSheet(spec).map((face) => (
            <li key={face.name} className="flex justify-between">
              <span>{face.name}</span>
              <span>
                {face.pxW}×{face.pxH}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Collision {collisionName(spec)} · {spec.collision}</p>
      </section>

      <section className="border-b border-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">QC</p>
        <ul className="mt-2 space-y-1.5">
          {qc.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-xs">
              <span className={item.kind === "note" ? "text-subtle" : item.ok ? "text-ok" : "text-warn"}>
                {item.kind === "note" ? "NOTE" : item.ok ? "PASS" : "FLAG"}
              </span>
              <span className="text-muted">{item.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2 px-4 py-3">
        <Button onClick={onGlb}>Download GLB</Button>
        <Button
          variant="outline"
          onClick={() => downloadText(`${mesh}.py`, blenderScript(spec), "text/x-python")}
        >
          Blender Python
        </Button>
      </section>
    </div>
  );
}
