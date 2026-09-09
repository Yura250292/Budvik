/**
 * Рекомендації картки товару — одним заходом і без повторів між блоками.
 *
 * До 09.09.2026 кожен блок збирався сам по собі, і виходило так: у базі всього
 * 6 замовлень, тож «Часто купують разом» майже завжди йшов у запасний шлях, а
 * той брав сусідів по бренду — тобто рівно те, що вже показував блок «Інші
 * розміри та виробники» під ним. На 25 картках із 31 покупець бачив ті самі
 * чотири товари двічі під різними заголовками, а до туристичного мультитула за
 * 170 ₴ обидва блоки радили автомобільні компресори по тисячі.
 *
 * Тому правило: **блоки збирає одна функція**, «разом» ніколи не падає в
 * сусідство (це робота блоку нижче) і завжди виключає те, що вже показано.
 * Немає чого сказати — блок ховається, і це нормально.
 */

import { prisma } from "@/lib/prisma";
import { showableProductWhere } from "./showable";
import { isServiceCategory } from "./category-display";
import { findSameType, findComplementary, RECO_SELECT, type Candidate } from "./related";

export type Reco = Candidate;

/** Скільки карток у блоці. Сітка на телефоні дві в ряд, на екрані чотири. */
const TAKE = 4;

type ProductLike = {
  id: string;
  name: string;
  brandId: string | null;
  categoryId: string;
  category: { name: string };
  typeKey: string | null;
  sectionId: string | null;
};

/**
 * Реальні спільні покупки: що люди кладуть у той самий кошик.
 *
 * `OrderItem` у базі всього 26 рядків, тож запит дешевий; фільтр за
 * showableProductWhere прибирає позиції, які вже не продаються.
 */
async function fromOrderHistory(productId: string, excludeIds: Set<string>): Promise<Reco[]> {
  const orders = await prisma.orderItem.findMany({
    where: { productId },
    select: { orderId: true },
    take: 200,
  });
  if (orders.length === 0) return [];

  const coItems = await prisma.orderItem.findMany({
    where: {
      orderId: { in: orders.map((o) => o.orderId) },
      productId: { not: productId },
      product: showableProductWhere(),
    },
    select: { productId: true, product: { select: RECO_SELECT } },
    take: 500,
  });

  const counts = new Map<string, { product: Reco; count: number }>();
  for (const item of coItems) {
    if (excludeIds.has(item.productId)) continue;
    const seen = counts.get(item.productId);
    if (seen) seen.count += 1;
    else counts.set(item.productId, { product: item.product, count: 1 });
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TAKE)
    .map((x) => x.product);
}

/**
 * Сусідство для блоку «Інші розміри та виробники», коли тип за назвою не
 * розпізнано.
 *
 * Категорія з 1С тут майже не помічник: у «Рівень водний» лежить рівно один
 * товар — той самий, що ми відкрили, тож картка ставала глухим кутом без
 * жодного посилання далі. Тому спускаємось щаблями: група товару (`typeKey`),
 * потім категорія, потім розділ каталогу.
 */
async function neighbourhood(product: ProductLike, excludeIds: Set<string>): Promise<Reco[]> {
  const steps: Record<string, unknown>[] = [];
  if (product.typeKey) steps.push({ typeKey: product.typeKey });
  steps.push(
    isServiceCategory(product.category.name) && product.brandId
      ? { brandId: product.brandId }
      : { categoryId: product.categoryId }
  );
  if (product.sectionId) steps.push({ sectionId: product.sectionId });

  for (const step of steps) {
    const found = await prisma.product.findMany({
      where: {
        ...step,
        id: { not: product.id, notIn: [...excludeIds] },
        ...showableProductWhere(),
      },
      select: RECO_SELECT,
      orderBy: [{ stock: "desc" }, { priority: "desc" }],
      take: TAKE,
    });
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * Два блоки картки товару. Порядок збирання важливий: спершу «інші розміри»,
 * бо саме вони задають список, який «разом» мусить обійти.
 */
export async function productRecommendations(product: ProductLike): Promise<{
  boughtTogether: Reco[];
  sameType: Reco[];
}> {
  const sameTypeByName = await findSameType(product, TAKE);
  const shown = new Set<string>([product.id, ...sameTypeByName.map((p) => p.id)]);

  const sameType =
    sameTypeByName.length > 0 ? sameTypeByName : await neighbourhood(product, shown);
  for (const p of sameType) shown.add(p.id);

  // Спершу те, що люди справді брали разом; якщо історії немає — курований
  // граф супутніх типів (до круга болгарка й захист). Сусідства тут немає
  // навмисно: це блок нижче, і саме через нього блоки й дублювались.
  let boughtTogether = await fromOrderHistory(product.id, shown);
  if (boughtTogether.length === 0) {
    const complementary = await findComplementary(product, TAKE);
    boughtTogether = complementary.filter((p) => !shown.has(p.id));
  }

  return { boughtTogether, sameType };
}
