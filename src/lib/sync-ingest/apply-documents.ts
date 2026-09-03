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
): Promise<
  { productId: string; quantity: number; price: number; purchasePrice: number; lineNo: number | null }[]
> {
  if (items.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { externalId: { in: [...new Set(items.map((i) => i.productExternalId))] } },
    select: { id: true, externalId: true },
  });
  const byExternalId = new Map(products.map((p) => [p.externalId!, p.id]));

  const resolved: {
    productId: string;
    quantity: number;
    price: number;
    purchasePrice: number;
    lineNo: number | null;
  }[] = [];

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

    // 1С віддає собівартість СУМОЮ НА РЯДОК (13 шт → 638,43), а
    // SalesDocumentItem.purchasePrice — ціна за одиницю, як і sellingPrice.
    // Тому ділимо. Кількість 0 не буває (magnitude ≥ 0 і рядки з нулем 1С не
    // пише), але перевірка стоїть: ділення на нуль дало б Infinity, і воно
    // б тихо поїхало в базу як собівартість.
    //
    // Поле відсутнє → 0, як і раніше. Нуль тут чесний: доти обмін ставив
    // його всім рядкам, тож «0» уже означає «невідомо», і жоден звіт не
    // читає його як «продали за собівартістю» — маржа рахується лише там,
    // де purchasePrice > 0.
    // Модуль — бо знак задає ТИП ДОКУМЕНТА через quantity, а не собівартість.
    // У поверненнях регістр віддає собівартість із мінусом (перевірено:
    // −62 254 за липень), і без abs() тут вийшло б подвійне заперечення:
    // від'ємна кількість × від'ємна собівартість = плюс, тобто повернення
    // додавало б прибуток замість того, щоб його скасовувати.
    const lineCost = Number.isFinite(item.cost) ? Math.abs(item.cost as number) : 0;
    let unitCost = lineCost > 0 && magnitude > 0 ? lineCost / magnitude : 0;
    const price = Number.isFinite(item.price) ? item.price : 0;

    // Валютні документи: ціна лежить у валюті договору, а собівартість регістр
    // завжди віддає в гривні. На таких рядках собівартість виходить у ~40 разів
    // більшою за ціну, і документ показує фантастичний збиток (виміряно: 44
    // документи з 5165, співвідношення 39,1 і 40,7 — рівно курс долара).
    //
    // Курс тут застосувати неможливо: у рядку немає ні валюти, ні дати курсу,
    // а брати сьогоднішній для березневого документа — вигадати число. Тому
    // собівартість такого рядка ВІДКИДАЄМО: profitOf рахує лише по рядках із
    // відомою собівартістю, тож документ просто не дасть вкладу в маржу.
    // Недорахувати чесніше, ніж показати −246 680 при виручці 6 193.
    if (unitCost > 0 && price > 0 && unitCost > price * CURRENCY_MISMATCH_FACTOR) {
      ctx.discrepancy({
        entityType: "document_item",
        entityRef: documentNumber,
        entityName: `Товар ${item.productExternalId}`,
        field: "COST_CURRENCY_MISMATCH",
        value1C: `собівартість ${unitCost.toFixed(2)}`,
        valueBudvik: `ціна ${price.toFixed(2)} — схоже на валютний документ`,
      });
      unitCost = 0;
    }

    resolved.push({
      productId,
      quantity: sign * magnitude,
      price,
      purchasePrice: unitCost,
      // Порядок позицій, як його набрали в 1С. Старий агент поля не шле —
      // тоді null, і картка сортує такий документ за назвою товару.
      lineNo: Number.isFinite(item.lineNo) ? Math.trunc(item.lineNo as number) : null,
    });
  }

  return resolved;
}

