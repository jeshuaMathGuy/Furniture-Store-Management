"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRenderMode } from "@/components/render-mode";
import { FurnitureGlyph } from "@/components/furniture-glyph";
import { Price, StockBadge } from "@/components/product-bits";
import { formatPrice } from "@/lib/format";
import type { DimsCm } from "@/three/models";
import { ROOMS, ROOM_LABEL, layoutRooms, type Room } from "./layout";
import { vantages, type VantageId } from "./viewpoints";

const ShowroomCanvas = dynamic(() => import("./showroom-canvas"), { ssr: false });

export interface ShowroomItem {
  productId: number; name: string; room: string | null; modelKey: string | null; material: string | null;
  dimensions: DimsCm | null; listPrice: string; offerPrice: string | null; qtyOnHand: number; supplierName: string;
  variant: { material: string; colorHex: string; name: string } | null;
}

/** Visible focus ring that holds 3:1+ against the light scene and porcelain (charcoal, 10.6:1). */
const RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal";

export function Showroom({ items }: { items: ShowroomItem[] }) {
  const rm = useRenderMode();
  const is3d = rm.ready && rm.mode === "3d";
  const [room, setRoom] = useState<Room>("living");
  const [view, setView] = useState<VantageId>("overview");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [moving, setMoving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const piecesNav = useRef<HTMLElement>(null);
  const focusIntent = useRef<{ kind: "detail" } | { kind: "return"; id: number } | null>(null);

  const placements = useMemo(() => layoutRooms(items.map((i) => ({
    productId: i.productId, room: i.room,
    w: (i.dimensions?.widthCm ?? 100) / 100, d: (i.dimensions?.depthCm ?? 60) / 100, h: (i.dimensions?.heightCm ?? 75) / 100,
  }))), [items]);
  const countIn = (r: Room) => placements.filter((p) => p.room === r).length;
  const inRoom = items.filter((i) => placements.find((p) => p.productId === i.productId)?.room === room);
  const selected = items.find((i) => i.productId === selectedId) ?? null;
  const views = vantages(room);

  const chooseRoom = (r: Room) => {
    const walking = is3d && !rm.reducedMotion && r !== room;
    setRoom(r); setView("overview"); setSelectedId(null);
    setAnnouncement(`${ROOM_LABEL[r]}, ${countIn(r)} pieces.${walking ? " Walking through the doorway." : ""}`);
  };
  const chooseView = (id: VantageId) => {
    const v = views.find((x) => x.id === id)!;
    setSelectedId(null); setView(id);
    setAnnouncement(`${ROOM_LABEL[room]}: ${v.label} view.`);
  };
  const select = (id: number) => {
    const p = placements.find((x) => x.productId === id);
    const item = items.find((x) => x.productId === id);
    if (p && p.room !== room) { setRoom(p.room); setView("overview"); }
    focusIntent.current = { kind: "detail" };
    setSelectedId(id); setSheetOpen(true);
    if (item) setAnnouncement(`${item.name} selected. ${formatPrice(item.offerPrice ?? item.listPrice)}, ${item.qtyOnHand > 0 ? `${item.qtyOnHand} in stock` : "out of stock"}.`);
  };
  const deselect = () => {
    if (selectedId === null) return;
    focusIntent.current = { kind: "return", id: selectedId };
    setSelectedId(null);
    setAnnouncement(`Back to the ${ROOM_LABEL[room].toLowerCase()}.`);
  };
  const deselectRef = useRef(deselect);
  useEffect(() => { deselectRef.current = deselect; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") deselectRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus management: a new selection moves focus to its details; stepping back returns it to the list.
  useEffect(() => {
    const intent = focusIntent.current;
    focusIntent.current = null;
    if (intent?.kind === "detail" && selectedId !== null) detailHeading.current?.focus();
    else if (intent?.kind === "return" && selectedId === null)
      root.current?.querySelector<HTMLElement>(`[data-testid="showroom-piece"][data-product="${intent.id}"]`)?.focus();
  }, [selectedId]);

  const skipScene = (e: React.MouseEvent) => {
    e.preventDefault();
    setSheetOpen(true);
    requestAnimationFrame(() => piecesNav.current?.focus());
  };

  return (
    <div ref={root} className="mt-8" data-testid="showroom" data-room={room} data-view={view} data-selected={selectedId ?? ""}
      data-mode={is3d ? "3d" : "2d"} data-camera={moving ? "walking" : "still"} data-motion={rm.reducedMotion ? "reduced" : "full"}>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="showroom-announcer">{announcement}</p>

      <div role="group" aria-label="Rooms" className="flex flex-wrap gap-2">
        {ROOMS.map((r) => (
          <button key={r} type="button" onClick={() => chooseRoom(r)} aria-pressed={room === r}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${RING} ${room === r ? "bg-charcoal text-porcelain" : "bg-limestone text-ink-soft hover:text-charcoal"}`}>
            {ROOM_LABEL[r]} <span className="opacity-80">· {countIn(r)}</span>
          </button>
        ))}
      </div>

      {is3d && (
        <div role="group" aria-label={`Viewpoints in the ${ROOM_LABEL[room].toLowerCase()}`} className="mt-3 flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1" aria-hidden>View</span>
          {views.map((v) => {
            const on = view === v.id && selectedId === null;
            return (
              <button key={v.id} type="button" onClick={() => chooseView(v.id)} aria-pressed={on} data-testid="vantage" data-vantage={v.id}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${RING} ${on ? "border-charcoal bg-charcoal text-porcelain" : "hairline text-charcoal hover:bg-limestone"}`}>
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        {is3d ? (
          <div className="relative aspect-[16/10] overflow-hidden rounded-3xl bg-limestone max-lg:aspect-[4/5]">
            <a href="#showroom-pieces" onClick={skipScene} data-testid="skip-scene"
              className={`sr-only z-30 rounded-full bg-charcoal px-4 py-2 text-sm text-porcelain focus:not-sr-only focus:absolute focus:left-3 focus:top-3 ${RING}`}>
              Skip 3D scene
            </a>
            <ShowroomCanvas items={items} placements={placements} room={room} view={view} selectedId={selectedId} onSelect={select}
              quality={rm.quality} reducedMotion={rm.reducedMotion} moving={moving} onMotion={setMoving} />
            <p className="pointer-events-none absolute bottom-3 left-3 right-3 w-fit rounded-full bg-porcelain/90 px-3 py-1 text-[11px] text-ink-soft max-sm:hidden">
              Drag to look around · choose a viewpoint or a piece · Esc to step back
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={`${ROOM_LABEL[room]} pieces`}>
            {inRoom.map((i) => (
              <li key={i.productId}>
                <button type="button" onClick={() => select(i.productId)} className={`w-full rounded-2xl border p-3 text-left transition-colors ${RING} ${selectedId === i.productId ? "border-charcoal bg-white/60" : "hairline hover:bg-white/40"}`}>
                  <FurnitureGlyph modelKey={i.modelKey} material={i.material} label={i.name} className="aspect-[4/3] w-full rounded-xl bg-limestone p-6" />
                  <span className="mt-2 block font-display text-lg">{i.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Under 1024px the panel is a bottom sheet that stays in reach while the room is on screen. */}
        <aside aria-label="In this room" data-testid="showroom-panel"
          className="max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:rounded-t-3xl max-lg:border max-lg:hairline max-lg:bg-porcelain/95 max-lg:px-4 max-lg:pb-4 max-lg:pt-2 max-lg:shadow-lift max-lg:backdrop-blur">
          <button type="button" onClick={() => setSheetOpen((v) => !v)} aria-expanded={sheetOpen} aria-controls="showroom-sheet-body" data-testid="sheet-toggle"
            className={`flex w-full flex-col items-center gap-1 rounded-xl py-1 text-xs text-ink-soft lg:hidden ${RING}`}>
            <span aria-hidden className="h-1 w-10 rounded-full bg-charcoal/25" />
            <span>{selected ? selected.name : `${ROOM_LABEL[room]} · ${inRoom.length} pieces`} · {sheetOpen ? "Hide" : "Show"} details</span>
          </button>
          <div id="showroom-sheet-body" className={`space-y-4 max-lg:mt-2 max-lg:max-h-[45vh] max-lg:overflow-y-auto ${sheetOpen ? "" : "max-lg:hidden"}`}>
            {selected ? (
              <div className="rounded-3xl border hairline bg-white/50 p-6 max-lg:p-4" data-testid="showroom-detail">
                <p className="eyebrow">{selected.supplierName}</p>
                <h2 ref={detailHeading} tabIndex={-1} className={`mt-2 text-3xl leading-tight max-lg:text-2xl ${RING}`}>{selected.name}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2"><Price list={selected.listPrice} offer={selected.offerPrice} /><StockBadge qty={selected.qtyOnHand} /></div>
                {selected.dimensions && <p className="mt-3 text-sm text-ink-soft">{selected.dimensions.widthCm} × {selected.dimensions.depthCm} × {selected.dimensions.heightCm} cm · {selected.material}</p>}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href={`/collection/${selected.productId}`} className={`btn btn-primary h-10 ${RING}`}>View details</Link>
                  <Link href={`/studio?product=${selected.productId}`} className={`btn btn-ghost h-10 ${RING}`}>Configure</Link>
                </div>
                <button type="button" onClick={deselect} className={`mt-4 text-xs text-ink-soft underline underline-offset-4 ${RING}`}>Back to the room</button>
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed hairline p-6 text-sm text-ink-soft max-lg:p-4">
                Select a piece to see its price, stock and dimensions from the store database.
              </div>
            )}
            <nav id="showroom-pieces" ref={piecesNav} tabIndex={-1} aria-label={`Pieces in the ${ROOM_LABEL[room].toLowerCase()}`} className={`rounded-xl ${RING}`}>
              <ul className="space-y-1">
                {inRoom.map((i) => (
                  <li key={i.productId}>
                    <button type="button" onClick={() => select(i.productId)} aria-pressed={selectedId === i.productId} data-testid="showroom-piece" data-product={i.productId}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${RING} ${selectedId === i.productId ? "bg-charcoal text-porcelain" : "hover:bg-limestone"}`}>
                      <span>{i.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
