import Link from "next/link";
import { catalog, productDetail } from "@furni/database";
import { asOfDate, db } from "@/lib/server/db";
import { FurnitureGlyph } from "@/components/furniture-glyph";
import { ProductCard } from "@/components/product-bits";
import { CinematicHero, type Caption } from "@/components/hero/cinematic-hero";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

const ORIGINAL_IDS = [101, 102, 201, 202];

export default async function Discover() {
  const asOf = asOfDate();
  const all = await catalog.listProducts(db(), { asOf });
  const signature = all.filter((p) => ORIGINAL_IDS.includes(p.productId));
  const count = all.length;

  // Live records for the cinematic scenes: the hero chair is product 102 from the original SQL.
  const [chair, desk, sofa, table] = await Promise.all([102, 101, 201, 202].map((id) => productDetail.getProduct(db(), id, asOf)));
  const piece = (p: NonNullable<typeof chair>) => ({ productId: p.productId, name: p.name, modelKey: p.modelKey, material: p.material, dimensions: p.dimensions });
  const placed: [typeof chair, [number, number, number], number][] = [[desk, [-2.6, 0, -2.0], 0.35], [sofa, [2.7, 0, -2.6], -0.45], [table, [0, 0, -4.0], 0]];
  const collection = placed.flatMap(([p, position, rotation]) => (p ? [{ ...piece(p), position, rotation }] : []));

  const captions: Caption[] = chair ? [
    { eyebrow: "Arrival", title: "Architecture you can sit in.", body: "Quiet, honest pieces in oak, linen and stone. Each one is a row in a database you can open, question and take apart." },
    { eyebrow: "Materiality", title: `${chair.material ?? "Oak"}, steam-bent and hand-oiled.`,
      body: `The ${chair.name} comes in ${chair.variants.map((v) => v.name).join(" or ") || "one finish"}. The grain and weave you see are generated in the browser, not photographs.` },
    { eyebrow: "Form", title: "A silhouette that reads from every side.",
      body: chair.dimensions ? `${chair.dimensions.widthCm} × ${chair.dimensions.depthCm} × ${chair.dimensions.heightCm} cm, the exact dimensions stored for product ${chair.productId}, drawn to scale.` : "Drawn to the recorded dimensions." },
    { eyebrow: "Craft", title: "Seat, legs, back and rail.",
      body: "Pulled apart to show how this procedural model is assembled. It illustrates the build; it is not a manufacturer's drawing." },
    { eyebrow: "Collection", title: "One piece among a collection.",
      body: `It joins the desk, sofa and dining table that founded the catalogue, now ${count} pieces. Prices start at ${formatPrice(Math.min(...all.map((p) => Number(p.offerPrice ?? p.listPrice))))}.`,
      cta: { href: "/collection", label: "Explore the collection" } },
    { eyebrow: "Beyond the surface", title: "Every chair is also a row.",
      body: "Product, supplier, stock and warranty are separate, normalized relations joined by keys. The cards show the live rows behind this chair.",
      cta: { href: "/lab", label: "Enter the Database Lab" } },
  ] : [];
  const cards = chair ? [
    { table: "product", position: [-0.6, 1.55, 0.4] as [number, number, number], rows: [["product_id", String(chair.productId)], ["product_name", chair.name], ["supplier_id", String(chair.supplierId)], ["list_price", chair.listPrice]] as [string, string][] },
    { table: "supplier", position: [0.95, 1.3, -0.4] as [number, number, number], rows: [["supplier_id", String(chair.supplierId)], ["supplier_name", chair.supplierName]] as [string, string][] },
    { table: "product_inventory", position: [-0.5, 0.15, 1.0] as [number, number, number], rows: [["product_id", String(chair.productId)], ["qty_on_hand", String(chair.qtyOnHand)]] as [string, string][] },
    { table: "warranty_plan", position: [1.0, 0.1, 0.7] as [number, number, number], rows: [["supplier_id", String(chair.supplierId)], ["warranty_months", chair.warrantyMonths.join(", ") || "—"]] as [string, string][] },
  ] : [];

  const staticTop = (
    <>
      {/* 2D editorial hero: shown with reduced motion, in 2D mode, without WebGL, and before hydration. */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:px-10 lg:pt-24">
          <div className="rise">
            <p className="eyebrow">Furniture studio · est. in a relational schema</p>
            <h1 className="mt-6 text-6xl leading-[0.98] sm:text-7xl lg:text-8xl">
              Architecture<br />you can <em className="whitespace-nowrap text-clay-deep">sit in.</em>
            </h1>
            <p className="mt-8 max-w-md text-lg leading-relaxed text-ink-soft">
              Quiet, honest pieces in oak, linen and stone. Each one is a row in a database
              you can open, question and take apart.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/collection" className="btn btn-primary">Explore the collection</Link>
              <Link href="/lab" className="btn btn-ghost">Look beneath the surface</Link>
            </div>
          </div>
          <div className="rise relative aspect-square [animation-delay:120ms]" aria-hidden>
            <div className="absolute inset-[8%] rounded-[40%_40%_6%_6%] bg-limestone" />
            <div className="absolute inset-x-[14%] bottom-[18%] h-px bg-charcoal/15" />
            <FurnitureGlyph modelKey="lounge_chair" color="#B77D63" label="Clay bouclé lounge chair" className="absolute inset-[12%] h-[76%] w-[76%]" />
            <FurnitureGlyph modelKey="side_table" material="Oak" label="Oak side table" className="absolute bottom-[14%] right-[2%] h-[38%] w-[38%]" />
          </div>
        </div>
      </section>

      {/* Scene 2: Materiality */}
      <section className="border-y hairline bg-limestone/60">
        <div className="mx-auto grid max-w-7xl gap-px px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-10">
          {[
            ["Oak", "#C8A27A", "Quarter-sawn, hand-oiled, with grain matched across each surface."],
            ["Linen", "#E3D8C6", "Stone-washed natural fibre that softens with use."],
            ["Travertine", "#E2D3BC", "Honed limestone, left with its open pores."],
            ["Brass", "#B08D57", "Brushed fittings that develop a patina over time."],
          ].map(([name, color, text]) => (
            <div key={name} className="py-10 pr-6">
              <span className="block size-10 rounded-full shadow-soft" style={{ background: color }} aria-hidden />
              <h2 className="mt-5 text-2xl">{name}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{text}</p>
            </div>
          ))}
        </div>
      </section>

    </>
  );

  return (
    <>
      {chair ? (
        <CinematicHero chair={piece(chair)} collection={collection} cards={cards} captions={captions} fallback={staticTop} />
      ) : staticTop}
      <div id="after-hero" />

      {/* The founding four */}
      <section className="mx-auto max-w-7xl px-4 pt-24 sm:px-6 lg:px-10" aria-labelledby="signature">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow">The founding four</p>
            <h2 id="signature" className="mt-3 text-4xl sm:text-5xl">Where the catalogue began.</h2>
            <p className="mt-3 max-w-xl text-ink-soft">
              These four pieces are the products in the original SQL dataset. The other {count - signature.length} were added as clearly labelled demonstration records.
            </p>
          </div>
          <Link href="/collection" className="btn btn-ghost">All {count} pieces</Link>
        </div>
        <ul className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {signature.map((p) => <li key={p.productId}><ProductCard item={p} /></li>)}
        </ul>
      </section>

      {/* Beyond the surface */}
      <section className="mx-auto mt-28 max-w-7xl px-4 sm:px-6 lg:px-10" aria-labelledby="beyond">
        <div className="grid overflow-hidden rounded-[2rem] bg-charcoal text-porcelain lg:grid-cols-2">
          <div className="p-10 sm:p-14">
            <p className="eyebrow !text-oat">Beyond the surface</p>
            <h2 id="beyond" className="mt-4 text-4xl sm:text-5xl">Every chair is also a row.</h2>
            <p className="mt-5 max-w-md leading-relaxed text-oat">
              The storefront is backed by a normalized MySQL schema with 20 original relations, 5 stored procedures and 5 triggers.
              The Database Lab lets you take it apart, from unnormalized JSON down to fourth normal form.
            </p>
            <Link href="/lab" className="btn mt-8 bg-porcelain text-charcoal hover:bg-oat">Enter the Database Lab</Link>
          </div>
          <svg viewBox="0 0 420 300" className="h-full w-full bg-[#30332e] p-8" role="img"
            aria-label="Diagram: product references supplier; product_inventory and offer reference product">
            {[
              { x: 150, y: 120, t: "product", k: "product_id" },
              { x: 150, y: 20, t: "supplier", k: "supplier_id" },
              { x: 20, y: 220, t: "product_inventory", k: "product_id" },
              { x: 280, y: 220, t: "offer", k: "offer_id" },
            ].map((n) => (
              <g key={n.t}>
                <rect x={n.x} y={n.y} width={120} height={56} rx={10} fill="#F5F1E9" fillOpacity={0.06} stroke="#D9C7B5" strokeOpacity={0.35} />
                <text x={n.x + 12} y={n.y + 23} fill="#F5F1E9" fontSize={13} fontFamily="var(--font-jetbrains)">{n.t}</text>
                <text x={n.x + 12} y={n.y + 42} fill="#B08D57" fontSize={10} fontFamily="var(--font-jetbrains)">PK {n.k}</text>
              </g>
            ))}
            <g stroke="#A8B09D" strokeWidth={1.2} fill="none">
              <path d="M210 120 V76" /><path d="M150 160 H80 V220" /><path d="M270 160 H340 V220" />
            </g>
          </svg>
        </div>
      </section>
    </>
  );
}
