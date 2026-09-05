/**
 * Усе про клієнта одним викликом: борг, ритм, що бере, що ми про нього знаємо.
 *
 * Одним, а не п'ятьма, свідомо. Модель, яка мусить окремо спитати борг,
 * окремо історію й окремо пам'ять, витрачає на це три раунди — тобто
 * півхвилини очікування — і все одно половину забуде спитати. Тут
 * зібрано рівно те, з чим торговий заходить у магазин.
 *
 * Скоуп не звужується до портфеля торгового навмисно: так само поводяться
 * наявні роути картки клієнта (/api/erp/counterparties/[id]/summary), бо
 * питання «а що з цим магазином» виникає і про чужого клієнта.
 */

import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { agingByCounterparty } from "@/lib/analytics/money-facts";
import { lastOrders, orderSummary, ordersSince } from "@/lib/analytics/clientOrder";
import { listMemory, KIND_LABELS } from "@/lib/assistant/memory";
import { clientStateNow, STATE_LABELS } from "@/lib/assistant/facts/client-state";
import { clientProductPurchases } from "@/lib/assistant/facts/client-purchases";
import { payerVerdicts, verdictLabel } from "@/lib/assistant/facts/discipline-cache";
import { humanText, uah, ymd, days as roundDays } from "@/lib/assistant/format";

type BrandRow = { brand: string | null; amount: number; qty: number; docs: number };
type ProductRow = {
  productId: string;
  name: string;
  sku: string | null;
  brand: string | null;
  qty: number;
  amount: number;
  times: number;
  lastAt: Date;
};

/**
 * @param productQuery — коли питання про конкретний товар («коли брав піну»),
 * картка звужується: з важких секцій лишається борг і стан, а замість топів
 * приходять самі закупівлі цього товару. Так відповідь на вузьке питання не
 * коштує повної картки — ні в базі, ні в токенах.
 */
