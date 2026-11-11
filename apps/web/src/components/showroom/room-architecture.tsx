"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { daylightPool, flat, floorMaterial, type FloorSpec } from "@/three/architecture-materials";
import { materialFor, type Quality } from "@/three/materials";
import { ROOMS, roomCenterX, type Room } from "./layout";
import { ARCH, WINDOW_SIDE } from "./viewpoints";

/**
 * Finished architectural rooms for the showroom, built from primitives with
 * shared, cached materials: a timber or stone floor, plaster walls with
 * skirting and a cornice, a ceiling with a front edge beam, a daylight window,
 * door openings between rooms, a rug, a pendant light and a plant.
 */
const FLOORS: Record<Room, FloorSpec> = {
  living: { kind: "timber", color: "#c39c72", repeat: [9, 6.3] },
  dining: { kind: "stone", color: "#e2d3bc", repeat: [8, 5.6] },
  office: { kind: "timber", color: "#86644b", repeat: [9, 6.3] },
  bedroom: { kind: "timber", color: "#d8c3a0", repeat: [9, 6.3] },
  studio: { kind: "stone", color: "#d4cfc5", repeat: [6, 4.2] },
};
const WALLS: Record<Room, string> = { living: "#efe8dc", dining: "#ece3d5", office: "#e7e4db", bedroom: "#f0e7de", studio: "#eceae4" };
const RUGS: Record<Room, [field: string, border: string]> = {
  living: ["#d9c7b5", "#a8b09d"], dining: ["#cfd3c6", "#8f977f"], office: ["#cdbba6", "#6b4e3d"],
  bedroom: ["#e6d9c9", "#b77d63"], studio: ["#d6d0c4", "#373a34"],
};

const TRIM = "#f6f1e8";
const CASING = "#6b4e3d";
const FRAME = "#4a4c46";

/** A run of wall along z (a partition segment) with skirting and cornice on both faces. */
function ZSegment({ x, z0, z1, y0 = 0, y1 = ARCH.height, wall, trim = true }: { x: number; z0: number; z1: number; y0?: number; y1?: number; wall: THREE.Material; trim?: boolean }) {
  const len = z1 - z0, zc = (z0 + z1) / 2, h = y1 - y0;
  const t = ARCH.wallT;
  const trimMat = flat(TRIM, { roughness: 0.7 });
  return (
    <group>
      <mesh position={[x, y0 + h / 2, zc]} material={wall}><boxGeometry args={[t, h, len]} /></mesh>
      {trim && [-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[x + side * (t / 2 + 0.0125), 0.06, zc]} material={trimMat}><boxGeometry args={[0.025, 0.12, len]} /></mesh>
          <mesh position={[x + side * (t / 2 + 0.04), ARCH.height - 0.05, zc]} material={trimMat}><boxGeometry args={[0.08, 0.1, len]} /></mesh>
        </group>
      ))}
    </group>
  );
}

/** Side wall at x (relative to the room group); with a door opening when `door`. */
function SideWall({ x, door, wall }: { x: number; door: boolean; wall: THREE.Material }) {
  if (!door) return <ZSegment x={x} z0={ARCH.backZ} z1={ARCH.frontZ} wall={wall} />;
  const d0 = ARCH.doorZ - ARCH.doorW / 2, d1 = ARCH.doorZ + ARCH.doorW / 2;
  const casing = flat(CASING, { roughness: 0.6 });
  return (
    <group>
      <ZSegment x={x} z0={ARCH.backZ} z1={d0} wall={wall} />
      <ZSegment x={x} z0={d1} z1={ARCH.frontZ} wall={wall} />
      <ZSegment x={x} z0={d0} z1={d1} y0={ARCH.doorH} wall={wall} trim={false} />
      {/* door casing: two jambs and a head */}
      {[d0 + 0.02, d1 - 0.02].map((z) => (
        <mesh key={z} position={[x, ARCH.doorH / 2, z]} material={casing}><boxGeometry args={[ARCH.wallT + 0.04, ARCH.doorH, 0.04]} /></mesh>
      ))}
      <mesh position={[x, ARCH.doorH - 0.02, ARCH.doorZ]} material={casing}><boxGeometry args={[ARCH.wallT + 0.04, 0.04, ARCH.doorW]} /></mesh>
    </group>
  );
}

