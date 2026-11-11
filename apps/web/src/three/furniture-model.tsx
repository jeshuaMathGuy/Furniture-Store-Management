"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { resolveSlot, type FurnitureModel as Model, type Part, type Slot } from "./models";
import type { PartRole } from "./assembly";
import { emphasis, materialFor, type Quality } from "./materials";

export interface VariantLike { material: string; colorHex: string; name?: string }

interface Props {
  model: Model;
  productMaterial: string | null;
  variant?: VariantLike | null;
  /** Target explode amount 0..1 (animated), or a ref read every frame (scroll-driven scenes). */
  explode?: number;
  explodeRef?: React.RefObject<number>;
  /** Assembly mode: per-part explode targets (aligned with model.parts), overriding `explode`. */
  partExplode?: number[] | null;
  /** Assembly mode: "current" parts glow, "pending" parts are ghosted (when any part is placed). */
  partRole?: PartRole[] | null;
  /** Per-instance opacity driven every frame; gives the instance its own transparent materials. */
  opacityRef?: React.RefObject<number>;
  quality: Quality;
  reducedMotion?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
}

function PartMesh({ part, material, quality, refCb }: { part: Part; material: THREE.Material; quality: Quality; refCb: (o: THREE.Object3D | null) => void }) {
  const g = part.geo;
  if (g.kind === "box" && g.radius) {
    return <RoundedBox ref={refCb} args={g.size} radius={Math.min(g.radius, Math.min(...g.size) / 2 - 1e-4)} smoothness={quality === "high" ? 4 : 2}
      position={part.position} material={material} name={part.id} />;
  }
  return (
    <mesh ref={refCb} position={part.position} material={material} name={part.id}>
      {g.kind === "box" && <boxGeometry args={g.size} />}
      {g.kind === "cylinder" && <cylinderGeometry args={[g.radiusTop, g.radiusBottom, g.height, g.segments ?? (quality === "high" ? 40 : 16)]} />}
      {g.kind === "sphere" && <sphereGeometry args={[g.radius, quality === "high" ? 32 : 16, quality === "high" ? 24 : 12]} />}
    </mesh>
  );
}

/** Renders a parametric model. Explode transitions are damped per part and only request frames while moving. */
export function FurnitureModel({ model, productMaterial, variant, explode = 0, explodeRef, partExplode, partRole, opacityRef, quality, reducedMotion, onClick, onPointerOver, onPointerOut }: Props) {
  const invalidate = useThree((s) => s.invalidate);
  const nodes = useRef<(THREE.Object3D | null)[]>([]);
  const current = useRef<number[]>(model.parts.map((_, i) => partExplode?.[i] ?? explode));

  const shared = useMemo(() => {
    const out = {} as Record<Slot, THREE.Material>;
    for (const slot of ["frame", "surface", "upholstery", "cushion", "metal", "accent"] as Slot[])
      out[slot] = materialFor(resolveSlot(slot, productMaterial, variant), quality);
    return out;
  }, [productMaterial, variant, quality]);

  // Faded instances need their own material copies; shared ones stay untouched.
  const mats = useMemo(() => {
    if (!opacityRef) return shared;
    const out = {} as Record<Slot, THREE.Material>;
    for (const [k, m] of Object.entries(shared)) { const c = m.clone(); c.transparent = true; out[k as Slot] = c; }
    return out;
  }, [shared, opacityRef]);
  useEffect(() => () => { if (mats !== shared) Object.values(mats).forEach((m) => m.dispose()); }, [mats, shared]);

  const anyPlaced = !!partRole?.some((r) => r !== "pending");
  const materialOf = (p: Part, i: number) => {
    const base = mats[p.slot];
    const role = opacityRef ? undefined : partRole?.[i];
    if (role === "current") return emphasis(base, "highlight");
    if (role === "pending" && anyPlaced) return emphasis(base, "ghost");
    return base;
  };

  useEffect(() => { invalidate(); }, [explode, partExplode, partRole, mats, invalidate]);

  useFrame((_, dt) => {
    const scroll = explodeRef ? explodeRef.current ?? 0 : null;
    let moving = false;
    model.parts.forEach((p, i) => {
      const target = scroll ?? partExplode?.[i] ?? explode;
      const prev = current.current[i] ?? target;
      const next = reducedMotion || scroll !== null ? target : THREE.MathUtils.damp(prev, target, 6, dt);
      const v = Math.abs(next - target) < 1e-3 ? target : next;
      current.current[i] = v;
      if (v !== target) moving = true;
      const n = nodes.current[i];
      if (n) n.position.set(p.position[0] + p.explode[0] * v, p.position[1] + p.explode[1] * v, p.position[2] + p.explode[2] * v);
    });
    if (opacityRef) {
      const o = opacityRef.current ?? 1;
      for (const m of Object.values(mats)) { m.opacity = o; m.depthWrite = o > 0.98; }
    }
    if (moving) invalidate();
  });

  return (
    <group onClick={onClick} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
      {model.parts.map((p, i) => (
        <PartMesh key={p.id} part={p} material={materialOf(p, i)} quality={quality} refCb={(o) => { nodes.current[i] = o; }} />
      ))}
    </group>
  );
}
