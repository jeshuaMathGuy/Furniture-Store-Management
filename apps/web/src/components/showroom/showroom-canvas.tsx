"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { FurnitureModel } from "@/three/furniture-model";
import { StudioLighting } from "@/three/studio-lighting";
import { buildModel } from "@/three/models";
import type { Quality } from "@/three/materials";
import { ROOMS, ROOM_SPACING, type Placement, type Room } from "./layout";
import { ARCH, MAX_AZIMUTH, focusView, roomBounds, vantage, walkDuration, walkPath, type V3, type VantageId } from "./viewpoints";
import { ActiveRoomLight, RoomArchitecture } from "./room-architecture";
import type { ShowroomItem } from "./showroom";

type Controls = React.ComponentRef<typeof OrbitControls>;
interface Goal { position: V3; target: V3 }
interface Walk { curve: THREE.Curve<THREE.Vector3>; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; through: boolean }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Constrained camera. Changing room walks the camera through the door openings
 * along a smooth path (eased, looking ahead, then settling on the destination
 * view); changing viewpoint or piece within a room is a short damped move.
 * Reduced motion: jump cuts only. User orbiting is limited to the room.
 */
function Rig({ room, goal, reducedMotion, onMotion }: { room: Room; goal: Goal; reducedMotion: boolean; onMotion: (moving: boolean) => void }) {
  const controls = useRef<Controls>(null);
  const { camera, invalidate } = useThree();
  const walk = useRef<Walk | null>(null);

  useEffect(() => {
    const c = controls.current;
    const pos = new THREE.Vector3(...goal.position), tgt = new THREE.Vector3(...goal.target);
    const already = camera.position.distanceTo(pos) < 0.01 && !!c && c.target.distanceTo(tgt) < 0.01;
    if (reducedMotion || !c || already) {
      walk.current = null;
      camera.position.copy(pos);
      if (c) { c.target.copy(tgt); c.enabled = true; c.update(); }
      onMotion(false);
      invalidate();
      return;
    }
    const pts = walkPath(camera.position.toArray() as V3, room, goal.position).map((p) => new THREE.Vector3(...p));
    const curve = pts.length === 2 ? new THREE.LineCurve3(pts[0]!, pts[1]!) : new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
    walk.current = { curve, t: 0, dur: walkDuration(curve.getLength()), from: c.target.clone(), to: tgt, through: pts.length > 2 };
    c.enabled = false;
    onMotion(true);
    invalidate();
  }, [goal, room, reducedMotion, camera, invalidate, onMotion]);

  useFrame((_, dt) => {
    const w = walk.current, c = controls.current;
    if (!w || !c) return;
    w.t = Math.min(1, w.t + Math.min(dt, 0.05) / w.dur);
    const e = easeInOut(w.t);
    const p = w.curve.getPointAt(e);
    camera.position.copy(p);
    const target = w.from.clone();
    if (w.through) {
      const ahead = w.curve.getPointAt(Math.min(1, e + 0.05)).sub(p).setY(0);
      const look = ahead.lengthSq() > 1e-8 ? p.clone().add(ahead.normalize().multiplyScalar(3)).setY(1.2) : w.to.clone();
      target.lerp(look, smooth(0, 0.15, e)).lerp(w.to, smooth(0.62, 1, e));
    } else {
      target.lerp(w.to, e);
    }
    c.target.copy(target);
    camera.lookAt(target);
    if (w.t >= 1) {
      walk.current = null;
      c.enabled = true;
      c.update();
      onMotion(false);
    }
    invalidate();
  });

  // Constrained movement: orbiting never leaves the current room.
  const clampToRoom = () => {
    if (walk.current) return;
    const b = roomBounds(room), p = camera.position;
    const x = THREE.MathUtils.clamp(p.x, b.minX, b.maxX), y = THREE.MathUtils.clamp(p.y, b.minY, b.maxY), z = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
    if (x !== p.x || y !== p.y || z !== p.z) p.set(x, y, z);
  };

  return <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping={!reducedMotion} minDistance={1.2} maxDistance={10}
    minPolarAngle={0.35} maxPolarAngle={1.5} minAzimuthAngle={-MAX_AZIMUTH} maxAzimuthAngle={MAX_AZIMUTH} onChange={clampToRoom} />;
}