function Window({ x }: { x: number }) {
  const w = 1.6, h = 2.0, y = 1.55, z = ARCH.backZ + 0.1 + 0.005;
  const frame = flat(FRAME, { roughness: 0.5, metalness: 0.3 });
  const bar = (pos: [number, number, number], size: [number, number, number], k: string) =>
    <mesh key={k} position={pos} material={frame}><boxGeometry args={size} /></mesh>;
  return (
    <group>
      <mesh position={[x, y, z]} material={flat("#fffaf1", { emissive: true })}><planeGeometry args={[w, h]} /></mesh>
      {bar([x, y + h / 2, z + 0.02], [w + 0.08, 0.05, 0.05], "top")}
      {bar([x, y - h / 2, z + 0.02], [w + 0.08, 0.05, 0.05], "bottom")}
      {bar([x - w / 2, y, z + 0.02], [0.05, h, 0.05], "left")}
      {bar([x + w / 2, y, z + 0.02], [0.05, h, 0.05], "right")}
      {bar([x, y, z + 0.02], [0.03, h, 0.03], "mullion")}
      {bar([x, y + h * 0.18, z + 0.02], [w, 0.03, 0.03], "transom")}
      <mesh position={[x, y - h / 2 - 0.02, z + 0.08]} material={flat(TRIM, { roughness: 0.6 })}><boxGeometry args={[w + 0.24, 0.04, 0.16]} /></mesh>
    </group>
  );
}

function Pendant({ quality }: { quality: Quality }) {
  const seg = quality === "high" ? 32 : 12;
  const brass = materialFor({ finish: "metal", color: "#b08d57", name: "Brushed brass" }, quality);
  const shadeMat = useMemo(() => flat("#b08d57", { roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide }), []);
  return (
    <group position={[0, 0, 0.2]}>
      <mesh position={[0, (ARCH.height + 2.34) / 2, 0]} material={flat("#2c2d29", { roughness: 0.8 })}>
        <cylinderGeometry args={[0.006, 0.006, ARCH.height - 2.34, 6]} />
      </mesh>
      <mesh position={[0, 2.34, 0]} material={brass}><cylinderGeometry args={[0.03, 0.03, 0.05, 12]} /></mesh>
      <mesh position={[0, 2.22, 0]} material={shadeMat}><cylinderGeometry args={[0.07, 0.26, 0.2, seg, 1, true]} /></mesh>
      <mesh position={[0, 2.13, 0]} material={flat("#fff3d6", { emissive: true })}><sphereGeometry args={[0.055, seg / 2, seg / 2]} /></mesh>
    </group>
  );
}

const LEAVES: [number, number, number, number][] = [
  [0, 0.95, 0, 0.26], [0.16, 0.78, 0.06, 0.2], [-0.15, 0.82, -0.05, 0.21], [0.05, 0.7, -0.16, 0.18],
  [-0.08, 0.66, 0.15, 0.17], [0.12, 1.08, -0.05, 0.16], [-0.1, 1.12, 0.07, 0.15],
];

function Plant({ x, z, quality }: { x: number; z: number; quality: Quality }) {
  const seg = quality === "high" ? 20 : 8;
  const leaves = quality === "high" ? LEAVES : LEAVES.slice(0, 4);
  const pot = materialFor({ finish: "stone", color: "#b77d63", name: "Terracotta" }, quality);
  const leafA = flat("#7d8a6a", { roughness: 0.8 }), leafB = flat("#a8b09d", { roughness: 0.8 });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.19, 0]} material={pot}><cylinderGeometry args={[0.2, 0.15, 0.38, seg]} /></mesh>
      <mesh position={[0, 0.375, 0]} material={flat("#4a3a2c")}><cylinderGeometry args={[0.185, 0.185, 0.01, seg]} /></mesh>
      <mesh position={[0, 0.6, 0]} material={flat("#5a4334", { roughness: 0.8 })}><cylinderGeometry args={[0.012, 0.016, 0.5, 6]} /></mesh>
      {leaves.map(([lx, ly, lz, r], i) => (
        <mesh key={i} position={[lx, ly, lz]} scale={[1, 0.62, 1]} material={i % 2 ? leafB : leafA}>
          <sphereGeometry args={[r, seg, Math.max(6, seg / 2)]} />
        </mesh>
      ))}
    </group>
  );
}

