import { prisma } from "@/lib/prisma";

/**
 * Пошук за схожістю назви — рятувальний круг для одруків.
 *
 * `ILIKE '%…%'` не пробачає нічого: «шурупроверт» дає нуль товарів, хоча
 * людина явно шукала шуруповерт. pg_trgm рахує спільні трилітерні шматки,
 * тож одна переставлена літера вже не вирок.
 *
 * Розширення і GIN-індекс по name встановлені міграцією 20260811180000.
 * Оператор `%` цим індексом користується, тому запит не сканує 49 тис. рядків.
 *
 * Виклик — лише коли звичайний пошук повернув нуль: за схожістю завжди
 * знайдеться «щось приблизне», і показувати його замість точних збігів
 * означало б псувати робочі запити.
 */

/** Нижче цього збіг уже випадковий. Дефолт pg — 0.3, але на назвах товарів
 *  з купою службових слів («Круг відрізний по металу…») він шумить. */
const MIN_SIMILARITY = 0.32;

export async function trigramSearchIds(query: string, take: number): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM "Product"
    WHERE "isActive" = true
      AND price > 0
      AND similarity(lower(name), ${q}) > ${MIN_SIMILARITY}
    ORDER BY similarity(lower(name), ${q}) DESC, stock DESC
    LIMIT ${take}
  `;
  return rows.map((r) => r.id);
}

/**
 * Впорядковує вибірку так, як її повернув пошук за схожістю: БД по `id IN (…)`
 * віддає рядки у власному порядку, і найкращий збіг опинявся б де завгодно.
 */
export function reorderByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}
