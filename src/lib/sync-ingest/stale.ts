/**
 * Спільні інструменти для даних, які в 1С перестали бути актуальними.
 *
 * Обидві функції потрібні в кількох каналах одразу, тому й живуть окремо:
 * повна звірка ловить те, що зникло з вивантаження, а канал товарів — те,
 * що 1С прямо помітила на видалення. Дія в обох випадках однакова.
 */

import { prisma } from "@/lib/prisma";

/**
 * Ref'и вже зареєстрованих і ще не розв'язаних розбіжностей одного виду.
 *
 * Без цієї перевірки та сама позиція накопичувала б новий запис щопрогону.
 * Ціна помилки не теоретична: на 16 контрагентів і 251 товар, помічених у
 * 1С на видалення, журнал встиг набрати 67 тисяч рядків і 66 МБ.
 */
export async function unresolvedRefs(entityType: string, field: string): Promise<Set<string>> {
  const rows = await prisma.syncDiscrepancy.findMany({
    where: { entityType, field, resolved: false },
    select: { entityRef: true },
  });
  return new Set(rows.map((r) => r.entityRef));
}

/**
 * Обнуляє залишок товарів, яких більше немає в 1С — і в Product.stock, і в
 * поскладових рядках, інакше наступний перерахунок підняв би старе число назад.
 *
 * Деактивації немає навмисно (рішення власника): картка лишається у вітрині
 * сірою, без кнопки кошика, в кінці списку — асортимент видно, але магазин
 * не обіцяє того, чого в обліку немає.
 */
export async function zeroStock(productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;

  const CHUNK = 500;
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const ids = productIds.slice(i, i + CHUNK);
    try {
      await prisma.locationStock.updateMany({
        where: { productId: { in: ids } },
        data: { quantity: 0, reserved: 0, available: 0 },
      });
      await prisma.product.updateMany({
        where: { id: { in: ids } },
        data: { stock: 0, syncedAt: new Date(), syncSource: "1C" },
      });
    } catch (e) {
      // Обнулення — гігієна вітрини, а не суть прогону: збій тут не має
      // валити батч, у якому щойно успішно застосувались ціни й залишки.
      console.error("sync-ingest: не вдалося обнулити залишок зниклих товарів", e);
    }
  }
}
