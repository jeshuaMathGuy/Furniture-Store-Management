"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRenderMode } from "@/components/render-mode";
import type { HeroPiece, HeroState, SchemaCard } from "./hero-scene";

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

/**
 * Camera and object choreography for the six scenes. Index i is the state at
 * the end of scene i+1. The scroll position scrubs a single GSAP timeline
 * between them.
 */
const KEYS: HeroState[] = [
  { cx: 1.6, cy: 1.25, cz: 3.4, tx: -0.6, ty: 0.5, tz: 0, rot: 0, explode: 0, collection: 0, schema: 0 },            // 1 arrival
  { cx: 0.25, cy: 1.0, cz: 1.55, tx: -0.3, ty: 0.62, tz: -0.05, rot: -0.35, explode: 0, collection: 0, schema: 0 },  // 2 materiality
  { cx: 2.0, cy: 1.1, cz: 3.0, tx: -0.6, ty: 0.5, tz: 0, rot: Math.PI * 0.9, explode: 0, collection: 0, schema: 0 },  // 3 form
  { cx: 2.0, cy: 1.8, cz: 4.1, tx: -0.75, ty: 0.7, tz: 0, rot: Math.PI * 1.2, explode: 1, collection: 0, schema: 0 }, // 4 craft
  { cx: 0.4, cy: 2.8, cz: 8.6, tx: -1.0, ty: 0.45, tz: -1.5, rot: Math.PI * 2, explode: 0, collection: 1, schema: 0 }, // 5 collection
  { cx: 0.3, cy: 1.9, cz: 5.2, tx: -0.8, ty: 0.75, tz: 0, rot: Math.PI * 2.15, explode: 0, collection: 0, schema: 1 }, // 6 beyond
];

export interface Caption { eyebrow: string; title: string; body: string; cta?: { href: string; label: string } }

export function CinematicHero({ chair, collection, cards, captions, fallback }: {
  chair: HeroPiece;
  collection: (HeroPiece & { position: [number, number, number]; rotation: number })[];
  cards: SchemaCard[];
  captions: Caption[];
  fallback: React.ReactNode;
}) {
  const rm = useRenderMode();
  const cinematic = rm.ready && rm.mode === "3d" && !rm.reducedMotion;
  const section = useRef<HTMLElement>(null);
  const state = useRef<HeroState>({ ...KEYS[0]! });
  const invalidateRef = useRef<(() => void) | null>(null);
  const captionEls = useRef<(HTMLDivElement | null)[]>([]);
  const progressEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cinematic || !section.current) return;
    // GSAP is loaded only for visitors who actually get the cinematic version.
    let ctx: { revert: () => void } | undefined;
    let cancelled = false;
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled || !section.current) return;
      gsap.registerPlugin(ScrollTrigger);
      ctx = gsap.context(() => {
      const caps = captionEls.current.filter(Boolean) as HTMLDivElement[];
      gsap.set(caps.slice(1), { autoAlpha: 0, y: 28 });
      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut", duration: 1 },
        onUpdate: () => {
          invalidateRef.current?.();
          if (progressEl.current) progressEl.current.style.transform = `scaleY(${tl.progress()})`;
        },
        scrollTrigger: { trigger: section.current, start: "top top", end: "bottom bottom", scrub: 0.9 },
      });
      for (let i = 1; i < KEYS.length; i++) {
        tl.to(state.current, { ...KEYS[i]! }, i - 1);
        if (caps[i - 1]) tl.to(caps[i - 1]!, { autoAlpha: 0, y: -28, duration: 0.3 }, i - 0.75);
        if (caps[i]) tl.to(caps[i]!, { autoAlpha: 1, y: 0, duration: 0.35 }, i - 0.4);
      }
      }, section);
    });
    return () => { cancelled = true; ctx?.revert(); };
  }, [cinematic]);

  if (!cinematic) return <>{fallback}</>;

  return (
    <section ref={section} aria-label="Introduction" className="relative" style={{ height: `${KEYS.length * 100}vh` }} data-testid="cinematic-hero">
      <a href="#after-hero" className="sr-only focus:not-sr-only focus:absolute focus:right-4 focus:top-4 focus:z-30 btn btn-primary">Skip the introduction</a>
      <div className="sticky top-0 h-dvh overflow-hidden">
        <div className="absolute inset-0"><HeroScene state={state} invalidateRef={invalidateRef} chair={chair} collection={collection} cards={cards} quality={rm.quality} /></div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-porcelain/85 via-porcelain/30 to-transparent max-md:bg-gradient-to-t max-md:from-porcelain/95 max-md:via-porcelain/55" />
        <div className="relative mx-auto flex h-full max-w-7xl items-center px-4 sm:px-6 lg:px-10 max-md:items-end max-md:pb-10">
          {/* Phones: captions sit on a porcelain card at the bottom, so text never runs over the busy part of the scene. */}
          <div className="relative w-full max-w-md max-md:max-w-none">
            {captions.map((c, i) => (
              <div key={c.title} ref={(el) => { captionEls.current[i] = el; }}
                className={`${i === 0 ? "relative" : "absolute inset-x-0 top-1/2 -translate-y-1/2 max-md:top-auto max-md:bottom-0 max-md:translate-y-0"} max-md:rounded-2xl max-md:bg-porcelain/90 max-md:p-5 max-md:shadow-soft max-md:backdrop-blur-sm`}
                data-scene={i + 1} style={i === 0 ? undefined : { opacity: 0, visibility: "hidden" }}>
                <p className="eyebrow">{String(i + 1).padStart(2, "0")} · {c.eyebrow}</p>
                {i === 0
                  ? <h1 className="mt-4 break-words text-5xl leading-[0.98] sm:mt-5 sm:text-7xl">{c.title}</h1>
                  : <h2 className="mt-3 break-words text-3xl leading-tight sm:mt-4 sm:text-5xl">{c.title}</h2>}
                <p className="mt-4 text-[15px] leading-relaxed text-ink-soft sm:mt-5 sm:text-lg">{c.body}</p>
                {c.cta && <Link href={c.cta.href} className="btn btn-primary pointer-events-auto mt-7">{c.cta.label}</Link>}
              </div>
            ))}
          </div>
        </div>
        <div className="absolute bottom-8 right-6 hidden h-24 w-px bg-charcoal/10 md:block" aria-hidden>
          <div ref={progressEl} className="h-full w-px origin-top scale-y-0 bg-charcoal" />
        </div>
        <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-[0.2em] text-ink-soft max-md:hidden" aria-hidden>Scroll</p>
      </div>
    </section>
  );
}
