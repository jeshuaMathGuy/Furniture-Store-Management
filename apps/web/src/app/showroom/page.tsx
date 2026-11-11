import type { Metadata } from "next";
import { asOfDate } from "@/lib/server/db";
import { allProductDetails } from "@/lib/server/catalog-3d";
import { Showroom, type ShowroomItem } from "@/components/showroom/showroom";

export const metadata: Metadata = { title: "Showroom" };
export const dynamic = "force-dynamic";

export default async function ShowroomPage() {
  const products = await allProductDetails(asOfDate());
  const items: ShowroomItem[] = products.map((p) => ({
    productId: p.productId, name: p.name, room: p.room, modelKey: p.modelKey, material: p.material, dimensions: p.dimensions,
    listPrice: p.listPrice, offerPrice: p.offerPrice, qtyOnHand: p.qtyOnHand, supplierName: p.supplierName,
    variant: p.variants[0] ? { material: p.variants[0].material, colorHex: p.variants[0].colorHex, name: p.variants[0].name } : null,
  }));
  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 lg:px-10">
      <header className="rise max-w-3xl">
        <p className="eyebrow">Showroom</p>
        <h1 className="mt-3 text-5xl leading-[1.05] sm:text-6xl">Rooms you can walk through.</h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          Every piece in the catalogue, arranged by the room recorded for it in the database. Move between rooms, select a piece, and the camera walks over to it.
        </p>
      </header>
      <Showroom items={items} />
    </div>
  );
}
