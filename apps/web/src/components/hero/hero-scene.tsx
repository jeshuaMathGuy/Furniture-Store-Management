"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { FurnitureModel } from "@/three/furniture-model";
import { StudioLighting } from "@/three/studio-lighting";
import { buildModel, type DimsCm } from "@/three/models";
import type { Quality } from "@/three/materials";

export interface HeroState {
  cx: number; cy: number; cz: number; tx: number; ty: number; tz: number;
  rot: number; explode: number; collection: number; schema: number;
}

export interface HeroPiece { productId: number; name: string; modelKey: string | null; material: string | null; dimensions: DimsCm | null }
export interface SchemaCard { table: string; rows: [string, string][]; position: [number, number, number] }

interface Props {
  state: React.RefObject<HeroState>;
  invalidateRef: React.RefObject<(() => void) | null>;
  chair: HeroPiece;
  collection: (HeroPiece & { position: [number, number, number]; rotation: number })[];
  cards: SchemaCard[];
  quality: Quality;
}

function Room() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -2]}>
        <planeGeometry args={[30, 20]} />
        <meshStandardMaterial color="#e9e1d4" roughness={0.95} />
      </mesh>
      <mesh position={[0, 4, -6]}>
        <planeGeometry args={[30, 8]} />
        <meshStandardMaterial color="#efe8dc" roughness={1} />
      </mesh>
      {/* A tall arched opening of daylight on the back wall */}
      <mesh position={[-3.4, 1.7, -5.98]}>
        <planeGeometry args={[1.2, 2.6]} />
        <meshBasicMaterial color="#fffaf1" toneMapped={false} />
      </mesh>
      <mesh position={[-3.4, 3.0, -5.97]}>
        <circleGeometry args={[0.6, 48, 0, Math.PI]} />
        <meshBasicMaterial color="#fffaf1" toneMapped={false} />
      </mesh>
    </group>
  );
}

function Director({ state, invalidateRef, chairGroup, chairOpacity, chairExplode, collectionGroups, collectionOpacity, cardEls, lineMats }: {
  state: React.RefObject<HeroState>; invalidateRef: Props["invalidateRef"];
  chairGroup: React.RefObject<THREE.Group | null>; chairOpacity: React.RefObject<number>; chairExplode: React.RefObject<number>;
  collectionGroups: React.RefObject<(THREE.Group | null)[]>; collectionOpacity: React.RefObject<number>;
  cardEls: React.RefObject<(HTMLDivElement | null)[]>; lineMats: React.RefObject<(THREE.Material | null)[]>;
}) {
  const { camera, invalidate, size } = useThree();
  useEffect(() => { invalidateRef.current = invalidate; return () => { invalidateRef.current = null; }; }, [invalidate, invalidateRef]);
  // Demand rendering: request frames while async pieces (environment map, fonts in Html cards) settle.
  useEffect(() => {
    const timers = [0, 120, 400, 1000].map((ms) => window.setTimeout(() => invalidate(), ms));
    return () => timers.forEach(clearTimeout);
  }, [invalidate, size.width, size.height]);
  const target = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const s = state.current;
    if (!s) return;
    const aspect = size.width / size.height;
    // The subject sits right of the captions only when the frame is wide enough;
    // narrower frames centre it (captions move below) and step the camera back.
    const shift = THREE.MathUtils.clamp((aspect - 1.05) / 0.6, 0, 1);
    const k = THREE.MathUtils.clamp(1.95 - 0.55 * aspect, 1, 1.75);
    target.set(s.tx * shift, s.ty, s.tz);
    camera.position.set(target.x + (s.cx - s.tx) * k, s.ty + (s.cy - s.ty) * k, s.tz + (s.cz - s.tz) * k);
    camera.lookAt(target);
    if (chairGroup.current) chairGroup.current.rotation.y = s.rot;
    chairExplode.current = s.explode;
    chairOpacity.current = 1 - 0.65 * s.schema;
    collectionOpacity.current = s.collection;
    collectionGroups.current?.forEach((g) => { if (g) { g.visible = s.collection > 0.01; g.position.y = (1 - s.collection) * -0.25; } });
    cardEls.current?.forEach((el) => { if (el) { el.style.opacity = String(s.schema); el.style.visibility = s.schema > 0.01 ? "visible" : "hidden"; } });
    lineMats.current?.forEach((m) => { if (m) { m.opacity = s.schema * 0.7; m.visible = s.schema > 0.01; } });
  });
  return null;
}

export default function HeroScene({ state, invalidateRef, chair, collection, cards, quality }: Props) {
  const chairModel = useMemo(() => buildModel(chair.modelKey, chair.dimensions), [chair]);
  const models = useMemo(() => collection.map((c) => buildModel(c.modelKey, c.dimensions)), [collection]);
  const chairGroup = useRef<THREE.Group>(null);
  const chairOpacity = useRef(1), chairExplode = useRef(0), collectionOpacity = useRef(0);
  const collectionGroups = useRef<(THREE.Group | null)[]>([]);
  const cardEls = useRef<(HTMLDivElement | null)[]>([]);
  const lineMats = useRef<(THREE.Material | null)[]>([]);
  const anchor: [number, number, number] = [0, chairModel.dims.h * 0.55, 0];

  return (
    <Canvas frameloop="demand" dpr={quality === "high" ? [1, 1.75] : 1} camera={{ fov: 30, near: 0.05, far: 80, position: [2, 1.2, 3] }}
      gl={{ antialias: quality === "high", powerPreference: "high-performance" }} aria-hidden>
      <color attach="background" args={["#efe9df"]} />
      <fog attach="fog" args={["#efe9df", 9, 22]} />
      <StudioLighting quality={quality} shadowScale={12} shadowOpacity={0.38} />
      <Room />
      <group ref={chairGroup}>
        <FurnitureModel model={chairModel} productMaterial={chair.material} quality={quality} explodeRef={chairExplode} opacityRef={chairOpacity} />
      </group>
      {collection.map((c, i) => (
        <group key={c.productId} ref={(g) => { collectionGroups.current[i] = g; }} position={c.position} rotation-y={c.rotation} visible={false}>
          <FurnitureModel model={models[i]!} productMaterial={c.material} quality={quality} opacityRef={collectionOpacity} />
        </group>
      ))}
      {cards.map((card, i) => (
        <group key={card.table}>
          <Line points={[anchor, card.position]} color="#56604c" lineWidth={1.2} transparent opacity={0} dashed dashSize={0.06} gapSize={0.04}
            ref={(l) => { lineMats.current[i] = (l as unknown as { material?: THREE.Material } | null)?.material ?? null; }} />
          <Html position={card.position} center zIndexRange={[20, 0]}>
            <div ref={(el) => { cardEls.current[i] = el; }} style={{ opacity: 0, visibility: "hidden" }}
              className="w-52 rounded-xl border border-charcoal/10 bg-porcelain/95 p-3 font-mono text-[10px] text-charcoal shadow-lift">
              <p className="mb-1.5 text-[11px] text-clay-deep">{card.table}</p>
              {card.rows.map(([k, v]) => (
                <p key={k} className="flex justify-between gap-2 border-t border-charcoal/5 py-0.5"><span className="text-ink-soft">{k}</span><span className="truncate">{v}</span></p>
              ))}
            </div>
          </Html>
        </group>
      ))}
      <Director state={state} invalidateRef={invalidateRef} chairGroup={chairGroup} chairOpacity={chairOpacity} chairExplode={chairExplode}
        collectionGroups={collectionGroups} collectionOpacity={collectionOpacity} cardEls={cardEls} lineMats={lineMats} />
    </Canvas>
  );
}
