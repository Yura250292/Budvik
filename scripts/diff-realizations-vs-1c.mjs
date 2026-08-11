/**
 * Порівнює вивантаження реалізацій з 1С із тим, що зберіг сайт.
 *
 * Навіщо: офіс проводить документ, склад дзвонить «цієї позиції немає» — і
 * рядок мінусують уже в проведеному документі. Сайт таку правку витримав би
 * (при повторній синхронізації таблична частина перезаписується цілком), але
 * він про неї не дізнається: документи відбираються за ДАТОЮ ДОКУМЕНТА у вікні
 * 15 хвилин, тож зміна у вчорашній накладній лишається невидимою до нічного
 * повного прогону, а розпроведення — назавжди (в усіх запитах «ГДЕ Проведен»).
 *
 * Цей скрипт вимірює, наскільки це реально болить: кожна розбіжність — це
 * правка, яка до нас не доїхала, а вік найстарішого розбіжного документа
 * задає, на скільки днів має сягати вікно повторного перечитування
 * (documents.rescanDays).
 *
 * Вхід: realization-lines-<stamp>.ndjson від agent/ps/probe-corrections.ps1.
 * Читає базу лише на читання, нічого не змінює.
 *
 * Запуск:
 *   node --env-file=.env scripts/diff-realizations-vs-1c.mjs ~/Downloads/realization-lines-20260811-1530.ndjson
 *
 * Два вивантаження з інтервалом у робочий день можна порівняти між собою:
 *   node --env-file=.env scripts/diff-realizations-vs-1c.mjs файл1.ndjson файл2.ndjson
 * — це покаже, скільки документів редагують за добу.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const paths = args.filter((a) => !a.startsWith("--"));
const verbose = args.includes("--verbose");

if (paths.length === 0) {
  console.error("Вкажіть шлях до realization-lines-*.ndjson (див. agent/ps/probe-corrections.ps1)");
  process.exit(1);
}

const money = (n) => Number(n ?? 0).toLocaleString("uk-UA", { maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

function readDump(path) {
  const byId = new Map();
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const rec = JSON.parse(trimmed);
    if (!rec.externalId) continue;
    byId.set(rec.externalId, rec);
  }
  return byId;
}

/** Ключ порівняння рядків: товар + кількість + ціна, відсортовано. */
function itemsKey(items) {
  return (items ?? [])
    .map((i) => `${i.productExternalId}:${Number(i.quantity ?? 0)}:${Number(i.price ?? 0)}`)
    .sort()
    .join("|");
}

/** Кількості по товару — щоб показати, що саме змінилось. */
function qtyByProduct(items) {
  const map = new Map();
  for (const i of items ?? []) {
    const id = i.productExternalId;
    map.set(id, (map.get(id) ?? 0) + Number(i.quantity ?? 0));
  }
  return map;
}

async function compareTwoDumps(pathA, pathB) {
  const a = readDump(pathA);
  const b = readDump(pathB);
  console.log(`Вивантаження A: ${a.size} документів (${pathA})`);
  console.log(`Вивантаження B: ${b.size} документів (${pathB})`);
  console.log("");

  let changed = 0;
  let appeared = 0;
  const changedDocs = [];

  for (const [id, recB] of b) {
    const recA = a.get(id);
    if (!recA) {
      appeared++;
      continue;
    }
    const sameItems = itemsKey(recA.items) === itemsKey(recB.items);
    const sameTotal = Math.abs(Number(recA.totalAmount ?? 0) - Number(recB.totalAmount ?? 0)) < 0.01;
    const samePosted = Boolean(recA.posted) === Boolean(recB.posted);
    if (!sameItems || !sameTotal || !samePosted) {
      changed++;
      changedDocs.push({ id, recA, recB, sameItems, sameTotal, samePosted });
    }
  }

  console.log(`Змінено між вивантаженнями: ${changed} документів`);
  console.log(`Нових (з'явились у B): ${appeared}`);
  console.log("");

  for (const c of changedDocs.slice(0, 20)) {
    const age = Math.round((Date.now() - new Date(c.recB.date).getTime()) / 86400000);
    const what = [];
    if (!c.samePosted) what.push(`проведення ${c.recA.posted} → ${c.recB.posted}`);
    if (!c.sameTotal) what.push(`сума ${money(c.recA.totalAmount)} → ${money(c.recB.totalAmount)}`);
    if (!c.sameItems) what.push("склад рядків");
    console.log(`  №${c.recB.number} від ${day(c.recB.date)} (вік ${age} дн.): ${what.join(", ")}`);
  }
  if (changedDocs.length > 20) console.log(`  … і ще ${changedDocs.length - 20}`);

  if (changedDocs.length > 0) {
    const maxAge = Math.max(
      ...changedDocs.map((c) => Math.round((Date.now() - new Date(c.recB.date).getTime()) / 86400000)),
    );
    console.log("");
    console.log(`Найстарший відредагований документ: ${maxAge} дн. → rescanDays має бути ≥ ${maxAge}`);
  }
}

