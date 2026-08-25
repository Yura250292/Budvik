/**
 * Звірка оплат: розпроведений у 1С ордер має зникнути й на сайті.
 *
 * Запит ПКО бере лише проведені документи (`П.Проведен` у queries.json), тож
 * розпроведений ордер не приходить зі зміненим станом — він просто зникає з
 * вивантаження. Наслідок був прямий: гроші, яких не було, далі рахувались
 * торговому як зібрані (а мотивація рахується саме з зібраного), рахунок
 * стояв оплаченим, а слідів у журналі не лишалось жодних.
 *
 * Головна складність — межа вікна. Оплати читаються не повним зрізом, а за
 * датою (`П.Дата >= &ДатаС`), тому «немає у вивантаженні» саме по собі нічого
 * не означає: більшість оплат просто старші за вікно. Але нижню межу вікна
 * видно з самих даних — це найраніша дата серед оплат, підтверджених у цьому
 * прогоні. Все, що новіше за неї й підтвердження не отримало, у 1С проведеним
 * уже не значиться.
 *
 * Запас від нижньої межі відступаємо навмисно: вікно рухається, і оплата
 * рівно на його краю могла не потрапити у вивантаження через округлення часу,
 * а не через розпроведення.
 */

import { prisma } from "@/lib/prisma";
import { ApplyContext } from "./context";
import { channelDelivered, CLOCK_SKEW_GUARD_MS } from "./stale";
import { rollbackPayment } from "./rollback-payment";
import { alertPaymentsReconcileSkipped } from "./alerts";

/**
 * Відступ від нижньої межі вікна читання.
 *
 * Доба — свідомо з запасом: край вікна визначається датою найранішої
 * підтвердженої оплати, а вона залежить від того, чи були того дня оплати
 * взагалі. Втрата від відступу невелика (розпроведення саме на межі
 * помітиться наступного дня), ціна помилки — видалена жива оплата.
 */
const WINDOW_EDGE_GUARD_MS = 24 * 60 * 60_000;

/**
 * Скільки оплат прибрати за раз.
 *
 * Розпроведення — подія поштучна: одна-дві на день. Десятки означають не
 * масове скасування, а обірване вивантаження, і тоді краще не чіпати нічого
 * й покликати людину.
 */
const STALE_LIMIT = 25;

/**
 * Прибирає оплати, які 1С більше не підтверджує. Повертає кількість прибраних.
 *
 * Викликається із закриття прогону; помилку ловить викликач.
 */
export async function reconcilePayments(ctx: ApplyContext): Promise<number> {
  const delivered = await channelDelivered(ctx, "payment");
  if (!delivered) return 0;

  const cutoff = new Date(delivered.firstBatchAt.getTime() - CLOCK_SKEW_GUARD_MS);

  // Нижня межа вікна за фактом: найраніша оплата, яку цей прогін підтвердив.
  const confirmed = await prisma.payment.aggregate({
    where: { source: "1C", syncedAt: { gte: cutoff } },
    _min: { paidAt: true },
    _count: true,
  });

  const windowStart = confirmed._min.paidAt;
  if (!windowStart || confirmed._count === 0) return 0;

  const from = new Date(windowStart.getTime() + WINDOW_EDGE_GUARD_MS);

  const stale = await prisma.payment.findMany({
    where: {
      source: "1C",
      paidAt: { gte: from },
      // NULL не чіпаємо: оплати, заведені руками, вивантаження 1С не
      // підтверджує за визначенням.
      syncedAt: { not: null, lt: cutoff },
    },
    select: { id: true, amount: true, paidAt: true, externalId: true, notes: true },
    orderBy: { amount: "desc" },
  });

  if (stale.length === 0) return 0;

  if (stale.length > STALE_LIMIT) {
    console.error(
      `sync-ingest: звірку оплат пропущено — забагато непідтверджених (${stale.length})`
    );
    await alertPaymentsReconcileSkipped(ctx.runId, stale.length, confirmed._count);
    return 0;
  }

  let removed = 0;
  for (const p of stale) {
    try {
      const done = await rollbackPayment(p.id);
      if (!done) continue;
      removed++;
      ctx.discrepancy({
        entityType: "payment",
        entityRef: p.externalId ?? p.id,
        entityName: p.notes || "Оплата з 1С",
        field: "UNPOSTED_IN_1C",
        value1C: "немає серед проведених",
        valueBudvik: `${p.amount.toFixed(2)} грн від ${p.paidAt?.toISOString().slice(0, 10) ?? "—"}`,
      });
    } catch (e) {
      ctx.fail(`оплата ${p.externalId ?? p.id}`, e);
    }
  }

  return removed;
}