/**
 * У скільки разів собівартість має перевищити ціну, щоб рядок вважався
 * валютним, а не збитковим.
 *
 * Між цими двома світами величезний зазор, тож поріг не тонкий: реальний
 * збиток — це десятки відсотків (найгірший чесний випадок у базі: ціна
 * нижча за собівартість у 2,3 раза, уцінка неліквіду), а валютний розрив —
 * це курс, тобто 39–41 раз для долара і євро. Десятка лежить посередині й
 * не чіпає жодного справжнього збитку.
 *
 * Злива в один бік навмисна: помилково відкинути собівартість означає
 * недорахувати маржу (видно як «покриття не 100%»), а помилково залишити —
 * показати керівнику мінус на чверть мільйона, якого не було.
 */
const CURRENCY_MISMATCH_FACTOR = 10;

/**
 * Валовий прибуток документа: Σ (ціна − собівартість) × кількість.
 *
 * Рахується лише по рядках, де собівартість справді приїхала. Рядок без неї
 * (purchasePrice = 0) додав би до прибутку всю свою виручку — тобто документ
 * із половиною незіставлених рядків показав би маржу, вищу за реальну. Краще
 * недорахувати прибуток, ніж вигадати його.
 *
 * Знак підтримується сам собою: у повернень quantity від'ємна, тож
 * повернення зменшує прибуток рівно на маржу, яку скасовує.
 */
