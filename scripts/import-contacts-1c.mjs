/**
 * Вносить адреси й телефони клієнтів, вивантажені з 1С, у базу сайту.
 *
 * Звідки файл: agent/ps/export-contacts.ps1 — читальний скрипт, який
 * запускають на сервері 1С руками. Він вивантажує регістр контактної
 * інформації в NDJSON; сам обмін цих даних не приносить, бо в довіднику
 * контрагентів адреси немає взагалі (перевірено пробою: жоден із семи
 * можливих реквізитів не існує).
 *
 * Навіщо: сайт геокодує клієнта саме з `address`, а на ньому тримаються
 * карта клієнтів, побудова маршрутів і зони доставки водіям.
 *
 * Що робить: заповнює ПОРОЖНІ поля. Наявне значення не чіпає — його могла
 * уточнити людина, і затирати ручну роботу вивантаженням не можна. Розбіжні
 * адреси лише показує списком, щоб рішення лишалось за людиною.
 *
 * Запуск (спершу без --apply — покаже, що саме зміниться):
 *   node --env-file=.env scripts/import-contacts-1c.mjs [файл]
 *   node --env-file=.env scripts/import-contacts-1c.mjs [файл] --apply
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const FILE = fileArg || `${process.env.HOME}/Downloads/contacts.ndjson`;

/**
 * Подвійний зворотний слеш у вивантаженні — слід помилки в екрануванні:
 * у .NET шаблон `-replace` читається як регекс, а рядок заміни — буквально,
 * тож слеші подвоювались. У ранньому файлі це зачепило 5 адрес із дробом на
 * кшталт «18\67». Експортер виправлено, а ця нормалізація лишається, щоб
 * файл, вивантажений до виправлення, вносився правильно.
 */
const unescapeSlashes = (v) => (typeof v === "string" ? v.replace(/\\+/g, "\\") : v);

const rows = readFileSync(FILE, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .map((r) => ({ ...r, address: unescapeSlashes(r.address), phone: unescapeSlashes(r.phone) }));

console.log(`у файлі: ${rows.length} записів`);

const byExternalId = new Map(rows.map((r) => [r.externalId, r]));

const existing = await prisma.counterparty.findMany({
  where: { externalId: { in: [...byExternalId.keys()] } },
  select: { id: true, externalId: true, code: true, name: true, address: true, phone: true, email: true },
});

console.log(`зіставлено з базою: ${existing.length}`);

const updates = [];
const conflicts = [];
let unmatched = 0;

for (const cp of existing) {
  const rec = byExternalId.get(cp.externalId);
  if (!rec) continue;

  const data = {};
  if (rec.address && !cp.address?.trim()) data.address = rec.address;
  if (rec.phone && !cp.phone?.trim()) data.phone = rec.phone;
  if (rec.email && !cp.email?.trim()) data.email = rec.email;

  // Адреса є з обох боків і вони різні — не наша справа вирішувати, чия
  // правильніша: у 1С може бути юридична, а на сайті уточнена доставка.
  if (rec.address && cp.address?.trim() && rec.address !== cp.address.trim()) {
    conflicts.push({ code: cp.code, name: cp.name, site: cp.address, oneC: rec.address });
  }

  if (Object.keys(data).length > 0) updates.push({ id: cp.id, name: cp.name, data });
}
unmatched = rows.length - existing.length;

const willFill = (field) => updates.filter((u) => u.data[field]).length;
console.log(`\nбуде заповнено:`);
console.log(`  адрес:     ${willFill("address")}`);
console.log(`  телефонів: ${willFill("phone")}`);
console.log(`  пошт:      ${willFill("email")}`);
console.log(`розбіжних адрес (не чіпаємо): ${conflicts.length}`);
console.log(`немає на сайті: ${unmatched}`);

if (conflicts.length > 0) {
  console.log(`\nПерші розбіжності:`);
  for (const c of conflicts.slice(0, 5)) {
    console.log(`  ${c.code} ${c.name}`);
    console.log(`    сайт: ${c.site}`);
    console.log(`    1С:   ${c.oneC}`);
  }
}

if (!apply) {
  console.log("\nПробний прогін. Щоб застосувати: --apply");
  await prisma.$disconnect();
  process.exit(0);
}

let done = 0;
for (const u of updates) {
  await prisma.counterparty.update({ where: { id: u.id }, data: u.data });
  done++;
  if (done % 200 === 0) console.log(`  оновлено ${done}/${updates.length}`);
}

console.log(`\nГотово. Оновлено записів: ${done}`);

const after = await prisma.counterparty.count({
  where: { externalId: { not: null }, address: { not: null } },
});
console.log(`контрагентів з адресою тепер: ${after}`);

await prisma.$disconnect();
