/**
 * Підказки пошуку для застосунку.
 *
 * Раніше застосунок їх не мав узагалі: на кожен натиск він тягнув повну
 * сторінку каталогу — двадцять чотири картки з описами, щоб показати вісім
 * рядків. Тут приїжджає рівно те, що малює випадайка.
 *
 * Драбина пошуку й уточнення спільні з сайтом (lib/catalog/suggest): на
 * однаковий запит вітрина й застосунок мусять показувати те саме.
 */

import { NextResponse } from "next/server";
import { suggestAll } from "@/lib/catalog/suggest";
import { productLabel } from "@/lib/catalog/category-display";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const { items, brands, types } = await suggestAll(searchParams.get("q") ?? "");

  return NextResponse.json({
    items: items.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku,
      price: p.price,
      image: p.image,
      stock: p.stock,
      /**
       * Ярлик над назвою: категорія, якщо вона осмислена, інакше бренд.
       * Сирої категорії з 1С тут немає навмисно — 84% товарів лежать у
       * звалищі «Імпорт з 1С», а решта груп називається числами.
       */
      label: productLabel(p.category, p.brand),
    })),
    brands,
    types,
  });
}
