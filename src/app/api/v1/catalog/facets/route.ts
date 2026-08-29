/**
 * Що можна вибрати у фільтрі при поточному наборі умов.
 *
 * Одним запитом, а не трьома: панель фільтрів відкривається як одне вікно,
 * і три послідовні походи по мережі означали б, що бренди вже видно, типи ще
 * ні, а повзунок ціни стрибає, коли приїде третя відповідь.
 */

import { NextResponse } from "next/server";
import { getBrandTree, getBrandTypes, getPriceBounds } from "@/lib/catalog/brand-tree";
import { SECTIONS } from "@/lib/catalog/classify";
import { parseFilters, fetchSectionFacets, fetchAttrFacets } from "@/lib/catalog/query";

export const revalidate = 3600;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const brand = sp.get("brand");
  const section = sp.get("section");

  const filters = parseFilters(sp);

  const [brands, types, price, sectionFacets, attrs] = await Promise.all([
    getBrandTree(),
    /**
     * Типи звужуємо до обраного бренда: у SIGMA свої 24 типи, і показувати
     * там «Бензопила», якої в неї немає, означає обіцяти порожню видачу.
     *
     * Розділ звужує далі — інакше застосунок, як і сайт колись, губив рівень
     * розділу всередині бренда: людина обирала «Малярний», а список груп
     * лишався плоским переліком усіх груп бренда.
     */
    getBrandTypes(brand, { section: section ?? undefined, shoppable: true }),
    getPriceBounds(),
    fetchSectionFacets(filters),
    fetchAttrFacets(filters),
  ]);

  return NextResponse.json({
    brands: [...brands.main, ...brands.tail].map((b) => ({
      slug: b.slug,
      name: b.name,
      count: b.count,
      color: b.color,
      logoUrl: b.logoUrl,
    })),
    types,
    // Поле лише додається — старі збірки застосунку його не читають.
    sections: SECTIONS.map((s) => ({ id: s.id, title: s.title, count: sectionFacets[s.id] ?? 0 }))
      .filter((s) => s.count > 0),
    // Характеристики доречні лише для конкретних груп («діаметр диска» — про
    // болгарки), тож без ?type= чи ?section= масив порожній.
    attrs,
    price,
  });
}
