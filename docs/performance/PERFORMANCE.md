# Performance findings (Stage 3)

**How it was measured:** `pnpm --filter @furni/web perf` (`apps/web/perf/measure.mjs`) against the **production build** (`next start`). Each figure is the median of 3 **cold** runs: a fresh browser context with an empty cache, so the three.js chunks are fetched every time. The raw output is `docs/performance/latest.json`.

| Machine | Value |
|---|---|
| Browser | Microsoft Edge 157, headless, `--use-angle=d3d11` |
| WebGL renderer (recorded by the script) | ANGLE: AMD Radeon(TM) Graphics, Direct3D 11. **Real GPU, not SwiftShader** |
| CPU / memory reported | 8 logical cores, deviceMemory 8 |
| Server | Next.js 15.5 `next start`, MySQL 8.0.43, same machine |
| Viewport | 1440 × 900 |

## Results

| Page | Metric | Result |
|---|---|---|
| `/` cinematic hero | TTFB / DOMContentLoaded / load | 42 / 215 / 337 ms |
| | scripted 5 s scroll through all 6 scenes | **345 frames · p50 16.7 ms · p95 16.9 ms (60 fps)** · 1 frame > 33 ms (max 50 ms) |
| | JS heap after the scroll | 13 MB |
| `/collection/102` product | TTFB / DOMContentLoaded / load | 70 / 284 / 530 ms |
| | **3D viewer interactive (cold, includes fetching three.js)** | **1.66 s** |
| `/showroom` | 3D canvas mounted (cold) | 1.63 s |
| | room change + selection until the detail panel shows | 293 ms (the camera walk itself is animated) |
| | JS heap with all 20 pieces in 5 rooms | 22 MB |
| server | time to first byte, all main routes (warm) | 15–85 ms |

## Bundle budget (production build)

| Route | First-load JS |
|---|---|
| `/` | **110 kB** (was 154 kB before GSAP was deferred) |
| `/collection`, `/lab`, `/account`, `/manage` | 106 kB |
| `/collection/[id]` | 116 kB |
| `/showroom` | 113 kB |
| `/studio` | 118 kB |
| shared by all | 102 kB |

| Loaded only on demand | gzip |
|---|---|
| three.js + @react-three/fiber + drei (any 3D view) | 219 kB (838 kB raw) |
| GSAP + ScrollTrigger (cinematic hero only) | 35 kB |

## Budgets set from these measurements

* First-load JS ≤ 120 kB per route (met: 103–118 kB).
* Cinematic scroll p95 frame time ≤ 20 ms on this laptop GPU (met: 16.9 ms).
* 3D viewer interactive ≤ 2.5 s cold on localhost (met: 1.66 s). Warm navigations reuse the cached chunks.
* JS heap ≤ 64 MB on the heaviest 3D page (met: 22 MB).

## Limitations

* Measured on one machine and one GPU. Low-end devices should fall into the automatic "low" tier or 2D (`components/render-mode.tsx`); that tiering has not yet been measured on real low-end hardware.
* Headless timing excludes display compositing. Frame times come from `requestAnimationFrame` intervals.
* In software rendering (SwiftShader, as used in CI-style containers) the same scenes are several times slower. That is why the Docker-based e2e run hit timeouts and ran out of memory.
