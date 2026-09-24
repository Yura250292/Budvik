/**
 * Звірка витрат: документ, розпроведений у 1С, має зникнути й на сайті.
 *
 * Канал `expense` приходить лише в повному нічному прогоні — знімком усього
 * вікна від `counts.expensesFrom`. Розпроведений документ у регістрі більше
 * не рухає нічого, тож його рядок просто не приходить; applyExpenses оновлює
 * лише принесене. Тому на закритті прогону видаляємо рядки ВІКНА, які цей
 * знімок не підтвердив (syncedAt старший за перший батч прогону). Рядки до
 * вікна не чіпаємо: їх не питали, а не «їх немає».
 *
 * Запобіжник той самий, що в боргах: обірване вивантаження виглядало б як
 * масове зникнення, і звірка стерла б живі витрати — тому забагато зниклих
 * означає «пропустити й сказати в лог», а не «видалити».
 */

import { prisma } from "@/lib/prisma";
import { ApplyContext } from "./context";
import { channelDelivered, CLOCK_SKEW_GUARD_MS } from "./stale";

/** Більше за стільки рядків за раз не видаляємо — це вже не розпроведення, а збій. */
const STALE_ABSOLUTE_LIMIT = 500;
/** Частка зниклих від усього вікна, за якої знімок вважаємо обірваним. */
const STALE_RATIO_LIMIT = 0.5;

export async function reconcileExpenses(
  ctx: ApplyContext,
  counts: { expensesFrom?: string; expensesFailed?: string } | undefined
): Promise<number> {
  if (!counts || counts.expensesFailed || typeof counts.expensesFrom !== "string") return 0;
  const from = new Date(`${counts.expensesFrom}T00:00:00`);
  if (Number.isNaN(from.getTime())) return 0;

  const delivered = await channelDelivered(ctx, "expense");
  if (!delivered) return 0;
  const cutoff = new Date(delivered.firstBatchAt.getTime() - CLOCK_SKEW_GUARD_MS);

  const where = { docDate: { gte: from }, syncedAt: { lt: cutoff } };
  const stale = await prisma.expenseEntry.count({ where });
  if (stale === 0) return 0;
  if (stale > STALE_ABSOLUTE_LIMIT || stale > STALE_RATIO_LIMIT * (stale + delivered.seen)) {
    console.error(`sync-ingest: звірку витрат пропущено — забагато зниклих (${stale} проти ${delivered.seen} у знімку)`);
    return 0;
  }
  const { count } = await prisma.expenseEntry.deleteMany({ where });
  return count;
}