function profitOf(items: { quantity: number; price: number; purchasePrice: number }[]): number {
  let profit = 0;
  for (const i of items) {
    if (i.purchasePrice <= 0) continue;
    profit += (i.price - i.purchasePrice) * i.quantity;
  }
  return Math.round(profit * 100) / 100;
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

    // ЗАМОВЛЕННЯ забираємо навіть непроведеними — як DRAFT.
    //
    // Торговий набирає замовлення в 1С, офіс проводить його пізніше (а часом
    // робить замість нього СВОЄ, під фактичний залишок). Доти сайт таких
    // документів не бачив узагалі: за серпень 2026 повз розділ «Документи»
    // пройшло 118 номерів замовлень, а торговий бачив натомість офісну копію
    // з іншою кількістю — саме звідси розбіжність 8300,52 проти 7675,52 у
    // Мандрика 26.08. Тепер його власне замовлення видно одразу зі статусом
    // «Не проведено», а коли офіс проведе — та сама картка оновиться до
    // реальних кількостей.
    //
    // Реалізації й повернення лишаються за старим правилом: їх набирає не
    // торговий, а склад, і непроведена реалізація на екрані торгового — це
    // сміття, якого він усе одно не пояснить.
    //
    // Непроведений документ, який у нас ВЖЕ Є, — окремий випадок: це або
    // чернетка, яку ще не провели (лишається DRAFT), або розпроведення вже
    // проведеного (їде в CANCELLED, див. nextStatus нижче).
    const isOrder = docType === "ORDER";
    if (!posted && !found && !isOrder) {
      ctx.skipped++;
      continue;
    }

    // Позначка видалення в 1С. Поля немає (старий агент) — документ живий.
    //
    // Без неї чернетки, які тепер живуть на сайті, ставали б безсмертними:
    // вікно перечитування — три дні, тож викинуту в 1С чернетку сайт більше
    // ніколи не побачив би у вивантаженні й лишив би її висіти в «Документах»
    // назавжди. Помічену бачимо, поки вона не видалена остаточно, — цього
    // вистачає, щоб прибрати її з екрана торгового.
    const deleted = rec.deleted ?? false;
    if (deleted && !found) {
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
          // Непроведеним сюди доходить лише замовлення (решту відсіяно вище).
          status: posted ? ("CONFIRMED" as const) : ("DRAFT" as const),
          totalAmount,
          createdById,
          createdAt: new Date(rec.date),
          // Дата проведення — тільки для проведеного: інакше чернетка
          // виглядала б підтвердженою всюди, де ця дата править за ознаку.
          confirmedAt: posted ? new Date(rec.date) : null,
          profitAmount: profitOf(items),
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              sellingPrice: i.price,
              purchasePrice: i.purchasePrice,
              lineNo: i.lineNo,
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
        // Непроведений документ означає різне залежно від того, чим він був
        // у нас. Був чернеткою — чернеткою й лишається: 1С її ще не провела,
        // і CANCELLED тут був би наклепом на живе замовлення торгового. Був
        // проведеним — це розпроведення, і йому справді дорога в CANCELLED.
        const nextStatus = posted
          ? ("CONFIRMED" as const)
          : found.status === "DRAFT" && !deleted
            ? ("DRAFT" as const)
            : ("CANCELLED" as const);

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
          // Чернетку провели — фіксуємо дату проведення. Уже проведеному її
          // не переставляємо: у 1С дата документа не міняється, а от у нас
          // на цю дату спираються звіти й лідерборд.
          ...(posted && found.status === "DRAFT" ? { confirmedAt: new Date(rec.date) } : {}),
          totalAmount,
          profitAmount: profitOf(items),
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              sellingPrice: i.price,
              purchasePrice: i.purchasePrice,
              lineNo: i.lineNo,
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

/**
 * Надходження товару з 1С (`ПоступлениеТоваровУслуг`) → PurchaseOrder.
 *
 * Дзеркало applySalesDocuments, з трьома відмінностями, і кожна має причину:
 *
 *  1. **Постачальник обов'язковий** — у схемі PurchaseOrder.supplierId не
 *     nullable, тож документ без зіставленого контрагента створити нема як.
 *     Такий іде в журнал розбіжностей, а не мовчки зникає.
 *  2. **Залишок не рухаємо.** Прихід на сайті нічого не додає до Product.stock:
 *     залишок веде 1С через регістр (apply-stock.ts перераховує його з
 *     LocationStock щоп'ять хвилин). Інкремент тут жив би до наступного
 *     циклу й лише розходився б із 1С.
 *  3. **Валюта.** Ціни й сума приходять у валюті документа, тож перед записом
 *     множимо на курс із шапки. Без курсу — числа лишаємо як є й пишемо
 *     розбіжність: мовчазна сума в доларах поруч із гривневими гірша за
 *     видиму невідповідність.
 *
 * Стани документа — ті самі, що для продажів (див. docs/1c-sync.md):
 * проведений → CONFIRMED, розпроведений або помічений на видалення →
 * CANCELLED, непроведений і небачений раніше → пропускаємо (це чернетка,
 * яку офіс ще набирає).
 */
export async function applyPurchaseDocuments(
  records: DocumentRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  const existing = await prisma.purchaseOrder.findMany({
    where: { externalId: { in: records.map((r) => r.externalId) } },
    select: { id: true, externalId: true, number: true, status: true },
  });
  const byExternalId = new Map(existing.map((d) => [d.externalId!, d]));

  const supplierExternalIds = [
    ...new Set(records.map((r) => r.counterpartyExternalId).filter((c): c is string => !!c)),
  ];
  const suppliers =
    supplierExternalIds.length > 0
      ? await prisma.counterparty.findMany({
          where: { externalId: { in: supplierExternalIds } },
          select: { id: true, externalId: true, type: true },
        })
      : [];
  const supplierByExternalId = new Map(suppliers.map((c) => [c.externalId!, c]));

  // Склади документів цього батча — одним запитом, а не по одному на документ.
  const warehouseExternalIds = [
    ...new Set(records.map((r) => r.warehouseExternalId).filter((w): w is string => !!w)),
  ];
  const warehouses =
    warehouseExternalIds.length > 0
      ? await prisma.stockLocation.findMany({
          where: { externalId: { in: warehouseExternalIds } },
          select: { id: true, externalId: true },
        })
      : [];
  const warehouseByExternalId = new Map(warehouses.map((w) => [w.externalId!, w.id]));

  for (const rec of records) {
    const supplier = rec.counterpartyExternalId
      ? supplierByExternalId.get(rec.counterpartyExternalId)
      : undefined;

    // На відміну від реалізації, постачальник у PurchaseOrder обов'язковий —
    // без нього документ створити неможливо.
    if (!supplier) {
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

    const found = byExternalId.get(rec.externalId);

    // Поле опційне: агент старішої версії його не шле. Відсутнє = проведений,
    // як і для документів продажу.
    const posted = rec.posted ?? true;
    const deleted = rec.deleted ?? false;

    // Непроведене надходження, якого в нас ще немає, — це чернетка, яку офіс
    // набирає просто зараз. Її кількості ще поїдуть, а на сайті вона читалась
    // би як реальний прихід. Уже наявний непроведений документ — навпаки,
    // розпроведення, і воно мусить доїхати (nextStatus нижче).
    if (!posted && !found) {
      ctx.skipped++;
      continue;
    }
    if (deleted && !found) {
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      found ? ctx.updated++ : ctx.created++;
      continue;
    }

    const items = await resolveItems(rec.items ?? [], ctx, rec.number);

    // Валютний документ: ціни рядків і сума лежать у валюті договору, а сайт
    // рахує все в гривні. Курс приходить із шапки того самого документа —
    // єдиний курс, який тут можна застосувати чесно (сьогоднішній для
    // березневої накладної був би вигаданим числом).
    const rate = currencyRateOf(rec, ctx);
    const priced = rate === 1 ? items : items.map((i) => ({ ...i, price: round2(i.price * rate) }));
    const totalAmount = round2(
      (rec.totalAmount ?? items.reduce((sum, i) => sum + i.quantity * i.price, 0)) * rate
    );

    const stockLocationId = rec.warehouseExternalId
      ? warehouseByExternalId.get(rec.warehouseExternalId) ?? null
      : null;

    // Номер документа 1С унікальний лише в межах року, а PurchaseOrder.number
    // унікальний глобально — той самий перебір, що й для продажів. Суфікс
    // детермінований, тож повторний прогін влучає в той самий запис.
    const numberCandidates = [
      rec.number,
      `${rec.number}/${new Date(rec.date).getFullYear()}`,
      `${rec.number}/${rec.externalId.slice(0, 8)}`,
    ];

    const nextStatus = posted && !deleted ? ("CONFIRMED" as const) : ("CANCELLED" as const);

    try {
      if (!found) {
        const createdById = await ensureSyncUser();
        const baseData = {
          externalId: rec.externalId,
          supplierId: supplier.id,
          stockLocationId,
          status: nextStatus,
          totalAmount,
          currencyCode: rate === 1 ? null : rec.currencyCode ?? null,
          currencyRate: rate === 1 ? null : rate,
          createdById,
          createdAt: new Date(rec.date),
          confirmedAt: nextStatus === "CONFIRMED" ? new Date(rec.date) : null,
          syncedAt: new Date(),
          items: {
            create: priced.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              purchasePrice: i.price,
              lineNo: i.lineNo,
            })),
          },
        };
        for (let c = 0; c < numberCandidates.length; c++) {
          try {
            await prisma.purchaseOrder.create({
              data: { ...baseData, number: numberCandidates[c] },
            });
            break;
          } catch (e) {
            if (!isNumberCollision(e) || c === numberCandidates.length - 1) throw e;
          }
        }
        ctx.created++;
      } else {
        const baseUpdate = {
          supplierId: supplier.id,
          stockLocationId,
          status: nextStatus,
          totalAmount,
          currencyCode: rate === 1 ? null : rec.currencyCode ?? null,
          currencyRate: rate === 1 ? null : rate,
          // Дату проведення ставимо лише при переході в CONFIRMED: у вже
          // проведеного вона й так дорівнює даті документа, а переставляти її
          // щопрогону означало б рухати документ у звітах за періодом.
          ...(nextStatus === "CONFIRMED" && found.status !== "CONFIRMED"
            ? { confirmedAt: new Date(rec.date) }
            : {}),
          createdAt: new Date(rec.date),
          syncedAt: new Date(),
          items: {
            create: priced.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              purchasePrice: i.price,
              lineNo: i.lineNo,
            })),
          },
        };
        // Табличну частину перезаписуємо цілком (див. коментар угорі файлу).
        for (let c = 0; c < numberCandidates.length; c++) {
          try {
            await prisma.$transaction([
              prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: found.id } }),
              prisma.purchaseOrder.update({
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
      }

      // Постачальник, якого 1С не позначила прапорцем «Поставщик», лишався б
      // у типі CUSTOMER — і зник би зі списку постачальників на сайті, хоча
      // накладна від нього щойно приїхала. Документ важить більше за прапорець.
      if (supplier.type === "CUSTOMER") {
        await prisma.counterparty.update({ where: { id: supplier.id }, data: { type: "BOTH" } });
        supplier.type = "BOTH";
      }

      if (nextStatus === "CONFIRMED") {
        await refreshSupplierPrices(supplier.id, new Date(rec.date), priced, ctx, rec.number);
      }
    } catch (e) {
      ctx.fail(`надходження ${rec.number}`, e);
    }
  }
}

