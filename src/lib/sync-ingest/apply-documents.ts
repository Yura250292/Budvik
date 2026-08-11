/**
 * Документи продажу (замовлення й реалізації) та надходження з 1С.
 *
 * Замовлення (ЗаказПокупателя) і реалізації (РеализацияТоваровУслуг) ідуть
 * двома окремими потоками — sales_doc і realization_doc — але лягають в одну
 * таблицю SalesDocument, розрізняючись полем docType. Зіставлення завжди за
 * externalId: Ref_Key у 1С унікальний незалежно від типу документа, тож
 * колізії між потоками неможливі.
 *
 * SalesDocument.createdById і PurchaseOrder.createdById обов'язкові у схемі,
 * а в 1С автора документа зіставити ні з ким. Тому документи створюються від
 * імені технічного користувача "sync-1c@budvik.local" — так схема лишається
 * строгою, а походження документа видно з externalId і автора.
 *
 * Табличні частини перезаписуються цілком: у 1С рядок документа не має
 * стабільного ідентифікатора, тож дешевше й надійніше видалити старі рядки
 * та створити нові, ніж намагатися їх зіставити.
 */

import { Prisma, type SalesDocType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DocumentRecord, DocumentItemRecord } from "./types";
import { ApplyContext } from "./context";

/** P2002 саме по парі (number, docType), а не по externalId чи іншому полю. */
function isNumberCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) && target.includes("number");
}

const SYNC_USER_EMAIL = "sync-1c@budvik.local";

let cachedSyncUserId: string | null = null;

/** Технічний користувач-автор для документів, що прийшли з 1С. */
async function ensureSyncUser(): Promise<string> {
  if (cachedSyncUserId) return cachedSyncUserId;

  const existing = await prisma.user.findUnique({
    where: { email: SYNC_USER_EMAIL },
    select: { id: true },
  });
  if (existing) {
    cachedSyncUserId = existing.id;
    return existing.id;
  }

  const created = await prisma.user.create({
    data: {
      email: SYNC_USER_EMAIL,
      name: "Синхронізація 1С",
      role: "MANAGER",
      // password не задаємо: увійти цим користувачем неможливо
    },
    select: { id: true },
  });
  cachedSyncUserId = created.id;
  return created.id;
}

/**
 * Зіставляє рядки документа з товарами сайту за externalId.
 *
 * `sign` = -1 для повернень: у 1С їхні кількості додатні (перевірено пробою),
 * а на сайті зберігаються від'ємними, щоб будь-який SUM() одразу давав чистий
 * оборот. Див. коментар про знак у schema.prisma, модель SalesDocument.
 */
async function resolveItems(
  items: DocumentItemRecord[],
  ctx: ApplyContext,
  documentNumber: string,
  sign: 1 | -1 = 1
): Promise<{ productId: string; quantity: number; price: number }[]> {
  if (items.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { externalId: { in: [...new Set(items.map((i) => i.productExternalId))] } },
    select: { id: true, externalId: true },
  });
  const byExternalId = new Map(products.map((p) => [p.externalId!, p.id]));

  const resolved: { productId: string; quantity: number; price: number }[] = [];

  for (const item of items) {
    const productId = byExternalId.get(item.productExternalId);
    if (!productId) {
      // Документ зберігаємо навіть без цього рядка — інакше втратимо весь
      // документ через один незнайомий товар. Розбіжність лишається в журналі.
      ctx.discrepancy({
        entityType: "document_item",
        entityRef: documentNumber,
        entityName: `Товар ${item.productExternalId}`,
        field: "UNMATCHED_PRODUCT",
        value1C: `к-сть ${item.quantity}`,
        valueBudvik: "товар не знайдено",
      });
      continue;
    }
    // Модуль беремо навмисно: від'ємна кількість у 1С не трапляється
    // (перевірено пробою), а якби трапилась — знак усе одно задає тип
    // документа, і подвійне заперечення зробило б з повернення продаж.
    const magnitude = Math.max(0, Math.round(Math.abs(item.quantity)));
    resolved.push({
      productId,
      quantity: sign * magnitude,
      price: Number.isFinite(item.price) ? item.price : 0,
    });
  }

  return resolved;
}

/**
 * Прибирає комісію, нараховану за документ, який у 1С відтоді змінився.
 *
 * Комісія рахується від суми документа. Коли склад мінусує позицію в уже
 * проведеній накладній або її взагалі розпроводять, стара комісія лишається
 * висіти за сумою, якої більше немає.
 *
 * Виплачене (PAID) не чіпаємо: гроші вже в людини, і мовчки списати їх
 * синхронізацією — гірше, ніж лишити розбіжність. Такі випадки віддаємо
 * керівнику окремим записом у журналі.
 */
