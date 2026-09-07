import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Grid, OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildAsset, countTriangles, disposeGroup } from "@/lib/assets/builders";
import { fetchForged, forgedUrl, matchForged, type ForgedAsset, type ForgedListing } from "@/lib/assets/forged";
import { meshName } from "@/lib/assets/naming";
import type { AssetSpec, LodLevel, ViewMode } from "@/lib/assets/types";

/** The lit look of a material, captured once so every view mode can be undone. */
type LitSnapshot = {
  color: THREE.Color;
  map: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  emissive: THREE.Color;
  emissiveIntensity: number;
};

function litMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial | null {
  const lit = (mesh.userData.anvilLit ?? mesh.material) as THREE.Material;
  return lit instanceof THREE.MeshStandardMaterial ? lit : null;
}

function applyView(group: THREE.Object3D, mode: ViewMode) {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mat = litMaterial(obj);
    if (!mat) return;
    const saved: LitSnapshot = (mat.userData.anvilOriginal ??= {
      color: mat.color.clone(),
      map: mat.map,
      roughnessMap: mat.roughnessMap,
      roughness: mat.roughness,
      metalness: mat.metalness,
      envMapIntensity: mat.envMapIntensity,
      emissive: mat.emissive.clone(),
      emissiveIntensity: mat.emissiveIntensity,
    });
    // Start from the lit look every time, so switching back to Lit restores everything.
    mat.color.copy(saved.color);
    mat.map = saved.map;
    mat.roughnessMap = saved.roughnessMap;
    mat.roughness = saved.roughness;
    mat.metalness = saved.metalness;
    mat.envMapIntensity = saved.envMapIntensity;
    mat.emissive.copy(saved.emissive);
    mat.emissiveIntensity = saved.emissiveIntensity;
    mat.wireframe = false;
    if (mode === "clay" || mode === "wire") {
      mat.map = null;
      mat.roughnessMap = null;
      mat.color.set(mode === "wire" ? "#d7d4cc" : "#c4b7a4");
      mat.metalness = 0.04;
      mat.roughness = 0.72;
      mat.emissive.set("#000000");
      mat.emissiveIntensity = 0;
      mat.envMapIntensity = 0.2;
      mat.wireframe = mode === "wire";
    }
    mat.needsUpdate = true;
    if (mode === "unlit") {
      // Unlit means unlit: swap in a MeshBasicMaterial showing the albedo with no lighting.
      obj.userData.anvilLit = mat;
      const unlit = (obj.userData.anvilUnlit ??= new THREE.MeshBasicMaterial({
        transparent: mat.transparent,
        opacity: mat.opacity,
      })) as THREE.MeshBasicMaterial;
      unlit.color.copy(saved.color);
      unlit.map = saved.map;
      unlit.needsUpdate = true;
      obj.material = unlit;
    } else {
      obj.material = mat;
    }
  });
}

function spanOf(spec: AssetSpec) {
  return Math.max(spec.dimensions.x, spec.dimensions.y, spec.dimensions.z, 0.12);
}

function gridStep(span: number) {
  const steps = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2];
  const target = span / 6;
  return steps.find((s) => s >= target) ?? 2;
}

/** A GLB carries more than the render mesh: the LOD chain and, for engines that name collision by
 * prefix, a collision proxy. Show one LOD and hide the rest rather than drawing them on top. */
const COLLISION_PREFIXES = ["UBX_", "UCX_", "USP_", "UCP_", "COL_"];
/** Godot reads collision from a name suffix: <mesh>_col-convcolonly and friends. The importer
 * strips it, but the GLB keeps the full name, and we are reading the GLB directly. */
const GODOT_COLLISION = /-(conv)?col(only)?$/i;

function isCollisionNode(name: string) {
  return GODOT_COLLISION.test(name) || name.endsWith("_col") || COLLISION_PREFIXES.some((p) => name.startsWith(p));
}

function lodOf(name: string): LodLevel | null {
  const match = /_LOD([12])$/.exec(name);
  return match ? (Number(match[1]) as LodLevel) : null;
}

/** The glTF node a mesh came from. A node with several materials is loaded as a Group of one Mesh
 * per primitive, named `<node>_0`, `<node>_1` and so on, which moves the LOD and collision suffixes
 * off the mesh's own name. */