/** Гроші округлюємо до копійки: множення на курс дає хвіст на 12 знаків. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Курс документа, на який множаться ціни рядків і сума.
 *
 * 1 означає «нічого не робимо»: документ гривневий або валюта без курсу.
 * Другий випадок окремо потрапляє в журнал — інакше сума в доларах лягла б
 * у ті самі звіти, що й гривневі, і ніхто б цього не побачив.
 */
function currencyRateOf(rec: DocumentRecord, ctx: ApplyContext): number {
  const code = rec.currencyCode?.trim();
  if (!code || code === BASE_CURRENCY_CODE) return 1;

  const rate = rec.currencyRate;
  if (Number.isFinite(rate) && (rate as number) > 0) return rate as number;

  ctx.discrepancy({
    entityType: "purchase_doc",
    entityRef: rec.number,
    entityName: `Надходження ${rec.number}`,
    field: "FOREIGN_CURRENCY_NO_RATE",
    value1C: `валюта ${code}, курс не надано`,
    valueBudvik: "суму записано як є, без перерахунку в гривню",
  });
  return 1;
}

/** Код гривні в 1С. */
const BASE_CURRENCY_CODE = "980";

/**
 * Остання ціна закупівлі по парі «постачальник + товар».
 *
 * Таблиця SupplierProduct до появи цього каналу була порожня, тож зв'язку
 * «товар → у кого беремо і по чому» в системі не існувало взагалі — саме
 * її не вистачало закупівельнику в розділі дефіциту.
 *
 * Виграє НОВІШИЙ документ, а не останній записаний: бекфіл читає історію
 * без гарантованого порядку, і без цієї перевірки накладна 2025 року
 * затирала б ціну з 2026-го.
 *
 * Збій тут не має валити документ: ціна постачальника — довідка, а сам
 * прихід уже збережений.
 */
async function refreshSupplierPrices(
  supplierId: string,
  docDate: Date,
  items: { productId: string; price: number }[],
  ctx: ApplyContext,
  documentNumber: string
): Promise<void> {
  const withPrice = items.filter((i) => i.price > 0);
  if (withPrice.length === 0) return;

  try {
    const productIds = [...new Set(withPrice.map((i) => i.productId))];
    const known = await prisma.supplierProduct.findMany({
      where: { supplierId, productId: { in: productIds } },
      select: { id: true, productId: true, lastUpdated: true },
    });
    const byProduct = new Map(known.map((k) => [k.productId, k]));

    for (const item of withPrice) {
      const existing = byProduct.get(item.productId);
      if (!existing) {
        await prisma.supplierProduct.create({
          data: {
            supplierId,
            productId: item.productId,
            purchasePrice: item.price,
            lastUpdated: docDate,
          },
        });
        continue;
      }
      if (existing.lastUpdated > docDate) continue;
      await prisma.supplierProduct.update({
        where: { id: existing.id },
        data: { purchasePrice: item.price, lastUpdated: docDate },
      });
    }
  } catch (e) {
    ctx.errors.push(
      `ціни постачальника за надходженням ${documentNumber}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