async function invalidateCommissions(
  found: { id: string; number: string; totalAmount: number },
  totalAmount: number,
  posted: boolean,
  ctx: ApplyContext
): Promise<void> {
  const amountChanged = Math.abs(found.totalAmount - totalAmount) > 0.01;
  if (!amountChanged && posted) return;

  const commissions = await prisma.commissionRecord.findMany({
    where: { salesDocumentId: found.id },
    select: { id: true, status: true, commissionAmount: true },
  });
  if (commissions.length === 0) return;

  const paid = commissions.filter((c) => c.status === "PAID");
  const unpaid = commissions.filter((c) => c.status !== "PAID");

  if (unpaid.length > 0) {
    await prisma.commissionRecord.deleteMany({
      where: { id: { in: unpaid.map((c) => c.id) } },
    });
  }

  if (paid.length > 0) {
    const paidSum = paid.reduce((s, c) => s + c.commissionAmount, 0);
    ctx.discrepancy({
      entityType: "document",
      entityRef: found.number,
      entityName: `Документ ${found.number}`,
      field: "STALE_PAID_COMMISSION",
      value1C: posted
        ? `сума змінилась: ${found.totalAmount} → ${totalAmount}`
        : "документ розпроведено в 1С",
      valueBudvik: `виплачена комісія ${paidSum.toFixed(2)} грн — потрібне рішення керівника`,
    });
  }
}