function nodeNameOf(mesh: THREE.Object3D) {
  const parent = mesh.parent;
  if (parent && parent.name && mesh.name.startsWith(`${parent.name}_`)) {
    const tail = mesh.name.slice(parent.name.length + 1);
    if (/^\d+$/.test(tail)) return parent.name;
  }
  return mesh.name;
}

/** Show the requested LOD, or the base mesh when the file has no LOD chain (Godot builds its own). */
function selectLod(root: THREE.Object3D, wanted: LodLevel) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) meshes.push(obj);
  });
  const renderable = meshes.filter((m) => !isCollisionNode(nodeNameOf(m)));
  const atLevel = (level: LodLevel) =>
    renderable.filter((m) => (lodOf(nodeNameOf(m)) ?? 0) === level);
  const shown = atLevel(wanted).length ? atLevel(wanted) : atLevel(0);
  const set = new Set(shown);
  for (const mesh of meshes) mesh.visible = set.has(mesh);
  return { shown, missingLod: wanted !== 0 && !atLevel(wanted).length };
}

function disposeLoaded(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      mat.dispose();
    }
  });
}

function ForgedMesh({
  asset,
  lod,
  viewMode,
  onTriangles,
  onStatus,
  onBounds,
}: {
  asset: ForgedAsset;
  lod: LodLevel;
  viewMode: ViewMode;
  onTriangles: (count: number) => void;
  onStatus: (status: { loading: boolean; error: string | null; missingLod: boolean }) => void;
  onBounds: (bounds: { span: number; height: number } | null) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const [scene, setScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.Group | null = null;
    setScene(null);
    onStatus({ loading: true, error: null, missingLod: false });
    new GLTFLoader().load(
      forgedUrl(asset),
      (gltf) => {
        if (cancelled) {
          disposeLoaded(gltf.scene);
          return;
        }
        loaded = gltf.scene;
        setScene(gltf.scene);
      },
      undefined,
      (err) => {
        if (!cancelled) onStatus({ loading: false, error: err instanceof Error ? err.message : "could not load the GLB", missingLod: false });
      },
    );
    return () => {
      cancelled = true;
      if (loaded) disposeLoaded(loaded);
    };
  }, [asset, onStatus]);

  useEffect(() => {
    if (!scene) return;
    const { shown, missingLod } = selectLod(scene, lod);
    // Rest it on the grid and centre it, whatever pivot the export used.
    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const mesh of shown) box.union(new THREE.Box3().setFromObject(mesh));
    if (!box.isEmpty()) {
      const centre = box.getCenter(new THREE.Vector3());
      scene.position.set(-centre.x, -box.min.y, -centre.z);
      const size = box.getSize(new THREE.Vector3());
      onBounds({ span: Math.max(size.x, size.y, size.z, 0.12), height: size.y });
    } else {
      onBounds(null);
    }
    applyView(scene, viewMode);
    onTriangles(shown.reduce((n, m) => n + countTriangles(m), 0));
    onStatus({ loading: false, error: null, missingLod });
    invalidate();
  }, [scene, lod, viewMode, onTriangles, onStatus, onBounds, invalidate]);

  return scene ? <primitive object={scene} /> : null;
}

function AssetMesh({
  spec,
  lod,
  viewMode,
  onTriangles,
}: {
  spec: AssetSpec;
  lod: LodLevel;
  viewMode: ViewMode;
  onTriangles: (count: number) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const group = useMemo(() => buildAsset(spec, lod), [spec, lod]);
  useEffect(() => () => disposeGroup(group), [group]);
  useEffect(() => {
    onTriangles(countTriangles(group));
  }, [group, onTriangles]);
  useEffect(() => {
    applyView(group, viewMode);
    invalidate();
  }, [group, viewMode, invalidate]);
  // Centre-pivot kinds (weapons) are exported centred on the origin; lift them for display.
  return <primitive object={group} position-y={spec.pivot === "center" ? spec.dimensions.y / 2 : 0} />;
}

/** Re-frames the camera when the asset changes, without recreating the WebGL context. */
function CameraRig({ span, targetY }: { span: number; targetY: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void }) | null;
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const dist = span * 2.15;
    camera.position.set(dist * 0.85, dist * 0.62, dist * 0.95);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = span / 50;
      camera.far = span * 50;
      camera.updateProjectionMatrix();
    }
    if (controls) {
      controls.target.set(0, targetY, 0);
      controls.update();
    } else {
      camera.lookAt(0, targetY, 0);
    }
    invalidate();
  }, [span, targetY, camera, controls, invalidate]);
  return null;
}

