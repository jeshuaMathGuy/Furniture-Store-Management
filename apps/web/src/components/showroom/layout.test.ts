import { describe, expect, it } from "vitest";
import { ROOM_WIDTH, layoutRooms, roomCenterX } from "./layout";

const items = [
  { productId: 201, room: "living", w: 2.8, d: 1.0, h: 0.78 }, { productId: 203, room: "living", w: 0.82, d: 0.8, h: 0.74 },
  { productId: 204, room: "living", w: 1.2, d: 0.65, h: 0.38 }, { productId: 303, room: "living", w: 0.78, d: 0.82, h: 0.96 },
  { productId: 101, room: "office", w: 1.8, d: 0.85, h: 0.76 }, { productId: 104, room: "office", w: 0.9, d: 0.35, h: 2.0 },
  { productId: 999, room: null, w: 1, d: 1, h: 1 },
];

describe("showroom layout", () => {
  const out = layoutRooms(items);
  it("places every item exactly once, in its recorded room (null → living)", () => {
    expect(out.map((p) => p.productId).sort()).toEqual(items.map((i) => i.productId).sort());
    expect(out.find((p) => p.productId === 101)!.room).toBe("office");
    expect(out.find((p) => p.productId === 999)!.room).toBe("living");
  });
  it("keeps every piece inside its room and stops pieces in a row from overlapping", () => {
    for (const p of out) {
      const i = items.find((x) => x.productId === p.productId)!;
      expect(Math.abs(p.x - roomCenterX(p.room)) + i.w / 2).toBeLessThanOrEqual(ROOM_WIDTH / 2);
    }
    const rows = new Map<string, { x: number; w: number }[]>();
    for (const p of out) {
      const i = items.find((x) => x.productId === p.productId)!;
      const key = `${p.room}:${p.z > -1 ? "front" : "back"}`;
      rows.set(key, [...(rows.get(key) ?? []), { x: p.x, w: i.w }]);
    }
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      for (let k = 1; k < row.length; k++) expect(row[k]!.x - row[k]!.w / 2).toBeGreaterThan(row[k - 1]!.x + row[k - 1]!.w / 2);
    }
  });
  it("large and tall pieces stand against the back wall", () => {
    expect(out.find((p) => p.productId === 201)!.z).toBeLessThan(-1);
    expect(out.find((p) => p.productId === 104)!.z).toBeLessThan(-1);
    expect(out.find((p) => p.productId === 203)!.z).toBeGreaterThan(0);
  });
});
