import { describe, expect, it } from "vitest";
import { ROOMS, roomCenterX } from "./layout";
import { ARCH, MAX_AZIMUTH, focusView, pathLength, roomBounds, roomIndexAt, vantages, walkDuration, walkPath } from "./viewpoints";

describe("showroom viewpoints", () => {
  it.each(ROOMS)("%s: overview plus three named vantage points, all inside the room's camera limits", (room) => {
    const vs = vantages(room);
    expect(vs[0]!.id).toBe("overview");
    expect(vs).toHaveLength(4);
    expect(new Set(vs.map((v) => v.label)).size).toBe(4);
    const b = roomBounds(room);
    for (const v of vs) {
      const [x, y, z] = v.position;
      expect(x).toBeGreaterThanOrEqual(b.minX); expect(x).toBeLessThanOrEqual(b.maxX);
      expect(y).toBeGreaterThanOrEqual(b.minY); expect(y).toBeLessThanOrEqual(b.maxY);
      expect(z).toBeGreaterThanOrEqual(b.minZ); expect(z).toBeLessThanOrEqual(b.maxZ);
      const az = Math.atan2(x - v.target[0], z - v.target[2]);
      expect(Math.abs(az), `${room}/${v.id}`).toBeLessThanOrEqual(MAX_AZIMUTH);
    }
  });

  it("focusing a piece never puts the camera through a wall", () => {
    const f = focusView("office", { x: roomCenterX("office") + 4, z: -2.6, w: 2.4, h: 2.0 });
    const b = roomBounds("office");
    expect(f.position[0]).toBeLessThanOrEqual(b.maxX);
    expect(f.target[0]).toBe(roomCenterX("office") + 4);
  });

  it("walking between rooms passes through every door opening at eye height, below the door head", () => {
    const from: [number, number, number] = [0.6, 2.8, 6.4];
    const pts = walkPath(from, "office", [20.6, 2.8, 6.4]);
    expect(pts[0]).toEqual(from);
    expect(pts.at(-1)).toEqual([20.6, 2.8, 6.4]);
    const doors = [5, 15];
    for (const dx of doors) {
      const before = pts.find((p) => Math.abs(p[0] - (dx - 1.4)) < 1e-9)!;
      const after = pts.find((p) => Math.abs(p[0] - (dx + 1.4)) < 1e-9)!;
      for (const p of [before, after]) { expect(p[2]).toBe(ARCH.doorZ); expect(p[1]).toBeLessThan(ARCH.doorH); }
    }
    // Backwards works too, and staying in a room is a direct move.
    expect(walkPath([20, 2, 5], "living", [0.6, 2.8, 6.4]).length).toBe(2 + 4);
    expect(walkPath([0.6, 2.8, 6.4], "living", [1, 1, 1])).toHaveLength(2);
  });

  it("room index and walk duration are bounded", () => {
    expect(roomIndexAt(-30)).toBe(0);
    expect(roomIndexAt(21)).toBe(2);
    expect(roomIndexAt(999)).toBe(ROOMS.length - 1);
    expect(walkDuration(0)).toBeGreaterThan(0.5);
    expect(walkDuration(pathLength(walkPath([0.6, 2.8, 6.4], "studio", [40.6, 2.8, 6.4])))).toBeLessThanOrEqual(4.2);
  });
});
