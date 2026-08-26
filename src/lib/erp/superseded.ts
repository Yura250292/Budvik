/**
 * Чернетка замовлення, яку офіс замінив власним документом.
 *
 * Відколи обмін забирає непроведені замовлення (див. apply-documents.ts),
 * на одну поставку в «Документах» може лежати ДВА документи 1С: те, що
 * набрав торговий, і те, що офіс провів замість нього під фактичний
 * залишок. Так у 1С і є — прив'язки між ними там немає взагалі:
 * ДокументОснование і СделкаСКонтрагентом у цій конфігурації відсутні
 * (перевірено пробами, див. коментар _salesRepComment у queries.json).
 *
 * Тому зв'язок доводиться відновлювати здогадкою. Вона навмисно вузька,
 * бо ціна помилки несиметрична: не помітити заміну — це зайва картка в
 * списку, а помилково назвати заміною чуже замовлення — це показати
 * торговому недовіз, якого не було.
 *
 * Умови разом:
 *   1. Той самий контрагент.
 *   2. Той самий ДЕНЬ за датою документа 1С.
 *   3. Проведений документ виник ПІЗНІШЕ за чернетку.
 *   4. Половина позицій чернетки і більше є в проведеному.
 *   5. Спільних позицій щонайменше три.
 *
 * П'ята умова здається зайвою, поки не поміряти. За півроку в базі 524
 * пари «той самий клієнт + той самий день»; збіг ≥50% дають 31 з них, і
 * майже всі — документи на ОДНУ-ДВІ позиції, де стовідсотковий збіг
 * виходить сам собою (5 040 і 4 533,28 на той самий товар — це просто два
 * різні замовлення). Щойно вимагаємо три спільні позиції, лишається одна
 * пара з 524: 00000004142 і 00000004143 — той самий клієнт, ті самі вісім
 * позицій, та сама сума 22 807,95, тобто рівно те, що ми й шукаємо.
 *
 * Ціна п'ятої умови — заміну малого замовлення (одна-дві позиції) ми не
 * помітимо, і торговий побачить дві картки без пояснення. Це прийнятний
 * бік помилки; протилежний — приписати недовіз, якого не було.
 *
 * Приклад, з якого це виросло (26.08.2026, Мандрик Юрій Петрович):
 * чернетка 00000006563 о 13:40 на 8 300,52 і проведене 00000006569 о
 * 14:29 на 7 675,52 — ті самі 14 позицій, різниця в одній одиниці
 * «SIGMA Правило трапеція 2500мм». Збіг позицій — 14 з 14.
 */

import { prisma } from "@/lib/prisma";

/** Документ, який замінив чернетку. */
export type Replacement = {
  id: string;
  number: string;
  totalAmount: number;
};

/** Чернетка, для якої шукаємо заміну. Рівно ті поля, що є і в списку, і в картці. */
type DraftRef = {
  id: string;
  counterpartyId: string | null;
  createdAt: Date;
  status: string;
  externalId: string | null;
};

/** Яка частка позицій чернетки має знайтись у проведеному документі. */
const MIN_OVERLAP = 0.5;

/** І скільки спільних позицій щонайменше — див. п'яту умову вгорі файлу. */
const MIN_MATCHED = 3;

/**
 * День документа 1С.
 *
 * Дати з 1С лежать у базі як стінний час без зсуву (агент віддає
 * «2026-08-26T14:29:38», сервер читає це як UTC — див. formatDocDate у
 * lib/utils.ts). Тому день документа — це просто дата зі збереженого
 * значення в UTC, і жодного перерахунку в київську добу тут не треба:
 * обидва документи приїхали одним шляхом і зміщені однаково.
 */
function docDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Чи це непроведена чернетка, що приїхала з 1С. */
export function isOneCDraft(doc: { status: string; externalId?: string | null }): boolean {
  return doc.status === "DRAFT" && !!doc.externalId;
}

