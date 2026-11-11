"use client";

import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import type { Quality } from "./materials";

/**
 * Soft architectural daylight. The environment map is built from local
 * Lightformers (no HDR download), and soft contact shadows replace real-time
 * shadow maps.
 */
export function StudioLighting({ quality, shadowScale = 4, shadowOpacity = 0.42 }: { quality: Quality; shadowScale?: number; shadowOpacity?: number }) {
  return (
    <>
      <hemisphereLight args={["#fff8ee", "#d9c7b5", 0.85]} />
      <directionalLight position={[3.5, 5, 2.5]} intensity={1.6} color="#fff1df" />
      <directionalLight position={[-4, 2.5, -2]} intensity={0.45} color="#e8eef0" />
      <Environment resolution={quality === "high" ? 256 : 64} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 4, 3]} scale={[6, 3, 1]} color="#fff6ea" />
        <Lightformer form="rect" intensity={0.9} position={[-5, 1.5, 0]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} color="#f2ece2" />
        <Lightformer form="rect" intensity={0.6} position={[5, 1.5, -1]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} color="#e6dccd" />
      </Environment>
      <ContactShadows position={[0, 0.001, 0]} opacity={shadowOpacity} scale={shadowScale} blur={2.6} far={1.6}
        resolution={quality === "high" ? 512 : 256} color="#3a2f27" />
    </>
  );
}
