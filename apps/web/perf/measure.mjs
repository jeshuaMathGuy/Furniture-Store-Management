// Performance measurement against a running production server.
// Usage: pnpm --filter @furni/web perf   (server must be running; default http://127.0.0.1:3000)
// It records the WebGL renderer actually used, so software-rendered (SwiftShader) runs are never reported as GPU results.
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3000";
const RUNS = Number(process.env.PERF_RUNS ?? 3);

const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL ?? "msedge",
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info"],
});

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function renderer(page) {
  return page.evaluate(() => {
    const g = document.createElement("canvas").getContext("webgl2");
    const d = g && g.getExtension("WEBGL_debug_renderer_info");
    return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : "no WebGL";
  });
}

async function navTiming(page) {
  return page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const js = performance.getEntriesByType("resource").filter((r) => r.name.endsWith(".js"));
    return {
      ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd,
      jsTransferredKB: js.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024,
    };
  });
}

const results = { base: BASE, runs: RUNS, measuredAt: new Date().toISOString(), renderer: null, pages: {} };

// 1. Product page: time until the 3D viewer reports ready.
{
  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    const { ctx, page } = await fresh();
    const t0 = Date.now();
    await page.goto(`${BASE}/collection/102`);
    await page.locator("[data-testid=furniture-viewer][data-mode='3d'][data-ready='true']").waitFor({ timeout: 30_000 });
    const viewerReadyMs = Date.now() - t0;
    results.renderer ??= await renderer(page);
    rows.push({ ...(await navTiming(page)), viewerReadyMs });
    await ctx.close();
  }
  results.pages["/collection/102"] = summarise(rows);
}

// 2. Home: cinematic hero, then a scripted 5 s scroll through all six scenes with frame timing.
{
  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    const { ctx, page } = await fresh();
    await page.goto(`${BASE}/`);
    await page.locator("[data-testid=cinematic-hero] canvas").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const nav = await navTiming(page);
    const frames = await page.evaluate(async () => {
      const hero = document.querySelector("[data-testid=cinematic-hero]");
      const total = hero.offsetHeight - innerHeight;
      const out = []; let last = performance.now(), run = true;
      const tick = (t) => { out.push(t - last); last = t; if (run) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      const t0 = performance.now(), dur = 5000;
      await new Promise((res) => {
        const step = () => { const p = Math.min(1, (performance.now() - t0) / dur); scrollTo(0, p * total); if (p < 1) requestAnimationFrame(step); else setTimeout(res, 800); };
        requestAnimationFrame(step);
      });
      run = false;
      return { frames: out.slice(2), heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null };
    });
    const f = frames.frames;
    rows.push({ ...nav, frameP50: pct(f, 0.5), frameP95: pct(f, 0.95), frameMax: Math.max(...f),
      over33ms: f.filter((x) => x > 33.4).length, frames: f.length, heapMB: frames.heapMB });
    await ctx.close();
  }
  results.pages["/ (cinematic scroll)"] = summarise(rows);
}

// 3. Showroom: canvas mounted, then a room change and a selection (camera walk).
{
  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    const { ctx, page } = await fresh();
    const t0 = Date.now();
    await page.goto(`${BASE}/showroom`);
    await page.locator("[data-testid=showroom] canvas").waitFor({ timeout: 30_000 });
    const canvasMs = Date.now() - t0;
    const t1 = Date.now();
    await page.getByRole("button", { name: /Home office/ }).click();
    await page.getByTestId("showroom-piece").filter({ hasText: "Oak Executive Desk" }).click();
    await page.getByTestId("showroom-detail").waitFor();
    rows.push({ ...(await navTiming(page)), canvasMs, selectMs: Date.now() - t1,
      heapMB: await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null)) });
    await ctx.close();
  }
  results.pages["/showroom"] = summarise(rows);
}

await browser.close();

function summarise(rows) {
  const keys = Object.keys(rows[0]);
  return Object.fromEntries(keys.map((k) => [k, rows.every((r) => typeof r[k] === "number") ? Math.round(median(rows.map((r) => r[k])) * 10) / 10 : rows[0][k]]));
}

const out = resolve(import.meta.dirname, "../../../docs/performance/latest.json");
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
