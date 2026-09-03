/**
 * Наскрізна перевірка прийому надходжень з 1С.
 *
 * Канал purchase_doc мав приймач і не мав виробника, тож жодного разу не
 * працював на живих даних. Перш ніж вмикати його на сервері 1С, обробник
 * треба прогнати по всіх станах документа — саме тут ховаються помилки, які
 * потім коштують дня RDP: розпроведення, дублі номерів між роками, валюта,
 * незіставлені постачальник і товар.
 *
 * Працює на ТИМЧАСОВИХ записах, які сам і прибирає: externalId усіх
 * підставних документів починається з "test-purchase-", і в кінці вони
 * видаляються разом із тимчасовим постачальником. Живих документів скрипт
 * не торкається.
 *
 *   npx tsx scripts/check-purchase-ingest.ts
 */
import { prisma } from "../src/lib/prisma";
import { ApplyContext } from "../src/lib/sync-ingest/context";
import { applyPurchaseDocuments } from "../src/lib/sync-ingest/apply-documents";
import type { DocumentRecord } from "../src/lib/sync-ingest/types";

const PREFIX = `test-purchase-${Date.now()}`;
let failed = 0;

const ok = (name: string, cond: boolean, extra: unknown = "") => {
  if (!cond) {
    failed++;
    console.log(`  ✗ ${name}`, extra ?? "");
  } else {
    console.log(`  ✓ ${name}`);
  }
};

