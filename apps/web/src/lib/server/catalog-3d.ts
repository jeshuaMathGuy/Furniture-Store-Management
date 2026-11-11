import "server-only";
import { catalog, productDetail } from "@furni/database";
import { db } from "./db";

export type Product3D = NonNullable<Awaited<ReturnType<typeof productDetail.getProduct>>>;

/** Full detail for every active product (20 today), for the Studio and Showroom. */
export async function allProductDetails(asOf: string): Promise<Product3D[]> {
  const list = await catalog.listProducts(db(), { asOf });
  const details = await Promise.all(list.map((p) => productDetail.getProduct(db(), p.productId, asOf)));
  return details.filter((d): d is Product3D => d !== null);
}