function Scene({
  spec,
  lod,
  viewMode,
  forged,
  bounds,
  onTriangles,
  onStatus,
  onBounds,
}: {
  spec: AssetSpec;
  lod: LodLevel;
  viewMode: ViewMode;
  forged: ForgedAsset | null;
  bounds: { span: number; height: number } | null;
  onTriangles: (count: number) => void;
  onStatus: (status: { loading: boolean; error: string | null; missingLod: boolean }) => void;
  onBounds: (bounds: { span: number; height: number } | null) => void;
}) {
  // Frame what is on screen: a hand-picked forged file need not be the size the spec describes.
  const span = bounds ? bounds.span : spanOf(spec);
  const targetY = bounds ? bounds.height * 0.38 : spec.dimensions.y * 0.38;
  const cell = gridStep(span);
  return (
    <>
      <color attach="background" args={["#0b0b0c"]} />
      <hemisphereLight args={["#e8e4dc", "#1a1a1e", 1.1]} />
      <directionalLight
        position={[span * 2.4, span * 3.2, span * 1.6]}
        intensity={2.6}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-span * 1.4, span, -span]} intensity={0.8} />
      {forged ? (
        <ForgedMesh asset={forged} lod={lod} viewMode={viewMode} onTriangles={onTriangles} onStatus={onStatus} onBounds={onBounds} />
      ) : (
        <AssetMesh spec={spec} lod={lod} viewMode={viewMode} onTriangles={onTriangles} />
      )}
      <ContactShadows
        key={`${spec.id}-${lod}-${viewMode}-${forged?.file ?? ""}`}
        frames={1}
        position={[0, 0.001, 0]}
        opacity={0.4}
        scale={span * 6}
        blur={2.4}
        far={span * 2}
      />
      <Grid
        infiniteGrid
        fadeDistance={span * 10}
        fadeStrength={2.5}
        cellSize={cell}
        sectionSize={cell * 4}
        sectionColor="#3a3a40"
        cellColor="#222228"
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={span * 0.35} maxDistance={span * 14} />
      <CameraRig span={span} targetY={targetY} />
      <GizmoHelper alignment="bottom-right" margin={[48, 48]}>
        <GizmoViewport axisColors={["#c47a72", "#7d9a78", "#8aa0b8"]} labelColor="#eceae4" />
      </GizmoHelper>
    </>
  );
}


/** Soft filter for the forged picker: substring query, else prefer current catalog kind. */
function filterForgedAssets(assets: ForgedAsset[], kind: string, query: string): ForgedAsset[] {
  const q = query.trim().toLowerCase();
  if (q) {
    return assets.filter((a) => a.file.toLowerCase().includes(q) || a.mesh.toLowerCase().includes(q));
  }
  const k = kind.toLowerCase();
  const byKind = assets.filter((a) => a.file.toLowerCase().includes(k) || a.mesh.toLowerCase().includes(k));
  return byKind.length ? byKind : assets;
}

