/** Pure room layout for the showroom (testable, no three.js). Units are metres. */
export const ROOMS = ["living", "dining", "office", "bedroom", "studio"] as const;
export type Room = (typeof ROOMS)[number];
export const ROOM_LABEL: Record<Room, string> = { living: "Living room", dining: "Dining room", office: "Home office", bedroom: "Bedroom", studio: "Studio" };

export const ROOM_SPACING = 10;
export const ROOM_WIDTH = 8.4;
export const ROOM_DEPTH = 7;
const BACK_WALL_Z = -3.2;

export interface LayoutInput { productId: number; room: string | null; w: number; d: number; h: number }
export interface Placement { productId: number; room: Room; x: number; z: number; rotation: number }

export const roomCenterX = (room: Room) => ROOMS.indexOf(room) * ROOM_SPACING;

/**
 * Large pieces stand against the back wall; smaller ones form a front row.
 * Each row is centred, and the gaps shrink if a row would overflow the room.
 */
export function layoutRooms(items: LayoutInput[]): Placement[] {
  const out: Placement[] = [];
  for (const room of ROOMS) {
    const inRoom = items.filter((i) => (i.room ?? "living") === room).sort((a, b) => b.w - a.w || a.productId - b.productId);
    const back = inRoom.filter((i) => i.w >= 1.4 || i.h >= 1.5);
    const front = inRoom.filter((i) => !back.includes(i));
    const cx = roomCenterX(room);
    const row = (list: LayoutInput[], z: (i: LayoutInput) => number) => {
      if (!list.length) return;
      const total = list.reduce((s, i) => s + i.w, 0);
      const gap = Math.max(0.25, Math.min(0.7, (ROOM_WIDTH - 0.8 - total) / Math.max(1, list.length - 1)));
      let x = cx - (total + gap * (list.length - 1)) / 2;
      for (const i of list) { out.push({ productId: i.productId, room, x: x + i.w / 2, z: z(i), rotation: 0 }); x += i.w + gap; }
    };
    row(back, (i) => BACK_WALL_Z + 0.25 + i.d / 2);
    row(front, () => 0.6);
  }
  return out;
}
