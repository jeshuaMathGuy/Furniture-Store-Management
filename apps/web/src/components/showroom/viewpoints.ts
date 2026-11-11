/**
 * Pure showroom architecture and camera data (no three.js, testable).
 * Rooms sit side by side along x, ROOM_SPACING apart, separated by partitions
 * with a door opening. The front of each room is open (a stage-set cutaway),
 * so the overview camera stands just outside it.
 */
import { ROOMS, ROOM_SPACING, roomCenterX, type Room } from "./layout";

export type V3 = [number, number, number];

export const ARCH = {
  halfWidth: ROOM_SPACING / 2,     // partitions at centre ± 5 m
  wallT: 0.16,
  backZ: -3.5,                     // centre line of the back wall
  frontZ: 3.0,                     // ceiling edge / cornice beam
  height: 3.2,
  doorZ: 1.6,                      // centre of every door opening
  doorW: 1.1,
  doorH: 2.3,
  eye: 1.55,                       // walking eye height (below the door head)
} as const;

/** Where the camera may roam inside a room (constrained movement). */
export function roomBounds(room: Room) {
  const cx = roomCenterX(room);
  return { minX: cx - 4.6, maxX: cx + 4.6, minY: 0.45, maxY: 3.4, minZ: -2.9, maxZ: 8 };
}

/** Max azimuth (radians either side of looking straight at the back wall). */
export const MAX_AZIMUTH = 1.25;

export type VantageId = "overview" | "window" | "doorway" | "eye-level";
export interface Vantage { id: VantageId; label: string; position: V3; target: V3 }

/** Which side of the back wall the daylight window is on (−1 left, +1 right). */
export const WINDOW_SIDE: Record<Room, -1 | 1> = { living: -1, dining: 1, office: -1, bedroom: 1, studio: -1 };

const NAMES: Record<Room, [window: string, doorway: string, eye: string]> = {
  living: ["By the window", "From the doorway", "Seated eye level"],
  dining: ["Window seat", "From the hall door", "Head of the table"],
  office: ["Window light", "From the doorway", "Desk-chair height"],
  bedroom: ["Morning window", "From the doorway", "Bedside view"],
  studio: ["North light", "From the doorway", "Low angle"],
};

export function vantages(room: Room): Vantage[] {
  const cx = roomCenterX(room), s = WINDOW_SIDE[room];
  const [win, door, eye] = NAMES[room];
  return [
    { id: "overview", label: "Overview", position: [cx + 0.6, 2.8, 6.4], target: [cx, 0.75, -1.2] },
    { id: "window", label: win, position: [cx + s * 3.6, 1.6, 2.4], target: [cx - s * 1.0, 0.8, -1.6] },
    { id: "doorway", label: door, position: [cx - s * 4.3, 1.6, 2.2], target: [cx + s * 0.8, 0.8, -1.4] },
    { id: "eye-level", label: eye, position: [cx + 0.2, 1.15, 3.0], target: [cx, 0.6, -2.0] },
  ];
}

export function vantage(room: Room, id: VantageId): Vantage {
  return vantages(room).find((v) => v.id === id) ?? vantages(room)[0]!;
}

/** Camera for inspecting one piece, kept inside the room's bounds. */
export function focusView(room: Room, piece: { x: number; z: number; w: number; h: number }): { position: V3; target: V3 } {
  const b = roomBounds(room);
  const s = Math.max(piece.w, piece.h, 0.7) * 1.25;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const target: V3 = [piece.x, piece.h * 0.45, piece.z];
  const position: V3 = [clamp(piece.x + 1.1 * s, b.minX, b.maxX), clamp(piece.h * 0.45 + 0.9 * s, b.minY, b.maxY), clamp(piece.z + 2.3 * s, b.minZ, b.maxZ)];
  return { position, target };
}

/** Index of the room the camera is standing in (or in front of). */
export function roomIndexAt(x: number): number {
  return Math.max(0, Math.min(ROOMS.length - 1, Math.round(x / ROOM_SPACING)));
}

/**
 * Waypoints for walking from `from` into room `to`: drop to eye height, pass
 * through each door opening in turn, then rise to the destination viewpoint.
 * Within a room the path is direct.
 */
export function walkPath(from: V3, to: Room, dest: V3): V3[] {
  const a = roomIndexAt(from[0]), b = ROOMS.indexOf(to);
  if (a === b) return [from, dest];
  const dir = b > a ? 1 : -1;
  const pts: V3[] = [from];
  for (let k = a; k !== b; k += dir) {
    const doorX = roomCenterX(ROOMS[k]!) + dir * ARCH.halfWidth;
    pts.push([doorX - dir * 1.4, ARCH.eye, ARCH.doorZ], [doorX + dir * 1.4, ARCH.eye, ARCH.doorZ]);
  }
  pts.push(dest);
  return pts;
}

/** Walk duration in seconds for a path length in metres (ease in, cruise, ease out). */
export function walkDuration(lengthM: number): number {
  return Math.min(4.2, Math.max(0.8, lengthM / 7));
}

export const pathLength = (pts: V3[]) =>
  pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1], p[2] - pts[i]![2]), 0);
