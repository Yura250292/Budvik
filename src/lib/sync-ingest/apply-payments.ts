/**
 * Оплати з 1С → PaymentAllocation.
 *
 * Ключова ланка мотивації: торговий заробляє з грошей, які реально
 * привіз, а не з обороту. Без рознесення оплати на торгового «скільки
 * забрали» порахувати неможливо — Payment сам по собі знає лише
 * контрагента.
 *
 * Рознесення шукає торгового трьома шляхами, від найточнішого:
 *   1. DOCUMENT — через накладну, яку закриває оплата
 *   2. CLIENT   — через закріплення клієнта за торговим
 *   3. (немає)  — оплата зберігається, але не потрапляє в мотивацію,
 *                 і адмін бачить її в «нерознесених»
 */

import { prisma } from "@/lib/prisma";
import type { PaymentRecord } from "./types";
import type { ApplyContext } from "./context";
import { rollbackPayment } from "./rollback-payment";

/** Синтетичний контрагент-заглушка не створюється: без клієнта оплату не застосовуємо. */
export async function applyPayments(
  records: PaymentRecord[],
  ctx: ApplyContext
): Promise<void> {
  // «Оплату підтвердило вивантаження 1С» — до обробки й одним запитом.
  // На цій мітці тримається звірка розпроведених (reconcile-payments.ts):
  // запит ПКО бере лише проведені документи, тож розпроведений ордер просто
  // зникає з вікна, і без мітки його не відрізнити від оплати, яка за це
  // вікно вийшла. Час — годинником бази, як і всюди в обміні.
  const externalIds = records.map((r) => r.externalId).filter(Boolean);
  if (!ctx.isPreview && externalIds.length > 0) {
    await prisma.$executeRaw`
      UPDATE "Payment" SET "syncedAt" = now()
      WHERE "externalId" = ANY(${externalIds}::text[])
    `;
  }

  for (const rec of records) {
    try {
      await applyOne(rec, ctx);
    } catch (e) {
      ctx.fail(rec.number || rec.externalId, e);
    }
  }
}

async function applyOne(rec: PaymentRecord, ctx: ApplyContext): Promise<void> {
  if (!rec.externalId || !rec.counterpartyExternalId || !rec.amount) {
    ctx.skipped++;
    return;
  }

  // Ідемпотентність: та сама оплата з 1С не має подвоїти нарахування.
  const existing = await prisma.payment.findUnique({
    where: { externalId: rec.externalId },
    select: { id: true, amount: true },
  });

  if (existing) {
    // Суму в ордері виправили в 1С. Раніше такий запис мовчки лишався зі
    // старим числом: у рахунку стояла одна сума, у мотивації торгового —
    // інша, і жодного сліду про розбіжність. Відкочуємо старий запис і
    // створюємо наново — так само, як робить 1С, переписуючи документ.
    if (Math.abs(existing.amount - rec.amount) < 0.01) {
      ctx.skipped++;
      return;
    }

    ctx.discrepancy({
      entityType: "payment",
      entityRef: rec.externalId,
      entityName: `Оплата ${rec.number || rec.externalId}`,
      field: "amount",
      value1C: rec.amount.toFixed(2),
      valueBudvik: existing.amount.toFixed(2),
    });

    if (ctx.isPreview) {
      ctx.updated++;
      return;
    }

    await rollbackPayment(existing.id);
  }

  const counterparty = await prisma.counterparty.findUnique({
    where: { externalId: rec.counterpartyExternalId },
    select: { id: true },
  });
  if (!counterparty) {
    // Контрагента ще не синхронізовано — фіксуємо розбіжність, а не
    // створюємо його наосліп: оплата від невідомого клієнта нічого
    // не означає для мотивації.
    ctx.discrepancy({
      entityType: "payment",
      entityRef: rec.externalId,
      entityName: `Оплата ${rec.number || rec.externalId}`,
      field: "counterparty",
      value1C: rec.counterpartyExternalId,
      valueBudvik: "контрагента не знайдено",
    });
    ctx.skipped++;
    return;
  }

  const paidAt = rec.date ? new Date(rec.date) : new Date();

  // Накладна, яку закриває оплата — головне джерело зв'язку з торговим
  const salesDoc = rec.salesDocExternalId
    ? await prisma.salesDocument.findUnique({
        where: { externalId: rec.salesDocExternalId },
        select: {
          id: true,
          salesRepId: true,
          totalAmount: true,
          profitAmount: true,
          items: {
            select: {
              quantity: true,
              sellingPrice: true,
              purchasePrice: true,
              product: { select: { brandId: true } },
            },
          },
        },
      })
    : null;

  if (ctx.isPreview) {
    ctx.created++;
    return;
  }

  // Рахунок потрібен як контейнер платежу. Якщо його немає — створюємо
  // мінімальний під цю накладну, інакше Payment нікуди прикріпити.
  const invoice = await ensureInvoice(rec, counterparty.id, salesDoc?.id ?? null);

  const payment = await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      amount: rec.amount,
      method: rec.method || "bank_transfer",
      notes: rec.number ? `№${rec.number} (1С)` : null,
      paidAt,
      externalId: rec.externalId,
      source: "1C",
    },
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      paidAmount: { increment: rec.amount },
      paymentStatus:
        invoice.paidAmount + rec.amount >= invoice.totalAmount - 0.01 ? "PAID" : "PARTIAL",
    },
  });

  await allocate(payment.id, rec, salesDoc, counterparty.id);
  ctx.created++;
}

