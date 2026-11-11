"use client";

import * as THREE from "three";
import type { SlotSpec } from "./models";

/**
 * Procedural materials: wood grain, fabric weave and stone speckle are drawn
 * on canvases at runtime, so no texture files or network fetches are needed.
 * Materials and textures are cached and shared by every scene (material reuse).
 */
export type Quality = "high" | "low";

const textures = new Map<string, THREE.Texture>();
const materials = new Map<string, THREE.Material>();

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function canvasTexture(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, color = true): THREE.Texture {
  const hit = textures.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}

function woodGrain(hex: string, q: Quality) {
  const size = q === "high" ? 512 : 256;
  return canvasTexture(`wood:${hex}:${size}`, size, (g, s) => {
    const r = rng(hex.length * 977 + parseInt(hex.slice(1), 16) % 9973);
    g.fillStyle = hex; g.fillRect(0, 0, s, s);
    // Long, gently wandering grain lines with darker latewood bands.
    for (let i = 0; i < 90; i++) {
      const y0 = r() * s, amp = 2 + r() * 6, freq = 0.004 + r() * 0.01, phase = r() * 6.28;
      g.strokeStyle = `rgba(40,25,15,${0.05 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 1.8;
      g.beginPath();
      for (let x = 0; x <= s; x += 8) g.lineTo(x, y0 + Math.sin(x * freq + phase) * amp);
      g.stroke();
    }
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(255,240,220,${0.03 + r() * 0.04})`; g.fillRect(0, r() * s, s, 4 + r() * 14); }
  });
}

function weave(q: Quality) {
  const size = q === "high" ? 256 : 128;
  return canvasTexture(`weave:${size}`, size, (g, s) => {
    g.fillStyle = "#808080"; g.fillRect(0, 0, s, s);
    const step = s / 64;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = ((x + y) % 2 === 0 ? 150 : 105) + ((x * 7 + y * 13) % 11) - 5;
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x * step, y * step, step, step);
    }
  }, false);
}

function speckle(hex: string, q: Quality) {
  const size = q === "high" ? 512 : 256;
  return canvasTexture(`stone:${hex}:${size}`, size, (g, s) => {
    const r = rng(7919);
    g.fillStyle = hex; g.fillRect(0, 0, s, s);
    for (let i = 0; i < s * 6; i++) { g.fillStyle = `rgba(90,70,50,${r() * 0.08})`; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); }
    for (let i = 0; i < 7; i++) {
      g.strokeStyle = `rgba(120,105,90,${0.08 + r() * 0.1})`; g.lineWidth = 0.5 + r();
      g.beginPath(); g.moveTo(r() * s, 0);
      for (let y = 0; y <= s; y += 16) g.lineTo(r() * s * 0.15 + (y / s) * s * r(), y);
      g.stroke();
    }
  });
}

export function materialFor(spec: SlotSpec, q: Quality): THREE.Material {
  const key = `${spec.finish}:${spec.color}:${q}`;
  const hit = materials.get(key);
  if (hit) return hit;
  let m: THREE.Material;
  switch (spec.finish) {
    case "wood":
    case "rattan": {
      const map = woodGrain(spec.color, q);
      m = new THREE.MeshStandardMaterial({ map, roughness: spec.finish === "rattan" ? 0.85 : 0.62, metalness: 0 });
      break;
    }
    case "fabric":
    case "mesh":
      m = q === "high"
        ? new THREE.MeshPhysicalMaterial({ color: spec.color, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color("#ffffff"), bumpMap: weave(q), bumpScale: 0.4 })
        : new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.95 });
      break;
    case "stone":
      m = new THREE.MeshStandardMaterial({ map: speckle(spec.color, q), roughness: 0.55, metalness: 0 });
      break;
    case "metal":
      m = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.38, metalness: 0.85 });
      break;
  }
  m.name = spec.name;
  materials.set(key, m);
  return m;
}

const emphasised = new Map<string, THREE.Material>();

/**
 * Assembly emphasis, shared like every other material: "highlight" adds a warm
 * brass glow to the part being fitted; "ghost" makes parts still waiting translucent.
 */
export function emphasis(base: THREE.Material, kind: "highlight" | "ghost"): THREE.Material {
  const key = `${base.uuid}:${kind}`;
  const hit = emphasised.get(key);
  if (hit) return hit;
  const m = base.clone();
  if (kind === "highlight") {
    if (m instanceof THREE.MeshStandardMaterial) { m.emissive = new THREE.Color("#b08d57"); m.emissiveIntensity = 0.55; }
  } else {
    m.transparent = true; m.opacity = 0.32; m.depthWrite = false;
  }
  emphasised.set(key, m);
  return m;
}