export async function applySalesDocuments(
  records: DocumentRecord[],
  ctx: ApplyContext,
  docType: SalesDocType = "ORDER"
): Promise<void> {
  if (records.length === 0) return;

  const docLabel =
    docType === "REALIZATION" ? "реалізація" : docType === "RETURN" ? "повернення" : "замовлення";

  // Повернення зберігаються від'ємними — див. коментар про знак у
  // schema.prisma (модель SalesDocument).
  const sign: 1 | -1 = docType === "RETURN" ? -1 : 1;

  const existing = await prisma.salesDocument.findMany({
    where: { externalId: { in: records.map((r) => r.externalId) } },
    select: { id: true, externalId: true, number: true, totalAmount: true, status: true },
  });
  const byExternalId = new Map(existing.map((d) => [d.externalId!, d]));

  const counterpartyExternalIds = [
    ...new Set(records.map((r) => r.counterpartyExternalId).filter((c): c is string => !!c)),
  ];
  const counterparties =
    counterpartyExternalIds.length > 0
      ? await prisma.counterparty.findMany({
          where: { externalId: { in: counterpartyExternalIds } },
          select: { id: true, externalId: true },
        })
      : [];
  const counterpartyByExternalId = new Map(counterparties.map((c) => [c.externalId!, c.id]));

  // Торговий, за яким рахується документ.
  //
  // У 1С це реквізит «Ответственный» — там 39 живих прізвищ, і саме на ньому
  // тримається вся аналітика «хто скільки продав». Зіставляємо з наявними
  // користувачами сайту за іменем; ненайдених НЕ створюємо — фіктивний
  // користувач зіпсував би і звіти, і розрахунок комісії. Замість цього
  // пишемо розбіжність, щоб адміністратор завів людину вручну.
  const repNames = [
    ...new Set(records.map((r) => r.salesRepName?.trim()).filter((n): n is string => !!n)),
  ];

  // Точне зіставлення імен тут не працює: у 1С записані повні імена
  // («Пац Валентин»), а на сайті часто лише ім'я («Валентин»). Тому беремо
  // всіх користувачів і зіставляємо за словами.
  const allUsers =
    repNames.length > 0
      ? await prisma.user.findMany({
          select: { id: true, name: true, role: true },
        })
      : [];

  /** Слова імені, нормалізовані; порядок і зайві пробіли не мають значення. */
  const wordsOf = (name: string) =>
    new Set(
      name
        .toLowerCase()
        .split(/[\s.]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 3)
    );

  const userWords = allUsers
    .filter((u) => !!u.name?.trim())
    .map((u) => ({ id: u.id, role: u.role, words: wordsOf(u.name!) }));

  const repIdByName = new Map<string, string>();
  for (const oneCName of repNames) {
    const target = wordsOf(oneCName);
    if (target.size === 0) continue;

    // Кандидат — той, чиї слова ПОВНІСТЮ входять в ім'я з 1С. «Валентин»
    // збігається з «Пац Валентин», але «Дмитро Ковальчук» з «Кулик Дмитро»
    // не збіжиться, бо «ковальчук» відсутнє.
    const candidates = userWords.filter(
      (u) => u.words.size > 0 && [...u.words].every((w) => target.has(w))
    );

    // Неоднозначність — привід не вгадувати: на сайті двоє «Дмитро», і
    // приписати чужі продажі гірше, ніж не приписати нікому.
    if (candidates.length === 1) {
      repIdByName.set(oneCName.toLowerCase(), candidates[0].id);
    }
  }
  const reportedMissingReps = new Set<string>();

  for (const rec of records) {
    const repName = rec.salesRepName?.trim();
    const salesRepId = repName ? repIdByName.get(repName.toLowerCase()) ?? null : null;

    // Звітуємо і в preview: інакше про незаведених торгових стало б відомо
    // лише після вмикання бойового режиму, тобто запізно.
    if (repName && !salesRepId && !reportedMissingReps.has(repName.toLowerCase())) {
      reportedMissingReps.add(repName.toLowerCase());
      ctx.discrepancy({
        entityType: "document",
        entityRef: rec.number,
        entityName: repName,
        field: "UNMATCHED_SALES_REP",
        value1C: repName,
        valueBudvik: "користувача з таким іменем немає на сайті",
      });
    }

    const found = byExternalId.get(rec.externalId);

    // Поле опційне: агент старішої версії його не шле. Відсутнє = проведений,
    // бо доти запити відбирали лише проведені документи. Інакше перший же
    // прогін старим агентом після оновлення сервера поскасовував би все.
    const posted = rec.posted ?? true;

    // Непроведений документ, якого ми ще не бачили, — це чернетка в 1С:
    // менеджер її ще набирає. Такі не імпортуємо взагалі, інакше сайт
    // заповнюється сміттям, яке ніколи не стане продажем.
    //
    // А от непроведений документ, який у нас ВЖЕ Є, — це розпроведення:
    // документ провели, ми його забрали, потім у 1С скасували. До появи
    // реального posted обмін про це не дізнавався ніколи (в запитах стояло
    // «ГДЕ Проведен», тож розпроведене просто зникало з вибірки), і документ
    // назавжди лишався CONFIRMED — з повною сумою в обороті торгового.
    if (!posted && !found) {
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      found ? ctx.updated++ : ctx.created++;
      continue;
    }

    const counterpartyId = rec.counterpartyExternalId
      ? counterpartyByExternalId.get(rec.counterpartyExternalId) ?? null
      : null;
    const items = await resolveItems(rec.items ?? [], ctx, rec.number, sign);
    // Рядки вже несуть знак, тому сума з них виходить від'ємною сама. А от
    // СуммаДокумента з 1С приходить додатною — їй знак треба поставити.
    const totalAmount =
      rec.totalAmount !== undefined
        ? sign * Math.abs(rec.totalAmount)
        : items.reduce((sum, i) => sum + i.quantity * i.price, 0);

    // Номер документа 1С унікальний лише В МЕЖАХ РОКУ: з нового року
    // нумерація починається заново, тож «00000000001» існує в кожному році.
    // Унікальність (number, docType) на сайті об цe розбилась на першому ж
    // backfill повернень: 1100 документів створилось, 1462 відбились із
    // P2002. При конфлікті пробуємо номер, доповнений роком документа —
    // суфікс детермінований, тому повторний прогін влучає в той самий запис,
    // а не плодить варіанти. Третій кандидат — страховка на випадок дубля
    // номера всередині одного року (у 1С не трапляється, але P2002 тоді буде
    // видимим у журналі, а не мовчазною втратою документа).
    const numberCandidates = [
      rec.number,
      `${rec.number}/${new Date(rec.date).getFullYear()}`,
      `${rec.number}/${rec.externalId.slice(0, 8)}`,
    ];

    try {
      if (!found) {
        const createdById = await ensureSyncUser();
        const baseData = {
          externalId: rec.externalId,
          docType,
          counterpartyId,
          salesRepId,
          // Сюди доходять лише проведені (непроведені нові відсіяні вище).
          status: "CONFIRMED" as const,
          totalAmount,
          createdById,
          createdAt: new Date(rec.date),
          confirmedAt: new Date(rec.date),
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              sellingPrice: i.price,
              purchasePrice: 0, // собівартість 1С у цьому обміні не передає
            })),
          },
        };
        for (let c = 0; c < numberCandidates.length; c++) {
          try {
            await prisma.salesDocument.create({
              data: { ...baseData, number: numberCandidates[c] },
            });
            break;
          } catch (e) {
            if (!isNumberCollision(e) || c === numberCandidates.length - 1) throw e;
          }
        }
        ctx.created++;
      } else {
        // Статус чіпаємо лише в межах «життя документа в 1С». Сайтові стани
        // складу (PACKING, IN_TRANSIT, DELIVERED) виставляють люди вже після
        // того, як документ приїхав, і обмін не має права їх відкочувати.
        const liveOnSite =
          found.status === "PACKING" ||
          found.status === "IN_TRANSIT" ||
          found.status === "DELIVERED";
        const nextStatus = posted ? ("CONFIRMED" as const) : ("CANCELLED" as const);

        // Табличну частину перезаписуємо цілком (див. коментар угорі файлу).
        const baseUpdate = {
          // Проставляємо і на update: рядки, створені до появи docType,
          // самі стають на місце при першому ж оновленні з 1С.
          docType,
          counterpartyId,
          // Лише коли зіставили: null затер би вручну проставленого
          // торгового, якщо ім'я в 1С тимчасово не збіглося.
          ...(salesRepId ? { salesRepId } : {}),
          // Розпроведення в 1С сильніше за складський стан: якщо документа
          // більше немає, зібрана чи навіть відвантажена коробка — привід
          // розібратись, а не показувати її як живий продаж.
          ...(liveOnSite && posted ? {} : { status: nextStatus }),
          totalAmount,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              sellingPrice: i.price,
              purchasePrice: 0,
            })),
          },
        };
        // Той самий перебір номерів, що й на create: документ, збережений із
        // суфіксом року, при оновленні знову спробує сирий номер, впіймає
        // конфлікт із «власником» цього номера з іншого року і повернеться до
        // свого суфіксованого — стабільно, без миготіння між варіантами.
        for (let c = 0; c < numberCandidates.length; c++) {
          try {
            await prisma.$transaction([
              prisma.salesDocumentItem.deleteMany({ where: { salesDocumentId: found.id } }),
              prisma.salesDocument.update({
                where: { id: found.id },
                data: { ...baseUpdate, number: numberCandidates[c] },
              }),
            ]);
            break;
          } catch (e) {
            if (!isNumberCollision(e) || c === numberCandidates.length - 1) throw e;
          }
        }
        ctx.updated++;

        await invalidateCommissions(found, totalAmount, posted, ctx);
      }
    } catch (e) {
      ctx.fail(`${docLabel} ${rec.number}`, e);
    }
  }
}

