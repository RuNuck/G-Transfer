import * as THREE from "three";

/**
 * Procedural CanvasTextures, content-addressed and cached. The cache is bounded and
 * evicts least-recently-used entries with dispose(), so long sessions do not
 * accumulate GPU textures. Materials never own these textures; the cache does.
 */
const CACHE_LIMIT = 32;
const cache = new Map<string, THREE.CanvasTexture>();

function remember(key: string, tex: THREE.CanvasTexture) {
  cache.delete(key);
  cache.set(key, tex);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.get(oldest)?.dispose();
    cache.delete(oldest);
  }
}

function noise(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function canvasTexture(
  key: string,
  paint: (ctx: CanvasRenderingContext2D, size: number) => void,
  size: number,
  colorSpace: THREE.ColorSpace,
) {
  const hit = cache.get(key);
  if (hit) {
    remember(key, hit);
    return hit;
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  paint(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 4;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  remember(key, tex);
  return tex;
}

/** Colour texture: carries the whole albedo, so the material colour must stay white. */
export function albedoMap(kind: string, hex: string, seed: number) {
  return canvasTexture(
    `a:${kind}:${hex}:${seed}`,
    (ctx, size) => {
      const [r, g, b] = hexRgb(hex);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, size, size);
      if (kind === "wood" || kind === "crate" || kind === "chest") {
        for (let x = 0; x < size; x += 32) {
          ctx.fillStyle = `rgba(0,0,0,${0.08 + noise(x, seed) * 0.08})`;
          ctx.fillRect(x, 0, 2, size);
          for (let y = 0; y < size; y++) {
            const n = noise(x * 0.05, y * 0.2 + seed);
            ctx.fillStyle = `rgba(${r + 20},${g + 10},${b},${0.08 * n})`;
            ctx.fillRect(x + 4, y, 24, 1);
          }
        }
      } else if (kind === "metal" || kind === "sci" || kind === "gun") {
        for (let i = 0; i < 1800; i++) {
          const x = noise(i, seed) * size;
          const y = noise(seed, i) * size;
          ctx.fillStyle = `rgba(255,255,255,${0.03 + noise(i, 3) * 0.05})`;
          ctx.fillRect(x, y, 1, 4);
        }
        for (let y = 0; y < size; y += 32) {
          ctx.fillStyle = "rgba(0,0,0,0.12)";
          ctx.fillRect(0, y, size, 1);
        }
      } else if (kind === "stone") {
        for (let i = 0; i < 80; i++) {
          const x = noise(i, seed) * size;
          const y = noise(seed + 2, i) * size;
          const s = 8 + noise(i, 9) * 28;
          ctx.fillStyle = `rgba(0,0,0,${0.05 + noise(i, 4) * 0.1})`;
          ctx.fillRect(x, y, s, s * 0.6);
        }
      } else if (kind === "paint") {
        for (let i = 0; i < 40; i++) {
          ctx.strokeStyle = `rgba(90,50,30,${0.08 + noise(i, seed) * 0.12})`;
          ctx.beginPath();
          ctx.arc(noise(i, 1) * size, noise(i, 2) * size, 6 + noise(i, 3) * 18, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, 0, size, 3);
      ctx.fillRect(0, size - 3, size, 3);
    },
    256,
    THREE.SRGBColorSpace,
  );
}

/**
 * Roughness data texture (linear, not sRGB): the spec's roughness plus a little
 * variation. The material's roughness factor must be 1 so it is applied once.
 */
export function roughnessMap(seed: number, roughness: number) {
  const base = Math.round(Math.min(1, Math.max(0, roughness)) * 255);
  return canvasTexture(
    `r:${seed}:${base}`,
    (ctx, size) => {
      ctx.fillStyle = `rgb(${base},${base},${base})`;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 1200; i++) {
        const v = Math.round(Math.min(255, Math.max(0, base + (noise(i, seed) - 0.5) * 30)));
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(noise(i, 1) * size, noise(i, 2) * size, 2, 2);
      }
    },
    128,
    THREE.NoColorSpace,
  );
}

export function makeStandard(opts: {
  color: string;
  roughness: number;
  metalness: number;
  kind?: string;
  seed?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}) {
  const seed = opts.seed ?? 1;
  const kind = opts.kind ?? "metal";
  return new THREE.MeshStandardMaterial({
    // The albedo map carries the colour and the roughness map carries the roughness:
    // the factors stay at 1 so neither value is applied twice (in the viewport or the GLB).
    color: "#ffffff",
    roughness: 1,
    metalness: opts.metalness,
    map: albedoMap(kind, opts.color, seed),
    roughnessMap: roughnessMap(seed, opts.roughness),
    envMapIntensity: 0.9,
    emissive: opts.emissive ?? "#000000",
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

export function disposeTextures() {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}