function SelectionRing({ w, d, x, z }: { w: number; d: number; x: number; z: number }) {
  const r = Math.max(w, d) / 2 + 0.18;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[x, 0.012, z]}>
      <ringGeometry args={[r, r + 0.035, 72]} />
      <meshBasicMaterial color="#8a5641" transparent opacity={0.75} />
    </mesh>
  );
}

export default function ShowroomCanvas({ items, placements, room, view, selectedId, onSelect, quality, reducedMotion, moving, onMotion }: {
  items: ShowroomItem[]; placements: Placement[]; room: Room; view: VantageId; selectedId: number | null;
  onSelect: (id: number) => void; quality: Quality; reducedMotion: boolean; moving: boolean; onMotion: (moving: boolean) => void;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.productId, i])), [items]);
  const models = useMemo(() => new Map(items.map((i) => [i.productId, buildModel(i.modelKey, i.dimensions)])), [items]);
  const selected = selectedId ? placements.find((p) => p.productId === selectedId) : undefined;
  const sm = selected ? models.get(selected.productId) : undefined;

  const goal = useMemo<Goal>(() => {
    if (selected && sm) return focusView(selected.room, { x: selected.x, z: selected.z, w: sm.dims.w, h: sm.dims.h });
    const v = vantage(room, view);
    return { position: v.position, target: v.target };
  }, [selected, sm, room, view]);

  const start = vantage("living", "overview");

  return (
    <Canvas frameloop="demand" dpr={quality === "high" ? [1, 1.6] : 1} camera={{ fov: 38, near: 0.05, far: 80, position: start.position }}
      gl={{ antialias: quality === "high", powerPreference: "high-performance" }}
      // The canvas itself is decorative for assistive tech; the hotspot buttons rendered beside it are not.
      onCreated={({ gl }) => gl.domElement.setAttribute("aria-hidden", "true")}>
      <color attach="background" args={["#efe9df"]} />
      <fog attach="fog" args={["#efe9df", 12, 30]} />
      <StudioLighting quality={quality} shadowScale={ROOMS.length * ROOM_SPACING + 10} shadowOpacity={0.35} />
      {quality === "high" && <ActiveRoomLight room={room} />}
      <RoomArchitecture quality={quality} />
      {placements.map((p) => {
        const item = byId.get(p.productId)!, model = models.get(p.productId)!;
        return (
          <group key={p.productId} position={[p.x, 0, p.z]} rotation-y={p.rotation}>
            <FurnitureModel model={model} productMaterial={item.material} variant={item.variant} quality={quality} reducedMotion={reducedMotion}
              onClick={(e) => { e.stopPropagation(); onSelect(p.productId); }}
              onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
              onPointerOut={() => { document.body.style.cursor = ""; }} />
          </group>
        );
      })}
      {/* Hotspots: an enhancement over the accessible piece list, shown for the current room once the camera has arrived. */}
      {!moving && placements.filter((p) => p.room === room).map((p) => {
        const item = byId.get(p.productId)!, model = models.get(p.productId)!;
        const on = p.productId === selectedId;
        return (
          <Html key={`hs-${p.productId}`} position={[p.x, Math.min(model.dims.h + 0.2, ARCH.height - 0.4), p.z]} center zIndexRange={[15, 0]}>
            <button type="button" onClick={() => onSelect(p.productId)} aria-label={`Inspect ${item.name}`} aria-pressed={on} data-testid="showroom-hotspot"
              className={`group flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full pl-1 pr-1 text-xs shadow-soft ring-1 ring-charcoal/15 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal ${on ? "bg-charcoal text-porcelain" : "bg-porcelain/95 text-charcoal hover:bg-white"}`}>
              <span aria-hidden className="grid size-6 place-items-center rounded-full border border-current text-sm leading-none">+</span>
              <span aria-hidden className="hidden pr-2 group-hover:inline group-focus-visible:inline">{item.name}</span>
            </button>
          </Html>
        );
      })}
      {selected && sm && <SelectionRing w={sm.dims.w} d={sm.dims.d} x={selected.x} z={selected.z} />}
      <Rig room={room} goal={goal} reducedMotion={reducedMotion} onMotion={onMotion} />
    </Canvas>
  );
}