/** Знаходить або створює рахунок під оплату. */
async function ensureInvoice(
  rec: PaymentRecord,
  counterpartyId: string,
  salesDocumentId: string | null
) {
  if (salesDocumentId) {
    const existing = await prisma.invoice.findUnique({
      where: { salesDocumentId },
      select: { id: true, paidAmount: true, totalAmount: true },
    });
    if (existing) return existing;
  }

  // Системний користувач як автор: оплата прийшла з 1С, а не від людини
  const creator = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!creator) throw new Error("Немає жодного ADMIN для createdById");

  return prisma.invoice.create({
    data: {
      number: `1C-${rec.externalId.slice(0, 12)}`,
      salesDocumentId,
      counterpartyId,
      totalAmount: rec.amount,
      paidAmount: 0,
      status: "CONFIRMED",
      paymentStatus: "UNPAID",
      createdById: creator.id,
      notes: "Створено автоматично при синхронізації оплати з 1С",
    },
    select: { id: true, paidAmount: true, totalAmount: true },
  });
}

type SalesDocLite = {
  id: string;
  salesRepId: string | null;
  totalAmount: number;
  profitAmount: number;
  items: {
    quantity: number;
    sellingPrice: number;
    purchasePrice: number;
    product: { brandId: string | null };
  }[];
} | null;

/**
 * Рознесення оплати на торгового.
 *
 * Прибуток рахується ПРОПОРЦІЙНО: якщо клієнт заплатив половину
 * накладної, торговий заробляє з половини маржі. Інакше часткова оплата
 * давала б повну комісію.
 */
async function allocate(
  paymentId: string,
  rec: PaymentRecord,
  salesDoc: SalesDocLite,
  counterpartyId: string
): Promise<void> {
  let repId = salesDoc?.salesRepId ?? null;
  let source = "DOCUMENT";

  // Запасний шлях: клієнт закріплений за торговим
  if (!repId) {
    // orderBy обов'язковий: клієнт може бути закріплений за кількома
    // торговими, і без сортування Postgres віддає довільного. Тоді оплата
    // пішла б одному, а борг того самого клієнта в аналітиці — іншому.
    const link = await prisma.salesRepClient.findFirst({
      where: { counterpartyId },
      orderBy: { id: "asc" },
      select: { salesRepId: true },
    });
    if (link) {
      repId = link.salesRepId;
      source = "CLIENT";
    }
  }

  // Третій шлях: торговий з останнього документа цього клієнта.
  //
  // Закріплення SalesRepClient заповнюється вручну і на практиці майже
  // порожнє, тож без цього шляху оплата не діставалася нікого: 2293 ПКО
  // з 1С дали нуль рознесень, і «скільки зібрано» у мотивації було нулем
  // при живому потоці грошей.
  //
  // Реалізація виграє над замовленням — той самий пріоритет, що і в
  // receivableRowsByRep: борг і оплата того самого клієнта мають лягати на
  // одного торгового, інакше в одного росте борг, а в іншого — збори.
  if (!repId) {
    const [fromDoc] = await prisma.$queryRaw<Array<{ salesRepId: string }>>`
      SELECT sd."salesRepId"
      FROM "SalesDocument" sd
      WHERE sd."counterpartyId" = ${counterpartyId}
        AND sd."salesRepId" IS NOT NULL
      ORDER BY (sd."docType" = 'REALIZATION') DESC, sd."createdAt" DESC
      LIMIT 1`;
    if (fromDoc) {
      repId = fromDoc.salesRepId;
      source = "CLIENT_DOC";
    }
  }

  // Нерознесена оплата — не помилка: гроші могли прийти від клієнта
  // без торгового. Вона просто не бере участі в мотивації.
  if (!repId) return;

  // Частка оплати від суми накладної
  const ratio =
    salesDoc && salesDoc.totalAmount > 0
      ? Math.min(1, rec.amount / salesDoc.totalAmount)
      : 1;

  const profitAmount = salesDoc ? (salesDoc.profitAmount || 0) * ratio : 0;

  // Бренд визначаємо, лише коли вся накладна — один бренд. Розкидати
  // одну оплату по кількох брендах довільно означало б вигадати дані.
  const brandIds = new Set(
    (salesDoc?.items || []).map((i) => i.product.brandId).filter(Boolean) as string[]
  );
  const brandId = brandIds.size === 1 ? [...brandIds][0] : null;

  await prisma.paymentAllocation.create({
    data: { paymentId, repId, amount: rec.amount, profitAmount, brandId, source },
  });
}
