"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { FurnitureModel, type VariantLike } from "@/three/furniture-model";
import { StudioLighting } from "@/three/studio-lighting";
import type { FurnitureModel as Model } from "@/three/models";
import { labelAnchors, type PartRole } from "@/three/assembly";
import type { Quality } from "@/three/materials";

export interface ViewerCommand { n: number; kind: "reset" | "zoom-in" | "zoom-out" | "rotate-left" | "rotate-right" }

export interface ViewerCanvasProps {
  model: Model;
  productMaterial: string | null;
  variant: VariantLike | null;
  exploded: boolean;
  /** Assembly sequence while exploded: per-part explode targets and roles (three/assembly.ts). */
  assembly?: { explode: number[]; role: PartRole[]; step: number } | null;
  autoRotate: boolean;
  showDims: boolean;
  command: ViewerCommand;
  quality: Quality;
  reducedMotion: boolean;
  onReady?: () => void;
}

const FOV = 32;

/** Camera framing derived from the model's real dimensions. */
function framing(model: Model) {
  const { w, d, h } = model.dims;
  const r = 0.5 * Math.hypot(w, h, d);
  const dist = (r / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 1.22;
  const target = new THREE.Vector3(0, h * 0.42, 0);
  const dir = new THREE.Vector3(0.62, 0.36, 1).normalize();
  return { target, position: target.clone().add(dir.multiplyScalar(dist)), min: dist * 0.35, max: dist * 2.2 };
}

type Controls = React.ComponentRef<typeof OrbitControls>;

function Rig({ model, command, autoRotate, reducedMotion, exploded }: { model: Model; command: ViewerCommand; autoRotate: boolean; reducedMotion: boolean; exploded: boolean }) {
  const controls = useRef<Controls>(null);
  const { camera, invalidate } = useThree();
  const f = useMemo(() => framing(model), [model]);

  useEffect(() => {
    const timers = [120, 400, 1000].map((ms) => window.setTimeout(() => invalidate(), ms));
    return () => timers.forEach(clearTimeout);
  }, [invalidate]);

  // Re-frame whenever the model changes (e.g. a different product in Studio).
  useEffect(() => {
    camera.position.copy(f.position);
    controls.current?.target.copy(f.target);
    controls.current?.update();
    invalidate();
  }, [f, camera, invalidate]);

  useEffect(() => {
    const c = controls.current;
    if (!c || command.n === 0) return;
    const offset = camera.position.clone().sub(c.target);
    if (command.kind === "reset") { camera.position.copy(f.position); c.target.copy(f.target); }
    else if (command.kind === "zoom-in" || command.kind === "zoom-out") {
      const len = THREE.MathUtils.clamp(offset.length() * (command.kind === "zoom-in" ? 0.82 : 1.22), f.min, f.max);
      camera.position.copy(c.target).add(offset.setLength(len));
    } else {
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (command.kind === "rotate-left" ? -1 : 1) * Math.PI / 12);
      camera.position.copy(c.target).add(offset);
    }
    c.update();
    invalidate();
  }, [command, camera, f, invalidate]);

  // Pull back while exploded so displaced parts stay in frame; return afterwards.
  const wasExploded = useRef(exploded);
  useEffect(() => {
    const c = controls.current;
    if (!c || wasExploded.current === exploded) return;
    wasExploded.current = exploded;
    const offset = camera.position.clone().sub(c.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * (exploded ? 1.4 : 1 / 1.4), f.min, f.max));
    camera.position.copy(c.target).add(offset);
    c.update();
    invalidate();
  }, [exploded, camera, f, invalidate]);

  return (
    <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping={!reducedMotion} dampingFactor={0.08}
      minDistance={f.min} maxDistance={f.max} minPolarAngle={0.12} maxPolarAngle={Math.PI / 2 - 0.04}
      autoRotate={autoRotate && !reducedMotion} autoRotateSpeed={0.7} target={f.target} />
  );
}

function Dimensions({ model }: { model: Model }) {
  const { w, d, h } = model.dims;
  const y = 0.004, x = w / 2 + 0.06, z = d / 2 + 0.06;
  const label = (text: string, pos: [number, number, number]) => (
    <Html position={pos} center zIndexRange={[10, 0]}>
      <span className="whitespace-nowrap rounded-full bg-porcelain/90 px-2 py-0.5 font-mono text-[10px] text-charcoal shadow-soft">{text}</span>
    </Html>
  );
  return (
    <group>
      <Line points={[[-w / 2, y, z], [w / 2, y, z]]} color="#373a34" lineWidth={1} transparent opacity={0.6} />
      <Line points={[[x, y, d / 2], [x, h, d / 2]]} color="#373a34" lineWidth={1} transparent opacity={0.6} />
      <Line points={[[x, y, -d / 2], [x, y, d / 2]]} color="#373a34" lineWidth={1} transparent opacity={0.6} />
      {label(`W ${Math.round(w * 100)} cm`, [0, y, z + 0.05])}
      {label(`H ${Math.round(h * 100)} cm`, [x + 0.05, h / 2, d / 2])}
      {label(`D ${Math.round(d * 100)} cm`, [x + 0.05, y, 0])}
    </group>
  );
}

/** Leader-line labels in exploded mode: one per unique part label, drawn at the parts' target positions. */
function PartLabels({ model, explode, role, step }: { model: Model; explode: number[] | number; role: PartRole[] | null; step: number }) {
  const anchors = useMemo(() => labelAnchors(model, explode), [model, explode]);
  return (
    <group>
      {anchors.map((a) => {
        const r = step > 0 ? role?.[model.parts.findIndex((p) => p.id === a.partId)] ?? "pending" : "pending";
        const tone = r === "current" ? "bg-charcoal text-porcelain" : r === "placed" ? "bg-porcelain/80 text-ink-soft" : "bg-porcelain/95 text-charcoal";
        return (
          <group key={a.label}>
            <Line points={[a.anchor, a.labelPos]} color="#373a34" lineWidth={1} transparent opacity={0.55} />
            <Html position={a.labelPos} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium shadow-soft ${tone}`}
                data-testid="part-label" data-role={r}>{a.label}</span>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

export default function ViewerCanvas(p: ViewerCanvasProps) {
  const span = Math.max(p.model.dims.w, p.model.dims.d);
  const asm = p.exploded ? p.assembly ?? null : null;
  return (
    <Canvas
      frameloop={p.autoRotate && !p.reducedMotion ? "always" : "demand"}
      dpr={p.quality === "high" ? [1, 1.75] : 1}
      camera={{ fov: FOV, near: 0.05, far: 60 }}
      gl={{ antialias: p.quality === "high", alpha: true, powerPreference: "high-performance" }}
      onCreated={() => p.onReady?.()}
      aria-hidden
    >
      <StudioLighting quality={p.quality} shadowScale={span * 2.6 + 1} />
      <FurnitureModel model={p.model} productMaterial={p.productMaterial} variant={p.variant}
        explode={p.exploded ? 1 : 0} partExplode={asm?.explode} partRole={asm?.role}
        quality={p.quality} reducedMotion={p.reducedMotion} />
      {p.exploded && <PartLabels model={p.model} explode={asm?.explode ?? 1} role={asm?.role ?? null} step={asm?.step ?? 0} />}
      {p.showDims && !p.exploded && <Dimensions model={p.model} />}
      <Rig model={p.model} command={p.command} autoRotate={p.autoRotate} reducedMotion={p.reducedMotion} exploded={p.exploded} />
    </Canvas>
  );
}
