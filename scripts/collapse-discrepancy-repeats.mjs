/**
 * Згортає накопичені повтори в журналі розбіжностей.
 *
 * Навіщо: розбіжність-СТАН («не розпізнано торгового», «водій не зіставлений»,
 * «помічено на видалення») тримається місяцями, а обмін ходить щоп'ять хвилин
 * і перечитує документи у вікні перевірки. До виправлення кожен прогін
 * дописував той самий запис заново: 522 копії на водія, 48 на документ,
 * 67 тисяч рядків самих лише позначок на видалення. Вкладка «Розбіжності»
 * стала нечитабельною, а таблиця виросла до 66 МБ.
 *
 * Постійне правило живе у flushDiscrepancies (src/lib/sync-ingest/context.ts) —
 * цей скрипт лише розгрібає накопичене до нього.
 *
 * Що робить: лишає ВІДКРИТИМ найсвіжіший запис на кожен унікальний стан —
 * тип, ref, поле й обидва значення, тобто рівно той ключ, за яким відсіює
 * flushDiscrepancies. Решту позначає розв'язаними. Нічого не видаляє: рядки
 * лишаються в історії, і будь-яку групу можна повернути, знявши resolved.
 *
 * Чому найсвіжіший лишається відкритим: саме на відкритому записі тримається
 * захист від повторного запису. Згорнути геть усе означало б, що наступний
 * прогін почне накопичувати ті самі повтори спочатку.
 *
 * Запуск (спершу без --apply — покаже, що саме зміниться):
 *   node --env-file=.env scripts/collapse-deleted-in-1c-duplicates.mjs
 *   node --env-file=.env scripts/collapse-deleted-in-1c-duplicates.mjs --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const rows = await prisma.$queryRaw`
  SELECT "entityType", field, count(*)::int AS total,
         count(DISTINCT "entityRef")::int AS refs
  FROM "SyncDiscrepancy" WHERE resolved = false
  GROUP BY 1, 2 HAVING count(*) > count(DISTINCT "entityRef") * 3
  ORDER BY 3 DESC
`;

console.log("Стани, що накопичили повтори:");
for (const r of rows) {
  console.log(
    `  ${r.entityType}/${r.field}: ${r.total} записів на ${r.refs} об'єктів ` +
      `(${(r.total / r.refs).toFixed(0)}× повторів)`
  );
}

// Найсвіжіший відкритий запис кожної групи лишається — решта згортається.
// Ключ той самий, що і в коді відсіву: тип + ref + поле + обидва значення.
const keep = await prisma.$queryRaw`
  SELECT DISTINCT ON ("entityType", "entityRef", field, "value1C", "valueBudvik") id
  FROM "SyncDiscrepancy" WHERE resolved = false
  ORDER BY "entityType", "entityRef", field, "value1C", "valueBudvik", "createdAt" DESC
`;
const keepIds = keep.map((r) => r.id);

const [{ n: toCollapse }] = await prisma.$queryRaw`
  SELECT count(*)::int AS n FROM "SyncDiscrepancy"
  WHERE resolved = false AND id <> ALL(${keepIds}::text[])
`;

console.log(`\nЗалишиться відкритими: ${keepIds.length}`);
console.log(`Буде позначено розв'язаними: ${toCollapse}`);

if (!apply) {
  console.log("\nПробний прогін. Щоб застосувати: --apply");
  await prisma.$disconnect();
  process.exit(0);
}

// Пачками: один UPDATE на десятки тисяч рядків тримав би блокування надовго, а
// таблицю паралельно пише кожен прогін обміну.
let done = 0;
for (;;) {
  const affected = await prisma.$executeRaw`
    UPDATE "SyncDiscrepancy" SET resolved = true
    WHERE id IN (
      SELECT id FROM "SyncDiscrepancy"
      WHERE resolved = false AND id <> ALL(${keepIds}::text[])
      LIMIT 5000
    )
  `;
  if (affected === 0) break;
  done += affected;
  console.log(`  згорнуто ${done}/${toCollapse}`);
}

const after = await prisma.syncDiscrepancy.count({ where: { resolved: false } });
console.log(`\nГотово. Відкритих залишилось: ${after}`);

await prisma.$disconnect();
