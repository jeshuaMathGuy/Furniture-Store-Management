"use client";

import * as THREE from "three";
import type { Quality } from "./materials";

/**
 * Procedural architectural surfaces for the showroom rooms: timber plank and
 * stone tile floors, plaster walls, trim and a soft daylight pool. Drawn on
 * canvases at runtime (no downloads) and cached, so every room shares them.
 * Floor textures are separate from the furniture textures because they repeat.
 */
export type FloorKind = "timber" | "stone";
export interface FloorSpec { kind: FloorKind; color: string; repeat: [number, number] }

const cache = new Map<string, THREE.Material>();
const textures = new Map<string, THREE.Texture>();

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function tex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat: [number, number], color = true) {
  const k = `${key}:${size}:${repeat.join("x")}`;
  const hit = textures.get(k);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  textures.set(k, t);
  return t;
}

/** Staggered timber planks with grain and seams. */
function planks(hex: string) {
  return (g: CanvasRenderingContext2D, s: number) => {
    const r = rng(parseInt(hex.slice(1), 16) % 9973 + 11);
    const rows = 6, ph = s / rows;
    g.fillStyle = hex; g.fillRect(0, 0, s, s);
    for (let row = 0; row < rows; row++) {
      const y = row * ph;
      let x = -r() * s * 0.5;
      while (x < s) {
        const len = s * (0.45 + r() * 0.4);
        const tone = (r() - 0.5) * 0.14;
        g.fillStyle = tone > 0 ? `rgba(255,245,230,${tone})` : `rgba(40,25,15,${-tone})`;
        g.fillRect(x, y, len, ph);
        for (let i = 0; i < 7; i++) {
          const gy = y + r() * ph, amp = 0.5 + r() * 1.5, f = 0.01 + r() * 0.02;
          g.strokeStyle = `rgba(45,28,16,${0.05 + r() * 0.08})`; g.lineWidth = 0.5 + r();
          g.beginPath();
          for (let gx = x; gx <= x + len; gx += 6) g.lineTo(gx, gy + Math.sin(gx * f) * amp);
          g.stroke();
        }
        g.fillStyle = "rgba(35,22,14,0.35)"; g.fillRect(x, y, 1.2, ph); // butt joint
        x += len;
      }
      g.fillStyle = "rgba(35,22,14,0.4)"; g.fillRect(0, y, s, 1.2); // long seam
    }
  };
}

/** Honed stone tiles with soft speckle, veining and grout. */
function tiles(hex: string) {
  return (g: CanvasRenderingContext2D, s: number) => {
    const r = rng(parseInt(hex.slice(1), 16) % 7919 + 3);
    const n = 2, ts = s / n;
    g.fillStyle = hex; g.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const tone = (r() - 0.5) * 0.08;
      g.fillStyle = tone > 0 ? `rgba(255,250,240,${tone})` : `rgba(90,70,50,${-tone})`;
      g.fillRect(i * ts, j * ts, ts, ts);
    }
    for (let i = 0; i < s * 5; i++) { g.fillStyle = `rgba(95,80,62,${r() * 0.07})`; g.fillRect(r() * s, r() * s, 1 + r() * 1.5, 1 + r() * 1.5); }
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = `rgba(130,112,92,${0.06 + r() * 0.08})`; g.lineWidth = 0.6 + r();
      g.beginPath(); let x = r() * s; g.moveTo(x, 0);
      for (let y = 0; y <= s; y += 12) { x += (r() - 0.5) * 10; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = "rgba(120,108,92,0.55)";
    for (let i = 0; i <= n; i++) { g.fillRect(i * ts - 1, 0, 2, s); g.fillRect(0, i * ts - 1, s, 2); }
  };
}

export function floorMaterial(spec: FloorSpec, q: Quality): THREE.Material {
  const key = `floor:${spec.kind}:${spec.color}:${q}:${spec.repeat.join("x")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = q === "high" ? 512 : 256;
  const map = tex(`${spec.kind}:${spec.color}`, size, spec.kind === "timber" ? planks(spec.color) : tiles(spec.color), spec.repeat);
  const m = new THREE.MeshStandardMaterial({ map, roughness: spec.kind === "timber" ? 0.58 : 0.42, metalness: 0 });
  m.name = spec.kind === "timber" ? "Timber floor" : "Stone floor";
  cache.set(key, m);
  return m;
}

/** Plain matte surfaces (plaster, trim, glass, fabrics of props). */
export function flat(color: string, opts: { roughness?: number; metalness?: number; emissive?: boolean; side?: THREE.Side } = {}): THREE.Material {
  const key = `flat:${color}:${opts.roughness ?? 0.95}:${opts.metalness ?? 0}:${opts.emissive ? 1 : 0}:${opts.side ?? 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = opts.emissive
    ? new THREE.MeshBasicMaterial({ color, toneMapped: false, side: opts.side ?? THREE.FrontSide })
    : new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.95, metalness: opts.metalness ?? 0, side: opts.side ?? THREE.FrontSide });
  cache.set(key, m);
  return m;
}

/** A soft pool of window light on the floor: additive gradient, no shadow map needed. */
export function daylightPool(q: Quality): THREE.Material {
  const key = `pool:${q}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map = tex("pool", q === "high" ? 256 : 128, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, "rgba(255,244,222,0.95)"); grad.addColorStop(1, "rgba(255,244,222,0)");
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    const side = g.createLinearGradient(0, 0, s, 0);
    side.addColorStop(0, "rgba(0,0,0,1)"); side.addColorStop(0.18, "rgba(0,0,0,0)"); side.addColorStop(0.82, "rgba(0,0,0,0)"); side.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out"; g.fillStyle = side; g.fillRect(0, 0, s, s);
  }, [1, 1]);
  const m = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  cache.set(key, m);
  return m;
}
