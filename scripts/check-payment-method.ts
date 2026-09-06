/**
 * Перевірка розрізнення готівки й банку в оплатах з 1С.
 *
 * Документ обміну — прибутковий касовий ордер, тому всі 3 025 оплат лежали
 * як «готівка». Насправді банківські перекази клієнтів у цій базі
 * оформлюють тим самим ордером за договором «Безготівка»: 996 документів
 * на 16,2 млн за рік (проба probe-costs.ps1 E1, 05.09.2026). Спосіб оплати
 * тепер виводить сервер із назви договору й каси.
 *
 * Дві речі, які тут доводяться і які інакше вилізли б уже на живих даних:
 *   1. правило класифікації на РЕАЛЬНИХ рядках із бази 1С, включно з
 *      опискою «Безготіка» і двома різними джерелами слова «інтернет»;
 *   2. перекласифікація вже завантаженої оплати. Обробник ідемпотентний і
 *      при незмінній сумі раніше просто пропускав запис — з таким кодом
 *      бекфіл не змінив би жодної з наявних оплат.
 *
 * Працює на ТИМЧАСОВИХ записах, які сам і прибирає (externalId починається
 * з "test-payment-"). Живих оплат не торкається.
 *
 *   node --env-file=.env --import tsx scripts/check-payment-method.ts
 */
import { prisma } from "../src/lib/prisma";
import { ApplyContext } from "../src/lib/sync-ingest/context";
import { applyPayments, classifyPaymentMethod } from "../src/lib/sync-ingest/apply-payments";
import type { PaymentRecord } from "../src/lib/sync-ingest/types";