async function compareWithDatabase(path) {
  const dump = readDump(path);
  console.log(`Вивантаження з 1С: ${dump.size} документів (${path})`);

  const ids = [...dump.keys()];
  const docs = await prisma.salesDocument.findMany({
    where: { externalId: { in: ids }, docType: "REALIZATION" },
    select: {
      externalId: true,
      number: true,
      status: true,
      totalAmount: true,
      updatedAt: true,
      items: {
        select: {
          quantity: true,
          sellingPrice: true,
          product: { select: { externalId: true } },
        },
      },
    },
  });
  console.log(`Знайдено на сайті: ${docs.length}`);
  console.log(`Немає на сайті зовсім: ${dump.size - docs.length}`);
  console.log("");

  const byId = new Map(docs.map((d) => [d.externalId, d]));

  const mismatched = [];
  let okCount = 0;
  let unpostedButConfirmed = 0;

  for (const [id, rec] of dump) {
    const doc = byId.get(id);
    if (!doc) continue;

    // Розпроведений у 1С, але «підтверджений» на сайті — саме той випадок,
    // коли обмін не має жодного шансу дізнатися про зміну.
    if (!rec.posted && doc.status === "CONFIRMED") unpostedButConfirmed++;

    const siteItems = doc.items.map((i) => ({
      productExternalId: i.product?.externalId ?? null,
      quantity: i.quantity,
      price: i.sellingPrice,
    }));

    // Порівнюємо лише кількості по товарах: ціна на сайті могла округлитись
    // інакше, а нас цікавить саме «відмінусували позицію».
    const oneCQty = qtyByProduct(rec.items);
    const siteQty = qtyByProduct(siteItems);

    const diffs = [];
    for (const [prod, qty] of oneCQty) {
      const siteVal = siteQty.get(prod) ?? 0;
      // Кількість на сайті — Int, тож дробові з 1С там округлені.
      if (Math.abs(Math.round(qty) - siteVal) > 0) {
        diffs.push({ prod, oneC: qty, site: siteVal });
      }
    }
    for (const [prod, qty] of siteQty) {
      if (!oneCQty.has(prod)) diffs.push({ prod, oneC: 0, site: qty });
    }

    const totalDiff = Math.abs(Number(rec.totalAmount ?? 0) - Number(doc.totalAmount ?? 0));

    if (diffs.length > 0 || totalDiff > 0.01 || (!rec.posted && doc.status === "CONFIRMED")) {
      mismatched.push({ rec, doc, diffs, totalDiff });
    } else {
      okCount++;
    }
  }

  console.log(`Збігається: ${okCount}`);
  console.log(`РОЗБІЖНОСТІ: ${mismatched.length}`);
  console.log(`Розпроведені в 1С, але CONFIRMED на сайті: ${unpostedButConfirmed}`);
  console.log("");

  if (mismatched.length === 0) {
    console.log("Слідів невидимих правок немає — або їх справді не роблять,");
    console.log("або останній повний прогін щойно все вирівняв. Варто повторити");
    console.log("пробу в кінці робочого дня.");
    return;
  }

  // Вік найстарішої розбіжності — головна цифра: саме вона задає rescanDays.
  const ages = mismatched.map((m) => Math.round((Date.now() - new Date(m.rec.date).getTime()) / 86400000));
  ages.sort((a, b) => a - b);
  const p50 = ages[Math.floor(ages.length * 0.5)];
  const p90 = ages[Math.floor(ages.length * 0.9)];
  const max = ages[ages.length - 1];

  console.log("Вік розбіжних документів (днів від дати документа):");
  console.log(`  медіана ${p50},  90-й перцентиль ${p90},  максимум ${max}`);
  console.log("");
  console.log(`→ rescanDays ≥ ${p90} покриє 90% правок; ≥ ${max} покриє всі знайдені.`);
  console.log("");

  const show = verbose ? mismatched : mismatched.slice(0, 25);
  for (const m of show) {
    const age = Math.round((Date.now() - new Date(m.rec.date).getTime()) / 86400000);
    const flags = [];
    if (!m.rec.posted) flags.push(`РОЗПРОВЕДЕНО (сайт: ${m.doc.status})`);
    if (m.totalDiff > 0.01) {
      flags.push(`сума 1С ${money(m.rec.totalAmount)} ≠ сайт ${money(m.doc.totalAmount)}`);
    }
    if (m.diffs.length > 0) flags.push(`рядків розійшлось: ${m.diffs.length}`);
    console.log(`  №${m.rec.number} від ${day(m.rec.date)} (вік ${age} дн., синх. ${day(m.doc.updatedAt)})`);
    console.log(`     ${flags.join("; ")}`);
    if (verbose) {
      for (const d of m.diffs.slice(0, 5)) {
        console.log(`       товар ${d.prod}: 1С ${d.oneC} → сайт ${d.site}`);
      }
    }
  }
  if (!verbose && mismatched.length > 25) {
    console.log(`  … і ще ${mismatched.length - 25} (запустіть з --verbose)`);
  }
}

try {
  if (paths.length >= 2) {
    await compareTwoDumps(paths[0], paths[1]);
  } else {
    await compareWithDatabase(paths[0]);
  }
} finally {
  await prisma.$disconnect();
}