export function Viewport({
  spec,
  lod,
  viewMode,
}: {
  spec: AssetSpec;
  lod: LodLevel;
  viewMode: ViewMode;
}) {
  const [ready, setReady] = useState(false);
  const [tris, setTris] = useState(0);
  const [listing, setListing] = useState<ForgedListing | null>(null);
  // "" means the spec blockout was chosen deliberately; null means "whatever matches this asset".
  const [pick, setPick] = useState<string | null>(null);
  // Substring filter for the forged picker; empty = prefer assets matching catalog kind.
  const [forgedFilter, setForgedFilter] = useState("");
  const [status, setStatus] = useState<{ loading: boolean; error: string | null; missingLod: boolean }>({
    loading: false,
    error: null,
    missingLod: false,
  });
  useEffect(() => setReady(true), []);
  const onTriangles = useCallback((count: number) => setTris(count), []);
  const onStatus = useCallback((next: { loading: boolean; error: string | null; missingLod: boolean }) => setStatus(next), []);
  const [bounds, setBounds] = useState<{ span: number; height: number } | null>(null);
  const onBounds = useCallback((next: { span: number; height: number } | null) => setBounds(next), []);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    fetchForged(controller.signal)
      .then(setListing)
      .catch(() => setListing({ available: false, root: null, assets: [] }));
    return () => controller.abort();
  }, []);
  useEffect(() => refresh(), [refresh]);
  // A newly forged asset should be picked up without reloading the page.
  useEffect(() => refresh(), [spec.id, refresh]);
  // Choosing a different asset drops a manual pick, so the preview follows the asset again.
  useEffect(() => {
    setPick(null);
    setForgedFilter("");
  }, [spec.id]);
  // The blockout and every forged file have their own size; never frame one with another's bounds.
  useEffect(() => setBounds(null), [spec.id, pick]);

  const assets = useMemo(() => listing?.assets ?? [], [listing]);
  const auto = useMemo(() => (assets.length ? matchForged(assets, meshName(spec)) : null), [assets, spec]);
  const forged = useMemo(() => {
    if (pick === "") return null;
    if (pick) return assets.find((a) => a.file === pick) ?? null;
    return auto;
  }, [pick, assets, auto]);
  const filteredAssets = useMemo(() => {
    const list = filterForgedAssets(assets, spec.kind, forgedFilter);
    // Keep the active pick / auto match visible even if the filter would hide it.
    if (forged && !list.some((a) => a.file === forged.file)) return [forged, ...list];
    return list;
  }, [assets, spec.kind, forgedFilter, forged]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-sm text-muted">Lighting viewport</div>
    );
  }

  return (
    <div className="relative h-full min-h-[280px] bg-bg">
      <Canvas
        shadows="percentage"
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [2, 1.5, 2.2], fov: 32, near: 0.01, far: 100 }}
        className="h-full w-full touch-none"
      >
        <Scene
          spec={spec}
          lod={lod}
          viewMode={viewMode}
          forged={forged}
          bounds={forged ? bounds : null}
          onTriangles={onTriangles}
          onStatus={onStatus}
          onBounds={onBounds}
        />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 font-mono text-[11px] tabular-nums text-muted">
        <span>
          {spec.dimensions.x.toFixed(2)} × {spec.dimensions.y.toFixed(2)} × {spec.dimensions.z.toFixed(2)} m
        </span>
        <span>
          {tris.toLocaleString()} tris · LOD{lod}
        </span>
        <span>{spec.texelDensity} px/m</span>
        <span className={forged ? "text-accent" : "text-subtle"}>
          {forged
            ? status.loading
              ? "loading forged…"
              : // say which mesh, because a hand-picked file need not be the asset the panels describe
                `forged in Blender · ${forged.mesh}`
            : "blockout preview"}
        </span>
        {status.error ? <span className="text-warn">{status.error}</span> : null}
        {forged && status.missingLod ? <span className="text-subtle">no LOD{lod} in the file; showing LOD0</span> : null}
      </div>
      {assets.length ? (
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="anvil-forged-filter">
              Filter forged assets
            </label>
            <input
              id="anvil-forged-filter"
              type="search"
              value={forgedFilter}
              onChange={(event) => setForgedFilter(event.target.value)}
              placeholder={`filter · ${spec.kind}`}
              title="Filter by mesh/file substring. Empty prefers the current catalog kind."
              className="h-8 w-[9.5rem] rounded-md bg-surface-2/90 px-2 font-mono text-[11px] text-fg outline-none ring-1 ring-white/10 placeholder:text-subtle"
            />
            <label className="sr-only" htmlFor="anvil-forged-pick">
              Preview source
            </label>
            <select
              id="anvil-forged-pick"
              className="h-8 max-w-[15rem] rounded-md bg-surface-2/90 px-2 font-mono text-[11px] text-fg outline-none ring-1 ring-white/10"
              value={forged ? forged.file : ""}
              onChange={(event) => setPick(event.target.value)}
            >
              <option value="">Blockout preview (from the spec)</option>
              {filteredAssets.map((asset) => (
                <option key={asset.file} value={asset.file}>
                  {asset.file}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="h-8 rounded-md bg-surface-2/90 px-2 font-mono text-[11px] text-muted ring-1 ring-white/10 hover:text-fg"
              onClick={() => refresh()}
              title="Look again for assets forged since this page loaded"
            >
              Rescan
            </button>
          </div>
          <span className="pointer-events-none font-mono text-[10px] tabular-nums text-subtle">
            {filteredAssets.length}/{assets.length} forged
            {!forgedFilter.trim() ? ` · kind ${spec.kind}` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