export async function applyPurchaseDocuments(
  records: DocumentRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  const existing = await prisma.purchaseOrder.findMany({
    where: { externalId: { in: records.map((r) => r.externalId) } },
    select: { id: true, externalId: true, number: true },
  });
  const byExternalId = new Map(existing.map((d) => [d.externalId!, d]));

  const supplierExternalIds = [
    ...new Set(records.map((r) => r.counterpartyExternalId).filter((c): c is string => !!c)),
  ];
  const suppliers =
    supplierExternalIds.length > 0
      ? await prisma.counterparty.findMany({
          where: { externalId: { in: supplierExternalIds } },
          select: { id: true, externalId: true },
        })
      : [];
  const supplierByExternalId = new Map(suppliers.map((c) => [c.externalId!, c.id]));

  for (const rec of records) {
    const supplierId = rec.counterpartyExternalId
      ? supplierByExternalId.get(rec.counterpartyExternalId)
      : undefined;

    // На відміну від реалізації, постачальник у PurchaseOrder обов'язковий —
    // без нього документ створити неможливо.
    if (!supplierId) {
      ctx.discrepancy({
        entityType: "purchase_doc",
        entityRef: rec.number,
        entityName: `Надходження ${rec.number}`,
        field: "UNMATCHED_SUPPLIER",
        value1C: rec.counterpartyExternalId ?? "не вказано",
        valueBudvik: "постачальник не знайдений",
      });
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      byExternalId.has(rec.externalId) ? ctx.updated++ : ctx.created++;
      continue;
    }

    const items = await resolveItems(rec.items ?? [], ctx, rec.number);
    const totalAmount =
      rec.totalAmount ?? items.reduce((sum, i) => sum + i.quantity * i.price, 0);

    const found = byExternalId.get(rec.externalId);

    try {
      if (!found) {
        const createdById = await ensureSyncUser();
        await prisma.purchaseOrder.create({
          data: {
            externalId: rec.externalId,
            number: rec.number,
            supplierId,
            status: rec.posted ? "CONFIRMED" : "DRAFT",
            totalAmount,
            createdById,
            createdAt: new Date(rec.date),
            confirmedAt: rec.posted ? new Date(rec.date) : null,
            items: {
              create: items.map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
                purchasePrice: i.price,
              })),
            },
          },
        });
        ctx.created++;
      } else {
        await prisma.$transaction([
          prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: found.id } }),
          prisma.purchaseOrder.update({
            where: { id: found.id },
            data: {
              number: rec.number,
              supplierId,
              status: rec.posted ? "CONFIRMED" : "DRAFT",
              totalAmount,
              items: {
                create: items.map((i) => ({
                  productId: i.productId,
                  quantity: i.quantity,
                  purchasePrice: i.price,
                })),
              },
            },
          }),
        ]);
        ctx.updated++;
      }
    } catch (e) {
      ctx.fail(`надходження ${rec.number}`, e);
    }
  }
}
