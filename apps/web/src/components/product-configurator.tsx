"use client";

import { useState } from "react";
import { FurnitureViewer, type ViewerVariant } from "@/components/viewer/furniture-viewer";
import type { DimsCm } from "@/three/models";
import { formatPrice } from "@/lib/format";
import { AddToCart } from "@/components/add-to-cart";

export interface ConfigVariant extends ViewerVariant { priceDelta: string; qtyOnHand: number }

/** Product viewer plus finish selection. The chosen finish is applied to the 3D model's materials. */
export function ProductConfigurator({ productId, name, modelKey, dimensions, material, variants, qtyOnHand, purchasable = true, viewerClassName = "aspect-[5/4]" }: {
  productId: number; name: string; modelKey: string | null; dimensions: DimsCm | null; material: string | null; variants: ConfigVariant[];
  qtyOnHand: number; purchasable?: boolean; viewerClassName?: string;
}) {
  const [selected, setSelected] = useState<number | null>(variants[0]?.variantId ?? null);
  const variant = variants.find((v) => v.variantId === selected) ?? null;
  return (
    <div>
      <FurnitureViewer name={name} modelKey={modelKey} dimensions={dimensions} material={material} variant={variant} className={viewerClassName} />
      {variants.length > 0 && (
        <fieldset className="mt-6">
          <legend className="eyebrow mb-3">Finish{variant ? ` · ${variant.name}` : ""}</legend>
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Finish">
            {variants.map((v) => {
              const on = v.variantId === selected;
              return (
                <label key={v.variantId} data-testid="finish-option"
                  className={`flex cursor-pointer items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass ${on ? "border-charcoal bg-white/60" : "hairline hover:bg-white/40"}`}>
                  <input type="radio" name={`finish-${name}`} value={v.variantId} checked={on} onChange={() => setSelected(v.variantId)} className="sr-only" />
                  <span className="size-6 rounded-full border border-charcoal/15" style={{ background: v.colorHex }} aria-hidden />
                  <span>{v.name}</span>
                  {Number(v.priceDelta) > 0 && <span className="text-ink-soft">+{formatPrice(v.priceDelta)}</span>}
                  <span className="text-xs text-ink-soft">({v.qtyOnHand > 0 ? `${v.qtyOnHand} left` : "out of stock"})</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {purchasable && (
        <div className="mt-6">
          {/* Stock limit: the product's stock, further limited by the chosen finish's stock when it is tracked. */}
          <AddToCart productId={productId} variantId={variant?.variantId ?? null} variantLabel={variant?.name}
            available={variant ? Math.min(qtyOnHand, variant.qtyOnHand) : qtyOnHand} />
        </div>
      )}
    </div>
  );
}