function RoomShell({ room, index, quality }: { room: Room; index: number; quality: Quality }) {
  const cx = roomCenterX(room), s = WINDOW_SIDE[room];
  const H = ARCH.height, half = ARCH.halfWidth;
  const wall = flat(WALLS[room]);
  const trim = flat(TRIM, { roughness: 0.7 });
  const depth = 7, zMid = 0;
  const [rugField, rugBorder] = RUGS[room];
  const ceilDepth = ARCH.frontZ - ARCH.backZ;
  const backFace = ARCH.backZ + 0.1;
  return (
    <group position={[cx, 0, 0]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, zMid]} material={floorMaterial(FLOORS[room], quality)}>
        <planeGeometry args={[half * 2, depth]} />
      </mesh>
      {/* back wall with skirting and cornice */}
      <mesh position={[0, H / 2, ARCH.backZ]} material={wall}><boxGeometry args={[half * 2, H, 0.2]} /></mesh>
      <mesh position={[0, 0.06, backFace + 0.0125]} material={trim}><boxGeometry args={[half * 2, 0.12, 0.025]} /></mesh>
      <mesh position={[0, H - 0.05, backFace + 0.04]} material={trim}><boxGeometry args={[half * 2, 0.1, 0.08]} /></mesh>
      {/* ceiling and its front edge beam */}
      <mesh rotation-x={Math.PI / 2} position={[0, H, (ARCH.backZ + ARCH.frontZ) / 2]} material={flat("#f4efe7")}>
        <planeGeometry args={[half * 2, ceilDepth]} />
      </mesh>
      <mesh position={[0, H - 0.14, ARCH.frontZ]} material={trim}><boxGeometry args={[half * 2 + ARCH.wallT, 0.28, 0.18]} /></mesh>
      {/* side walls: outer walls are solid, shared partitions have a door */}
      {index === 0 && <SideWall x={-half} door={false} wall={wall} />}
      <SideWall x={half} door={index < ROOMS.length - 1} wall={wall} />
      <Window x={s * 2.6} />
      <mesh rotation-x={-Math.PI / 2} position={[s * 2.6, 0.003, backFace + 1.5]} material={daylightPool(quality)}>
        <planeGeometry args={[2.0, 3.0]} />
      </mesh>
      {/* rug with a border */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, 0.25]} material={flat(rugBorder)}><planeGeometry args={[4.6, 3.0]} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0.25]} material={flat(rugField)}><planeGeometry args={[4.36, 2.76]} /></mesh>
      <Pendant quality={quality} />
      <Plant x={-s * 4.3} z={2.7} quality={quality} />
    </group>
  );
}

export function RoomArchitecture({ quality }: { quality: Quality }) {
  return (
    <group>
      {/* ground in front of the open (cut-away) fronts */}
      <mesh rotation-x={-Math.PI / 2} position={[(ROOMS.length - 1) * 5, -0.002, 2]} material={flat("#e7dfd2")}>
        <planeGeometry args={[ROOMS.length * 10 + 20, 30]} />
      </mesh>
      {ROOMS.map((room, i) => <RoomShell key={room} room={room} index={i} quality={quality} />)}
    </group>
  );
}

/** Pendant glow over the active room only, so the number of lights (and shaders) never changes. */
export function ActiveRoomLight({ room }: { room: Room }) {
  const cx = roomCenterX(room);
  return <pointLight position={[cx, 2.05, 0.2]} intensity={2.4} distance={7} decay={1.6} color="#ffe8c8" />;
}
