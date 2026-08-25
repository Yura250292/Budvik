/**
 * Спільні інструменти для даних, які в 1С перестали бути актуальними.
 *
 * Обидві функції потрібні в кількох каналах одразу, тому й живуть окремо:
 * повна звірка ловить те, що зникло з вивантаження, а канал товарів — те,
 * що 1С прямо помітила на видалення. Дія в обох випадках однакова.
 */

import { prisma } from "@/lib/prisma";
import { ApplyContext, getSyncState } from "./context";
import { SYNC_STATE_KEYS } from "./types";

/**
 * Чи справді цей прогін приніс і застосував канал — перевірка, без якої
 * будь-яка звірка «чого немає в 1С» стає небезпечною.
 *
 * Повертає розмір зрізу й час першого батча, або null, якщо звіряти нема з
 * чим. Три причини сказати «ні», і кожна коштувала б чужих даних:
 *
 * 1. Зріз порожній — у живій базі так не буває, це обірваний запит.
 * 2. Батч упав із винятком. Відповідь агентові все одно 200, і прогін
 *    закривається успішним, тож ззовні збою не видно.
 * 3. Диспетчер пропустив канал за тротлом. Батч при цьому зареєстрований
 *    (SyncBatch пишеться ДО застосування), тому єдина достовірна ознака —
 *    запис самого тротла з runId прогону, якому відкрили вікно.
 */
export async function channelDelivered(
  ctx: ApplyContext,
  entityType: string,
  opts: { throttled?: boolean } = {}
): Promise<{ seen: number; firstBatchAt: Date } | null> {
  if (ctx.isPreview) return null;

  const batchError = await getSyncState(SYNC_STATE_KEYS.batchErrorKey(entityType));
  if (batchError === ctx.runId) return null;

  const batches = await prisma.syncBatch.aggregate({
    where: { runId: ctx.runId, entityType },
    _sum: { records: true },
    _min: { createdAt: true },
  });

  const seen = batches._sum.records ?? 0;
  const firstBatchAt = batches._min.createdAt;
  if (seen === 0 || !firstBatchAt) return null;

  if (opts.throttled && ctx.kind !== "full") {
    const granted = await getSyncState(SYNC_STATE_KEYS.slowEntityKey(entityType));
    if (!granted) return null;
    try {
      const parsed = JSON.parse(granted) as { runId?: string };
      if (parsed.runId !== ctx.runId) return null;
    } catch {
      // Старий формат (голий ISO-час) не каже, чий це прогін — не ризикуємо.
      return null;
    }
  }

  return { seen, firstBatchAt };
}

/**
 * Запас, на який відсічка зсувається в минуле.
 *
 * Мітку свіжості ставить годинник Postgres, а відсічку беремо з
 * SyncBatch.createdAt — тієї самої бази, але через прошарок Prisma. Помилка
 * в один бік дешева (частина зниклого дочекається наступного прогону), у
 * другий дорога: відсічка «з майбутнього» зробила б кандидатами всіх одразу.
 */
export const CLOCK_SKEW_GUARD_MS = 5 * 60_000;

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