async function main() {
  // Реальний товар потрібен, щоб рядки документа було з чим зіставляти.
  const product = await prisma.product.findFirst({
    where: { externalId: { not: null } },
    select: { id: true, externalId: true, name: true },
  });
  if (!product?.externalId) throw new Error("У базі немає товару з externalId — нема чим перевіряти рядки");

  const supplier = await prisma.counterparty.create({
    data: {
      name: `Перевірка приходу ${PREFIX}`,
      externalId: `${PREFIX}-supplier`,
      // Навмисно CUSTOMER: обробник має підняти його до BOTH, інакше
      // постачальник не потрапляє в список на сайті.
      type: "CUSTOMER",
    },
    select: { id: true },
  });

  const job = await prisma.syncJob.create({
    data: { type: "purchase-check", status: "running", fileName: `${PREFIX}.check` },
    select: { id: true },
  });

  const ctxOf = () => new ApplyContext(job.id, `${PREFIX}-run`, "incremental");
  const doc = (over: Partial<DocumentRecord> & { externalId: string }): DocumentRecord => ({
    number: "00000000001",
    // Без зсуву — саме так його віддає агент (IsoDate у extract.ps1 не
    // додає offset для DateTime без Kind), і саме так сервер його читає.
    date: "2026-03-02T10:00:00",
    counterpartyExternalId: `${PREFIX}-supplier`,
    totalAmount: 1350,
    posted: true,
    items: [
      { productExternalId: product.externalId!, quantity: 15, price: 90, lineNo: 1 },
    ],
    ...over,
  });

  const find = (externalId: string) =>
    prisma.purchaseOrder.findUnique({
      where: { externalId },
      include: { items: true },
    });

  try {
    console.log("Проведений документ");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments([doc({ externalId: `${PREFIX}-a` })], ctx);
      const po = await find(`${PREFIX}-a`);
      ok("створено", ctx.created === 1 && !!po, { created: ctx.created });
      ok("статус CONFIRMED", po?.status === "CONFIRMED", po?.status);
      ok("сума з шапки", po?.totalAmount === 1350, po?.totalAmount);
      ok("дата документа, а не сьогодні", po?.createdAt.toISOString().slice(0, 10) === "2026-03-02", po?.createdAt);
      ok("рядок із номером і ціною", po?.items.length === 1 && po.items[0].purchasePrice === 90 && po.items[0].lineNo === 1, po?.items);
      ok("склад порожній, бо не приїхав", po?.stockLocationId === null);
      ok("позначка обміну проставлена", !!po?.syncedAt);
    }

    console.log("\nПостачальник із типом CUSTOMER");
    {
      const cp = await prisma.counterparty.findUnique({ where: { id: supplier.id }, select: { type: true } });
      ok("піднято до BOTH", cp?.type === "BOTH", cp?.type);
    }

    console.log("\nЦіна закупівлі в довіднику постачальника");
    {
      const sp = await prisma.supplierProduct.findUnique({
        where: { supplierId_productId: { supplierId: supplier.id, productId: product.id } },
        select: { purchasePrice: true, lastUpdated: true },
      });
      ok("записана з ціною рядка", sp?.purchasePrice === 90, sp?.purchasePrice);
      ok("дата = дата документа", sp?.lastUpdated.toISOString().slice(0, 10) === "2026-03-02", sp?.lastUpdated);
    }

    console.log("\nПовторний прогін того самого документа зі зміненими рядками");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments(
        [doc({
          externalId: `${PREFIX}-a`,
          totalAmount: 2000,
          items: [
            { productExternalId: product.externalId!, quantity: 20, price: 100, lineNo: 1 },
          ],
        })],
        ctx
      );
      const po = await find(`${PREFIX}-a`);
      ok("оновлено, не задубльовано", ctx.updated === 1 && ctx.created === 0, { u: ctx.updated, c: ctx.created });
      ok("таблична частина перезаписана", po?.items.length === 1 && po.items[0].quantity === 20, po?.items);
      ok("сума оновлена", po?.totalAmount === 2000, po?.totalAmount);
    }

    console.log("\nСтаріший документ не затирає ціну постачальника");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments(
        [doc({
          externalId: `${PREFIX}-old`,
          number: "00000000002",
          date: "2025-05-05T10:00:00",
          items: [{ productExternalId: product.externalId!, quantity: 1, price: 55, lineNo: 1 }],
        })],
        ctx
      );
      const sp = await prisma.supplierProduct.findUnique({
        where: { supplierId_productId: { supplierId: supplier.id, productId: product.id } },
        select: { purchasePrice: true },
      });
      ok("ціна лишилась від новішого документа", sp?.purchasePrice === 100, sp?.purchasePrice);
    }

    console.log("\nРозпроведення в 1С");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments([doc({ externalId: `${PREFIX}-a`, posted: false })], ctx);
      const po = await find(`${PREFIX}-a`);
      ok("документ у CANCELLED", po?.status === "CANCELLED", po?.status);
    }

    console.log("\nНепроведений документ, якого сайт не бачив");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments([doc({ externalId: `${PREFIX}-draft`, posted: false })], ctx);
      ok("пропущено як чернетку", ctx.skipped === 1 && ctx.created === 0, { s: ctx.skipped, c: ctx.created });
      ok("у базі не з'явився", (await find(`${PREFIX}-draft`)) === null);
    }

    console.log("\nПозначка видалення");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments([doc({ externalId: `${PREFIX}-old`, deleted: true })], ctx);
      const po = await find(`${PREFIX}-old`);
      ok("наявний документ скасовано", po?.status === "CANCELLED", po?.status);
    }

    console.log("\nОдин номер у двох роках");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments(
        [doc({ externalId: `${PREFIX}-2025`, number: "00000000001", date: "2025-03-02T10:00:00" })],
        ctx
      );
      const po = await find(`${PREFIX}-2025`);
      ok("створено з суфіксом року", po?.number === "00000000001/2025", po?.number);
    }

    console.log("\nВалютний документ");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments(
        [doc({
          externalId: `${PREFIX}-usd`,
          number: "00000000003",
          totalAmount: 100,
          currencyCode: "840",
          currencyRate: 41.5,
          items: [{ productExternalId: product.externalId!, quantity: 2, price: 50, lineNo: 1 }],
        })],
        ctx
      );
      const po = await find(`${PREFIX}-usd`);
      ok("сума перерахована в гривню", po?.totalAmount === 4150, po?.totalAmount);
      ok("ціна рядка перерахована", po?.items[0].purchasePrice === 2075, po?.items[0].purchasePrice);
      ok("валюта і курс збережені", po?.currencyCode === "840" && po?.currencyRate === 41.5, {
        c: po?.currencyCode,
        r: po?.currencyRate,
      });
    }

    console.log("\nВалюта без курсу");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments(
        [doc({ externalId: `${PREFIX}-eur`, number: "00000000004", totalAmount: 200, currencyCode: "978" })],
        ctx
      );
      const po = await find(`${PREFIX}-eur`);
      ok("сума лишилась як є", po?.totalAmount === 200, po?.totalAmount);
      ok(
        "розбіжність у журналі",
        ctx.discrepancies.some((d) => d.field === "FOREIGN_CURRENCY_NO_RATE"),
        ctx.discrepancies.map((d) => d.field)
      );
    }

    console.log("\nНезіставлений постачальник");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments(
        [doc({ externalId: `${PREFIX}-nosup`, counterpartyExternalId: `${PREFIX}-missing` })],
        ctx
      );
      ok("документ не створено", ctx.skipped === 1 && (await find(`${PREFIX}-nosup`)) === null);
      ok(
        "розбіжність UNMATCHED_SUPPLIER",
        ctx.discrepancies.some((d) => d.field === "UNMATCHED_SUPPLIER"),
        ctx.discrepancies.map((d) => d.field)
      );
    }

    console.log("\nНезіставлений товар у рядку");
    {
      const ctx = ctxOf();
      await applyPurchaseDocuments(
        [doc({
          externalId: `${PREFIX}-noprod`,
          number: "00000000005",
          items: [
            { productExternalId: product.externalId!, quantity: 1, price: 10, lineNo: 1 },
            { productExternalId: `${PREFIX}-unknown-product`, quantity: 3, price: 20, lineNo: 2 },
          ],
        })],
        ctx
      );
      const po = await find(`${PREFIX}-noprod`);
      ok("документ збережено без чужого рядка", po?.items.length === 1, po?.items.length);
      ok(
        "розбіжність UNMATCHED_PRODUCT",
        ctx.discrepancies.some((d) => d.field === "UNMATCHED_PRODUCT"),
        ctx.discrepancies.map((d) => d.field)
      );
    }

    console.log("\nPreview нічого не пише");
    {
      const ctx = new ApplyContext(job.id, `${PREFIX}-preview`, "preview");
      await applyPurchaseDocuments([doc({ externalId: `${PREFIX}-preview`, number: "00000000006" })], ctx);
      ok("порахував як створення", ctx.created === 1, ctx.created);
      ok("у базі нічого немає", (await find(`${PREFIX}-preview`)) === null);
    }
  } finally {
    const docs = await prisma.purchaseOrder.findMany({
      where: { externalId: { startsWith: PREFIX } },
      select: { id: true },
    });
    await prisma.purchaseOrderItem.deleteMany({
      where: { purchaseOrderId: { in: docs.map((d) => d.id) } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } });
    await prisma.supplierProduct.deleteMany({ where: { supplierId: supplier.id } });
    await prisma.counterparty.delete({ where: { id: supplier.id } });
    await prisma.syncDiscrepancy.deleteMany({ where: { syncJobId: job.id } });
    await prisma.syncJob.delete({ where: { id: job.id } });
    console.log("\nТимчасові дані прибрано.");
  }

  console.log(failed ? `\n${failed} перевірок не зійшлося.` : "\nУсе зійшлося.");
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main();
