# 3D experience (Stage 3)

## What is real and what is illustrative

| Element | Source | Notes |
|---|---|---|
| Dimensions, material, finishes, price, stock, room | live database (`product`, `product_detail`, `product_variant`, `offer`, `product_inventory`) | Every 3D view is built from these values. |
| Furniture geometry | **procedural**, `apps/web/src/three/models.ts` | 16 parametric builders (one per `model_key`). No licensed GLB assets exist yet. Unit tests confirm each model's bounding box matches the database dimensions to within 1 cm. |
| Exploded assembly | procedural part list with explode vectors | It shows how *this model* is assembled. The UI says it is not a manufacturer drawing. |
| Wood grain, fabric weave, stone | generated on `<canvas>` at runtime | No texture downloads. Materials are cached and shared across scenes. |
| Lighting | local Lightformers plus contact shadows | No HDR download and no real-time shadow maps. |
| Scene 6 "relational cards" | live rows for product 102 (product, supplier, inventory, warranty plan) | Public fields only; the supplier's phone number is never sent. |

Replacing a procedural model with a GLB later only means changing the renderer for that `model_key`. The data contract (dimensions, finishes, part labels) stays the same.

## Components

```
three/models.ts            pure: builders, bounds, resolveSlot(), variantSpec()  ← unit-tested
three/materials.ts         procedural textures + cached materials (high/low quality)
three/furniture-model.tsx  renders parts; damped explode; per-instance fades
three/studio-lighting.tsx  hemisphere + key/fill lights, local environment, contact shadows
components/viewer/         FurnitureViewer (+ lazily loaded ViewerCanvas)
components/hero/           CinematicHero (GSAP ScrollTrigger) + HeroScene
components/showroom/       layout.ts (pure, tested) + Showroom UI + ShowroomCanvas
components/studio/         configurator + comparison
components/render-mode.tsx capability detection, user preference, footer control
```

### Finish resolution

`resolveSlot(slot, productMaterial, variant)` decides what each part slot (frame, surface, upholstery, cushion, metal, accent) is made of. A variant's colour goes to the finish its **name** describes. The seed row "Natural Oak / Sage Fabric" is stored with `material = Oak`, but its colour belongs to the fabric. Reading only the `material` column painted the oak frame sage; a regression test now covers this.

## Render modes

| Condition | Result |
|---|---|
| Before hydration / no JavaScript | 2D elevation drawings and the editorial hero (server-rendered) |
| No WebGL | 2D |
| `prefers-reduced-motion` | Viewers stay 3D without auto-rotation or animated transitions; the home page uses the static editorial hero instead of the scroll film |
| Data saver, ≤2 GB memory or ≤2 cores (auto) | 2D |
| ≤4 GB or ≤4 cores (auto) | 3D, low quality: DPR 1, no MSAA, smaller textures and shadow maps, no sheen |
| Otherwise (auto) | 3D, high quality: DPR up to 1.75 |
| User choice | "Rendering: Auto / 3D / 2D only" in the footer, or "Use 2D view" on any viewer (stored in localStorage) |

All business functions work in 2D.

## Performance design

* **Nothing 3D in the initial bundles.** three.js, R3F and drei load only when a 3D view mounts (`next/dynamic`, `ssr: false`). GSAP loads only for visitors who get the cinematic hero.
* **Rendering on demand.** Every canvas uses `frameloop="demand"`. Frames are requested only by interaction, damped transitions (stopped when converged), scroll-timeline updates, or auto-rotate (the only mode that switches to a continuous loop).
* **Bounded quality.** DPR is clamped; low quality turns off antialiasing and uses 256 px textures, 64 px environment maps and 256 px contact shadows.
* **Shared materials.** One material per finish and colour across the whole app. The hero's fading pieces clone their materials and dispose of them on unmount.
* **Cleanup.** R3F disposes of geometries when components unmount; the GSAP context is reverted on unmount.

**Measured results** (60 fps cinematic scroll on a laptop GPU, 3D viewer interactive in 1.66 s from a cold start, 103–118 kB first-load JS per route): see [PERFORMANCE.md](../performance/PERFORMANCE.md).

## Stage 8 (polish)

* **Showroom rooms** (`components/showroom/room-architecture.tsx`, `viewpoints.ts`): timber or stone procedural floors (`three/architecture-materials.ts`), walls with skirting and cornice, a ceiling edge, a daylight window with a soft light pool, doors between rooms, a rug, a pendant and a plant. Each room has an overview plus three named viewpoints. Changing room walks the camera through the door openings along an eased path. Orbiting is clamped to the room. With reduced motion every change is a jump cut. Hotspots supplement the piece list, which is still the main way to select.
* **Assembly** (`three/assembly.ts`, unit-tested): steps group parts by label in a per-model curated order, and labels without a curated position are placed using their explode vectors. A step slider ("Step 2 of 4: Upholstered seat") highlights the current part and ghosts the parts not yet fitted. Exploded mode shows leader-line labels. The UI says this is an illustration of the procedural model, not a manufacturer drawing.
* **Accessibility**: aria-live announcements for room, viewpoint and selection. Selecting a piece moves focus to its details, and Escape returns focus to the list. Charcoal focus rings on 3D controls (the brass ring is below 3:1 on porcelain). "Skip 3D scene" and "Skip 3D viewer" links.
* **Responsive**: the viewer toolbar folds behind one button below 640 px, the showroom panel becomes a sticky bottom sheet below 1024 px, and hero captions sit on a porcelain card on phones. No horizontal scroll at 375 px on /, /showroom, /studio or /collection/101.