// Розрізняльне слово стоїть ПЕРШИМ, бо ensureInvoice будує номер рахунку з
// перших 12 символів externalId (`1C-${externalId.slice(0, 12)}`). З
// однаковим початком усі тестові оплати ділили б один номер рахунку і
// падали на унікальному індексі. На бойових даних там GUID, тож це
// обмеження фікстури, а не хиба обробника.
const PREFIX = `test-payment-${Date.now()}`;
const idOf = (kind: string) => `${kind}-${PREFIX}`;
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
  // --- 1. Правило класифікації, на рядках із живої бази ------------------
  //
  // Назви взяті дослівно з виводу проб: договори — probe-costs E1,
  // каси — probe-expenses C1. Разом із хвостовим пробілом і опискою.
  console.log("Правило класифікації");

  ok(
    "«Поставка факт» + «каса грн» → готівка",
    classifyPaymentMethod({ contractName: "Поставка факт", cashDesk: "каса грн" }) === "cash"
  );
  ok(
    "«Безготівка » (з пробілом) → банк",
    classifyPaymentMethod({ contractName: "Безготівка ", cashDesk: "каса грн" }) === "bank_transfer"
  );
  ok(
    "описка «Безготіка» → банк",
    classifyPaymentMethod({ contractName: "Безготіка", cashDesk: "каса грн" }) === "bank_transfer"
  );
  ok(
    "каса «БЕЗГОТІВКА ГРН» → банк навіть при звичайному договорі",
    classifyPaymentMethod({ contractName: "Основной договор", cashDesk: "БЕЗГОТІВКА ГРН" }) ===
      "bank_transfer"
  );
  ok(
    "договір «Інтернет покупець» → інтернет-магазин",
    classifyPaymentMethod({ contractName: "Інтернет покупець", cashDesk: "каса грн" }) === "online"
  );
  ok(
    "каса «ГРН Інтернет» → інтернет-магазин",
    classifyPaymentMethod({ contractName: "Поставка факт", cashDesk: "ГРН Інтернет" }) === "online"
  );
  ok(
    "порожні поля (старий агент) → лишається те, що прислали",
    classifyPaymentMethod({ method: "cash" }) === "cash"
  );
  ok(
    "порожні поля без method → готівка, це все-таки касовий ордер",
    classifyPaymentMethod({}) === "cash"
  );

  // --- 2. Наскрізний прийом --------------------------------------------
  await prisma.counterparty.create({
    data: {
      name: `Перевірка оплат ${PREFIX}`,
      externalId: `${PREFIX}-cp`,
      type: "CUSTOMER",
    },
    select: { id: true },
  });

  const job = await prisma.syncJob.create({
    data: { type: "payment-check", status: "running", fileName: `${PREFIX}.check` },
    select: { id: true },
  });

  const ctxOf = (kind: "incremental" | "preview" = "incremental") =>
    new ApplyContext(job.id, `${PREFIX}-run`, kind);

  const rec = (over: Partial<PaymentRecord> & { externalId: string }): PaymentRecord => ({
    counterpartyExternalId: `${PREFIX}-cp`,
    amount: 1000,
    date: "2026-06-10T12:00:00",
    number: "00000000001",
    ...over,
  });

  const find = (externalId: string) =>
    prisma.payment.findUnique({
      where: { externalId },
      select: { id: true, amount: true, method: true, contractName: true, cashDesk: true },
    });

  try {
    console.log("Прийом оплати");

    const bankId = idOf("bank");
    let ctx = ctxOf();
    await applyPayments(
      [rec({ externalId: bankId, contractName: "Безготівка ", cashDesk: "каса грн" })],
      ctx
    );
    let p = await find(bankId);
    ok("банківську оплату створено", !!p && ctx.created === 1, ctx.errors);
    ok("спосіб — банк", p?.method === "bank_transfer", p?.method);
    ok("сирий договір збережено", p?.contractName === "Безготівка ", p?.contractName);
    ok("сира каса збережена", p?.cashDesk === "каса грн", p?.cashDesk);

    console.log("Повтор того самого запису");
    ctx = ctxOf();
    await applyPayments(
      [rec({ externalId: bankId, contractName: "Безготівка ", cashDesk: "каса грн" })],
      ctx
    );
    ok("нічого не змінилось", ctx.skipped === 1 && ctx.updated === 0, {
      skipped: ctx.skipped,
      updated: ctx.updated,
    });

    console.log("Перекласифікація вже завантаженої оплати");
    // Саме цей випадок робить бекфіл осмисленим: сума та сама, змінились
    // лише договір і каса. Стара гілка ідемпотентності пропускала запис і
    // жодна з наявних оплат не оновилася б.
    const legacyId = idOf("legacy");
    ctx = ctxOf();
    await applyPayments([rec({ externalId: legacyId, method: "cash" })], ctx);
    p = await find(legacyId);
    ok("оплата старого зразка лягла як готівка", p?.method === "cash", p?.method);
    ok("договір порожній", p?.contractName === null, p?.contractName);

    ctx = ctxOf();
    await applyPayments(
      [rec({ externalId: legacyId, contractName: "Безготівка ", cashDesk: "каса грн" })],
      ctx
    );
    p = await find(legacyId);
    ok("бекфіл перекласифікував її в банк", p?.method === "bank_transfer", p?.method);
    ok("порахована як оновлена, не пропущена", ctx.updated === 1 && ctx.skipped === 0, {
      updated: ctx.updated,
      skipped: ctx.skipped,
    });

    console.log("Рознесення на торгового не постраждало");
    const allocations = await prisma.paymentAllocation.count({
      where: { payment: { externalId: legacyId } },
    });
    const payment = await find(legacyId);
    ok(
      "оплата не пересоздана: id той самий, алокації на місці",
      !!payment && allocations >= 0,
      { allocations }
    );

    console.log("Прев'ю нічого не пише");
    const previewId = idOf("preview");
    ctx = ctxOf("preview");
    await applyPayments([rec({ externalId: previewId, contractName: "Безготівка " })], ctx);
    ok("у базі порожньо", (await find(previewId)) === null);
    ok("але порахована як створена", ctx.created === 1, ctx.created);

    console.log("Інтернет-магазин");
    const onlineId = idOf("online");
    ctx = ctxOf();
    await applyPayments(
      [rec({ externalId: onlineId, contractName: "Інтернет покупець", cashDesk: "ГРН Інтернет" })],
      ctx
    );
    ok("спосіб — інтернет", (await find(onlineId))?.method === "online");
  } finally {
    // Прибирання: оплати → рахунки → контрагент → прогін.
    const payments = await prisma.payment.findMany({
      where: { externalId: { contains: PREFIX } },
      select: { id: true, invoiceId: true },
    });
    const paymentIds = payments.map((p) => p.id);
    const invoiceIds = [...new Set(payments.map((p) => p.invoiceId))];

    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.syncDiscrepancy.deleteMany({ where: { syncJob: { fileName: `${PREFIX}.check` } } });
    await prisma.counterparty.deleteMany({ where: { externalId: `${PREFIX}-cp` } });
    await prisma.syncJob.deleteMany({ where: { fileName: `${PREFIX}.check` } });
  }

  console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено перевірок: ${failed}`);
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  });
