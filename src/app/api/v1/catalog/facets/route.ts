/**
 * Що можна вибрати у фільтрі при поточному наборі умов.
 *
 * Одним запитом, а не трьома: панель фільтрів відкривається як одне вікно,
 * і три послідовні походи по мережі означали б, що бренди вже видно, типи ще
 * ні, а повзунок ціни стрибає, коли приїде третя відповідь.
 */

import { NextResponse } from "next/server";
import { getBrandTree, getBrandTypes, getPriceBounds } from "@/lib/catalog/brand-tree";

export const revalidate = 3600;

export async function GET(req: Request) {
  const brand = new URL(req.url).searchParams.get("brand");

  const [brands, types, price] = await Promise.all([
    getBrandTree(),
    /**
     * Типи звужуємо до обраного бренда: у SIGMA свої 24 типи, і показувати
     * там «Бензопила», якої в неї немає, означає обіцяти порожню видачу.
     */
    getBrandTypes(brand),
    getPriceBounds(),
  ]);

  return NextResponse.json({
    brands: [...brands.main, ...brands.tail].map((b) => ({
      slug: b.slug,
      name: b.name,
      count: b.count,
    })),
    types,
    price,
  });
}
