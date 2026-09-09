/**
 * Чи документ у базі вже такий самий, яким його щойно прислала 1С.
 *
 * Навіщо. Обмін перезаписує табличну частину документа ЦІЛКОМ: спершу
 * `deleteMany` усіх позицій, потім `create` заново. Робиться це щоразу, коли
 * документ потрапляє у вивантаження, а вікно перечитування — три дні. Заміряно
 * 09.09.2026: 142 тисячі вставок і видалень рядків НА ДОБУ заради 48 тисяч
 * живих. Тобто таблиця тричі на день переписується сама в себе.
 *
 * Платимо за це не абстрактно: кожен такий перезапис іде в журнал транзакцій,
 * лишає мертві рядки під autovacuum і потрапляє в добовий бекап як «змінені
 * блоки». Саме звідси 600 МБ у щоденному бекапі при базі на 345 МБ.
 *
 * Тому перед записом порівнюємо. Правило одне і просте: **сумніваєшся —
 * перезаписуй**. Порівняння мусить покривати КОЖНЕ поле, яке пише оновлення;
 * пропустити хоч одне означає показати на сайті стару ціну або стару кількість,
 * а це гірше за будь-яку економію. Тому функція повертає true тільки тоді, коли
 * збіглося все до єдиного поля.
 */

/** Копійка. Гроші з 1С приходять float-ом, тож рівність тут завжди з допуском. */
const MONEY_EPSILON = 0.01;

export type StoredDocument = {
  number: string;
  status: string;
  docType: string;
  counterpartyId: string | null;
  salesRepId: string | null;
  totalAmount: number;
  profitAmount: number | null;
};

export type StoredItem = {
  productId: string;
  quantity: number;
  sellingPrice: number;
  purchasePrice: number;
  lineNo: number | null;
};

export type DesiredDocument = {
  /** Номери, які оновлення готове поставити: сирий і суфіксовані запасні. */
  numberCandidates: string[];
  docType: string;
  counterpartyId: string | null;
  /** null означає «не зіставили» — тоді оновлення це поле НЕ чіпає. */
  salesRepId: string | null;
  /** null означає «статус не пишемо» (складський стан сильніший). */
  status: string | null;
  /** true — оновлення поставить `confirmedAt`, тобто це перехід стану. */
  writesConfirmedAt: boolean;
  totalAmount: number;
  profitAmount: number;
};

export type DesiredItem = {
  productId: string;
  quantity: number;
  price: number;
  purchasePrice: number;
  lineNo: number | null;
};

function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) <= MONEY_EPSILON;
}

/** Порядок рядків у 1С свій, у базі свій — тому звіряємо як множини. */
function itemKey(productId: string, lineNo: number | null): string {
  return `${lineNo ?? -1}::${productId}`;
}

export function documentUnchanged(
  stored: StoredDocument,
  storedItems: StoredItem[],
  desired: DesiredDocument,
  desiredItems: DesiredItem[]
): boolean {
  // Перехід «чернетку провели» завжди пишемо: він ставить дату проведення,
  // на яку спираються звіти й лідерборд.
  if (desired.writesConfirmedAt) return false;

  // Номер. Достатньо, щоб збережений був СЕРЕД кандидатів: оновлення перебирає
  // їх по черзі й зупиняється на першому, що не конфліктує, тож збережений
  // суфіксований номер лишиться таким і після перезапису.
  if (!desired.numberCandidates.includes(stored.number)) return false;

  if (stored.docType !== desired.docType) return false;
  if (stored.counterpartyId !== desired.counterpartyId) return false;

  // Торгового пишемо лише коли зіставили — не зіставили, значить поле не
  // чіпаємо, і його розбіжність не привід переписувати документ.
  if (desired.salesRepId !== null && stored.salesRepId !== desired.salesRepId) return false;

  // Те саме зі статусом: null означає «не пишемо».
  if (desired.status !== null && stored.status !== desired.status) return false;

  if (!sameMoney(stored.totalAmount, desired.totalAmount)) return false;
  if (stored.profitAmount === null || !sameMoney(stored.profitAmount, desired.profitAmount)) {
    return false;
  }

  if (storedItems.length !== desiredItems.length) return false;

  const byKey = new Map<string, StoredItem[]>();
  for (const it of storedItems) {
    const k = itemKey(it.productId, it.lineNo);
    const bucket = byKey.get(k);
    if (bucket) bucket.push(it);
    else byKey.set(k, [it]);
  }

  for (const want of desiredItems) {
    const bucket = byKey.get(itemKey(want.productId, want.lineNo));
    if (!bucket || bucket.length === 0) return false;
    const at = bucket.findIndex(
      (have) =>
        have.quantity === want.quantity &&
        sameMoney(have.sellingPrice, want.price) &&
        sameMoney(have.purchasePrice, want.purchasePrice)
    );
    if (at === -1) return false;
    bucket.splice(at, 1);
  }

  return true;
}