/**
 * Для кожної чернетки з 1С — документ, який її замінив (якщо такий є).
 *
 * Приймає вже завантажений список документів, щоб і список, і картка
 * рахували зв'язок однаково, і щоб не робити запит там, де чернеток немає.
 */
export async function findReplacements<T extends DraftRef>(
  docs: T[]
): Promise<Map<string, Replacement>> {
  const result = new Map<string, Replacement>();

  const drafts = docs.filter((d) => isOneCDraft(d) && d.counterpartyId);
  if (drafts.length === 0) return result;

  const counterpartyIds = [...new Set(drafts.map((d) => d.counterpartyId!))];
  const times = drafts.map((d) => d.createdAt.getTime());

  // Вікно пошуку — від початку доби найранішої чернетки до кінця доби
  // найпізнішої. Разом із фільтром за контрагентом це кілька десятків
  // рядків навіть на списку з періодом «Всі».
  const from = new Date(`${docDay(new Date(Math.min(...times)))}T00:00:00.000Z`);
  const to = new Date(`${docDay(new Date(Math.max(...times)))}T23:59:59.999Z`);

  const [draftItems, candidates] = await Promise.all([
    prisma.salesDocumentItem.findMany({
      where: { salesDocumentId: { in: drafts.map((d) => d.id) } },
      select: { salesDocumentId: true, productId: true },
    }),
    prisma.salesDocument.findMany({
      where: {
        docType: "ORDER",
        // Тільки документи обміну: набране на сайті вручну замовлення
        // ніяк не може бути «тим, що офіс провів у 1С замість чернетки».
        externalId: { not: null },
        // Ані чернетка (це другий бік тієї самої пари), ані скасоване.
        // PACKING/IN_TRANSIT/DELIVERED лишаються: це проведений документ,
        // якому склад уже проставив свій стан.
        status: { notIn: ["DRAFT", "CANCELLED"] },
        counterpartyId: { in: counterpartyIds },
        createdAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        number: true,
        totalAmount: true,
        createdAt: true,
        counterpartyId: true,
        items: { select: { productId: true } },
      },
    }),
  ]);

  if (candidates.length === 0) return result;

  const productsByDraft = new Map<string, Set<string>>();
  for (const row of draftItems) {
    let set = productsByDraft.get(row.salesDocumentId);
    if (!set) productsByDraft.set(row.salesDocumentId, (set = new Set()));
    set.add(row.productId);
  }

  for (const draft of drafts) {
    const draftProducts = productsByDraft.get(draft.id);
    // Чернетка без рядків: збіг рахувати нема на чому, а зв'язок «той
    // самий клієнт того ж дня» сам по собі занадто слабкий.
    if (!draftProducts || draftProducts.size === 0) continue;

    const day = docDay(draft.createdAt);
    let best: { doc: (typeof candidates)[number]; overlap: number } | null = null;

    for (const candidate of candidates) {
      if (candidate.counterpartyId !== draft.counterpartyId) continue;
      if (docDay(candidate.createdAt) !== day) continue;
      // Заміна не може передувати тому, що замінює.
      if (candidate.createdAt.getTime() < draft.createdAt.getTime()) continue;

      const candidateProducts = new Set(candidate.items.map((i) => i.productId));
      let matched = 0;
      for (const productId of draftProducts) {
        if (candidateProducts.has(productId)) matched++;
      }
      if (matched < MIN_MATCHED) continue;
      const overlap = matched / draftProducts.size;
      if (overlap < MIN_OVERLAP) continue;

      // Найбільший збіг, а за рівного — найближчий у часі: коли офіс
      // розбив замовлення на дві накладні, чернетку логічніше прив'язати
      // до тієї, що виникла одразу після неї.
      if (
        !best ||
        overlap > best.overlap ||
        (overlap === best.overlap && candidate.createdAt < best.doc.createdAt)
      ) {
        best = { doc: candidate, overlap };
      }
    }

    if (best) {
      result.set(draft.id, {
        id: best.doc.id,
        number: best.doc.number,
        totalAmount: best.doc.totalAmount,
      });
    }
  }

  return result;
}
