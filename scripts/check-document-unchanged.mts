/**
 * Перевірка звірки «документ не змінився» на живих документах.
 *
 * READ ONLY. Нічого не пише ні в базу, ні в 1С.
 *
 * Логіка перевірки. Беремо справжні документи з бази й будуємо з них же
 * «те, що прислала 1С» — тобто заздалегідь однакове. Звірка МУСИТЬ сказати
 * «не змінилось». Далі псуємо по одному полю за раз і вимагаємо протилежного.
 * Так ловляться обидві помилки: і надто поблажлива звірка (пропустить справжню
 * зміну — на сайті лишиться стара ціна), і надто сувора (нічого не пропустить,
 * і вся економія зникне).
 *
 *   npx tsx --env-file=.env scripts/check-document-unchanged.ts
 */

import { prisma } from "../src/lib/prisma";
import {
  documentUnchanged,
  type DesiredDocument,
  type DesiredItem,
  type StoredDocument,
  type StoredItem,
} from "../src/lib/sync-ingest/document-unchanged";

const SAMPLE = 200;

let passed = 0;
let failed = 0;

function check(name: string, got: boolean, want: boolean): void {
  if (got === want) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}: очікували ${want}, отримали ${got}`);
  }
}

const docs = await prisma.salesDocument.findMany({
  where: { externalId: { not: null } },
  orderBy: { createdAt: "desc" },
  take: SAMPLE,
  select: {
    id: true,
    number: true,
    status: true,
    docType: true,
    counterpartyId: true,
    salesRepId: true,
    totalAmount: true,
    profitAmount: true,
  },
});

const itemRows = await prisma.salesDocumentItem.findMany({
  where: { salesDocumentId: { in: docs.map((d) => d.id) } },
  select: {
    salesDocumentId: true,
    productId: true,
    quantity: true,
    sellingPrice: true,
    purchasePrice: true,
    lineNo: true,
  },
});

const itemsByDoc = new Map<string, StoredItem[]>();
for (const r of itemRows) {
  const item: StoredItem = {
    productId: r.productId,
    quantity: r.quantity,
    sellingPrice: r.sellingPrice,
    purchasePrice: r.purchasePrice,
    lineNo: r.lineNo,
  };
  const b = itemsByDoc.get(r.salesDocumentId);
  if (b) b.push(item);
  else itemsByDoc.set(r.salesDocumentId, [item]);
}

console.log(`Документів у вибірці: ${docs.length}, рядків: ${itemRows.length}\n`);

let withItems = 0;
let identicalOk = 0;

for (const d of docs) {
  const stored: StoredDocument = {
    number: d.number,
    status: d.status,
    docType: d.docType,
    counterpartyId: d.counterpartyId,
    salesRepId: d.salesRepId,
    totalAmount: d.totalAmount,
    profitAmount: d.profitAmount,
  };
  const storedItems = itemsByDoc.get(d.id) ?? [];
  if (storedItems.length > 0) withItems++;

  const desiredItems: DesiredItem[] = storedItems.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    price: i.sellingPrice,
    purchasePrice: i.purchasePrice,
    lineNo: i.lineNo,
  }));

  const base = (): DesiredDocument => ({
    numberCandidates: [d.number, `${d.number}/2026`, `${d.number}/abcdef12`],
    docType: d.docType,
    counterpartyId: d.counterpartyId,
    salesRepId: d.salesRepId,
    status: d.status,
    writesConfirmedAt: false,
    totalAmount: d.totalAmount,
    profitAmount: d.profitAmount ?? 0,
  });

  // 1. Те саме має дати «не змінилось».
  const same = documentUnchanged(stored, storedItems, base(), desiredItems);
  check(`той самий документ ${d.number}`, same, true);
  if (same) identicalOk++;

  // 2. Кожне зіпсоване поле має дати «змінилось».
  check(`${d.number}: інша сума`, documentUnchanged(stored, storedItems, { ...base(), totalAmount: d.totalAmount + 1 }, desiredItems), false);
  check(`${d.number}: інший прибуток`, documentUnchanged(stored, storedItems, { ...base(), profitAmount: (d.profitAmount ?? 0) + 1 }, desiredItems), false);
  check(`${d.number}: інший контрагент`, documentUnchanged(stored, storedItems, { ...base(), counterpartyId: "інший" }, desiredItems), false);
  check(`${d.number}: інший статус`, documentUnchanged(stored, storedItems, { ...base(), status: "CANCELLED_TEST" }, desiredItems), false);
  check(`${d.number}: інший вид документа`, documentUnchanged(stored, storedItems, { ...base(), docType: "RETURN_TEST" }, desiredItems), false);
  check(`${d.number}: чужий номер`, documentUnchanged(stored, storedItems, { ...base(), numberCandidates: ["ЧУЖИЙ-1", "ЧУЖИЙ-2"] }, desiredItems), false);
  check(`${d.number}: проведення чернетки`, documentUnchanged(stored, storedItems, { ...base(), writesConfirmedAt: true }, desiredItems), false);
  check(`${d.number}: інший торговий`, documentUnchanged(stored, storedItems, { ...base(), salesRepId: "інший-торговий" }, desiredItems), false);

  // 3. Торговий НЕ зіставлений — поле не пишеться, отже не привід переписувати.
  check(`${d.number}: торгового не зіставили`, documentUnchanged(stored, storedItems, { ...base(), salesRepId: null }, desiredItems), true);
  // 4. Статус не пишемо (складський стан сильніший) — теж не привід.
  check(`${d.number}: статус не пишемо`, documentUnchanged(stored, storedItems, { ...base(), status: null }, desiredItems), true);
  // 5. Копійчана різниця в межах допуску — не зміна.
  check(`${d.number}: різниця в пів копійки`, documentUnchanged(stored, storedItems, { ...base(), totalAmount: d.totalAmount + 0.005 }, desiredItems), true);

  if (desiredItems.length > 0) {
    const lessOne = desiredItems.slice(1);
    check(`${d.number}: рядок прибрали`, documentUnchanged(stored, storedItems, base(), lessOne), false);

    const qtyChanged = desiredItems.map((i, n) => (n === 0 ? { ...i, quantity: i.quantity + 1 } : i));
    check(`${d.number}: інша кількість`, documentUnchanged(stored, storedItems, base(), qtyChanged), false);

    const priceChanged = desiredItems.map((i, n) => (n === 0 ? { ...i, price: i.price + 1 } : i));
    check(`${d.number}: інша ціна`, documentUnchanged(stored, storedItems, base(), priceChanged), false);

    const costChanged = desiredItems.map((i, n) => (n === 0 ? { ...i, purchasePrice: i.purchasePrice + 1 } : i));
    check(`${d.number}: інша собівартість`, documentUnchanged(stored, storedItems, base(), costChanged), false);

    const otherProduct = desiredItems.map((i, n) => (n === 0 ? { ...i, productId: "інший-товар" } : i));
    check(`${d.number}: інший товар у рядку`, documentUnchanged(stored, storedItems, base(), otherProduct), false);

    const extra = [...desiredItems, { ...desiredItems[0], lineNo: 9999 }];
    check(`${d.number}: рядок дописали`, documentUnchanged(stored, storedItems, base(), extra), false);

    // Порядок рядків не має значення: у 1С він свій, у базі свій.
    const shuffled = [...desiredItems].reverse();
    check(`${d.number}: інший порядок рядків`, documentUnchanged(stored, storedItems, base(), shuffled), true);
  }
}

console.log(`\nДокументів із позиціями: ${withItems} із ${docs.length}`);
console.log(`Незмінних розпізнано правильно: ${identicalOk} із ${docs.length}`);
console.log(`\nПеревірок пройдено: ${passed}, провалено: ${failed}`);
if (failed > 0) {
  console.log("\nЗВІРКА НЕ ГОТОВА — не вмикати.");
  process.exitCode = 1;
} else {
  console.log("Звірка поводиться правильно на живих даних.");
}

await prisma.$disconnect();