export async function clientProfileFacts(
  counterpartyId: string,
  months: number,
  productQuery?: string | null
) {
  const narrow = (productQuery ?? "").trim();
  const cp = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: {
      id: true,
      name: true,
      code: true,
      phone: true,
      address: true,
      contactPerson: true,
      notes: true,
      deliveryLat: true,
      deliveryLng: true,
      receivableBalance: true,
      balanceSyncedAt: true,
      isActive: true,
      assignedSalesReps: { select: { salesRep: { select: { id: true, name: true } } } },
    },
  });
  if (!cp) return null;

  const since = ordersSince(months);

  const [state, aging, discipline, memory, comments, visits, brands, products, orders, summary, purchases] =
    await Promise.all([
      clientStateNow(counterpartyId),
      agingByCounterparty([counterpartyId]),
      payerVerdicts(),
      listMemory(counterpartyId, 20),
      prisma.clientComment.findMany({
        where: { counterpartyId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          text: true,
          createdAt: true,
          photoUrl: true,
          author: { select: { name: true } },
        },
      }),
      prisma.visit.findMany({
        where: { counterpartyId },
        orderBy: { day: "desc" },
        take: 5,
        select: {
          day: true,
          status: true,
          money: true,
          collectedAmount: true,
          comment: true,
          user: { select: { name: true } },
        },
      }),
      narrow ? ([] as BrandRow[]) : prisma.$queryRaw<BrandRow[]>`
        SELECT
          b.name AS brand,
          SUM(i.quantity * i."sellingPrice")::float AS amount,
          SUM(i.quantity)::float AS qty,
          COUNT(DISTINCT s.id)::int AS docs
        FROM "SalesDocumentItem" i
        JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
        JOIN "Product" p ON p.id = i."productId"
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        WHERE ${SOURCE_FILTER}
          AND s."counterpartyId" = ${counterpartyId}
          AND s."docType" <> 'RETURN'
          AND s."createdAt" >= ${since}
        GROUP BY 1
        ORDER BY amount DESC NULLS LAST
        LIMIT 6
      `,
      narrow ? ([] as ProductRow[]) : prisma.$queryRaw<ProductRow[]>`
        SELECT
          i."productId",
          p.name,
          p.sku,
          b.name AS brand,
          SUM(i.quantity)::float AS qty,
          SUM(i.quantity * i."sellingPrice")::float AS amount,
          COUNT(DISTINCT s.id)::int AS times,
          MAX(s."createdAt") AS "lastAt"
        FROM "SalesDocumentItem" i
        JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
        JOIN "Product" p ON p.id = i."productId"
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        WHERE ${SOURCE_FILTER}
          AND s."counterpartyId" = ${counterpartyId}
          AND s."docType" <> 'RETURN'
          AND s."createdAt" >= ${since}
        GROUP BY 1, 2, 3, 4
        ORDER BY amount DESC
        LIMIT 10
      `,
      lastOrders(counterpartyId, { since, limit: 5 }),
      orderSummary(counterpartyId, since),
      narrow ? clientProductPurchases(counterpartyId, narrow) : null,
    ]);

  const debt = aging.get(counterpartyId);
  const verdict = discipline.verdicts.get(counterpartyId);

  const memoryFacts = memory.map((m) => ({
    id: m.id,
    вид: KIND_LABELS[m.kind],
    текст: humanText(m.text, 500),
    хто: m.source === "ASSISTANT" ? "помічник" : (m.author?.name ?? "—"),
    дата: m.createdAt.slice(0, 10),
  }));

  const head = {
    клієнт_id: cp.id,
    назва: cp.name,
    код: cp.code,
    телефон: cp.phone,
    адреса: cp.address,
    контактна_особа: cp.contactPerson,
    активний: cp.isActive,
    точка_на_карті: cp.deliveryLat != null && cp.deliveryLng != null,
    закріплений_за: cp.assignedSalesReps.map((r) => r.salesRep.name),
    стан: state.state ? STATE_LABELS[state.state] : "покупок ще не було",
    ритм_днів: roundDays(state.avgIntervalDays),
    днів_з_останньої_покупки: state.daysSinceLast,
    документів_за_всю_історію: state.historyDocs,
    борг: {
      всього: uah(debt?.debt ?? cp.receivableBalance ?? 0),
      прострочено: uah(debt?.overdue ?? 0),
      робочий: uah(debt?.current ?? 0),
      найстаріший_днів: debt?.oldestDays ?? 0,
      оновлено: ymd(cp.balanceSyncedAt),
    },
    платник: {
      вердикт: verdictLabel(verdict) ?? "оцінки немає",
      рекомендований_ліміт: discipline.limits.get(counterpartyId) ?? null,
    },
    за_період: {
      місяців: months || "уся історія",
      документів: summary.docs,
      сума: uah(summary.amount),
      повернення: uah(summary.returns),
    },
  };

  /**
   * Секції, зайві для вузького питання, віддаємо як undefined, а не як
   * порожній масив: JSON.stringify їх викидає, і в токени вони не йдуть.
   * Порожній масив натомість читався б як «нічого не купував» — тобто як
   * неправда.
   */
  return {
    ...head,
    закупівлі_товару: purchases ?? undefined,
    топ_бренди: narrow ? undefined : brands.map((b) => ({
      бренд: b.brand ?? "Без бренду",
      сума: uah(b.amount),
      документів: b.docs,
    })),
    топ_товари: narrow ? undefined : products.map((p) => ({
      товар_id: p.productId,
      назва: p.name,
      артикул: p.sku,
      бренд: p.brand,
      разів: p.times,
      кількість: Math.round(p.qty),
      сума: uah(p.amount),
      останній_раз: ymd(p.lastAt),
    })),
    останні_документи: narrow ? undefined : orders.map((o) => ({
      номер: o.number,
      вид: o.docType === "RETURN" ? "повернення" : "реалізація",
      дата: o.createdAt.slice(0, 10),
      днів_тому: o.daysAgo,
      сума: uah(o.totalAmount),
      позиції: o.items.slice(0, 5).map((i) => `${i.quantity}x ${i.name}`),
    })),
    памʼять: memoryFacts,
    коментарі: narrow ? undefined : comments.map((c) => ({
      текст: humanText(c.text, 200) || (c.photoUrl ? "(лише фото)" : ""),
      автор: c.author?.name ?? "—",
      дата: ymd(c.createdAt),
    })),
    візити: narrow ? undefined : visits.map((v) => ({
      дата: ymd(v.day),
      статус: v.status === "DONE" ? "був" : "не заїхав",
      гроші:
        v.money === "FULL"
          ? "забрав повністю"
          : v.money === "PARTIAL"
            ? "забрав частково"
            : v.money === "NONE"
              ? "не дали"
              : null,
      сума: v.collectedAmount ? uah(v.collectedAmount) : null,
      коментар: humanText(v.comment, 120) || null,
      хто: v.user?.name ?? null,
    })),
    нотатка_1с: humanText(cp.notes, 200) || null,
  };
}
