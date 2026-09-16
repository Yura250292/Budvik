/**
 * primaryPhoneE164 для карток, де він порожній, — із поля телефону.
 *
 * Навіщо. Колонку додала міграція 20260916100000, і до першого прогону
 * каналу контактів вона порожня в усіх контрагентів. Розділ повідомлень
 * (src/lib/outreach) рахує номер на льоту з phone, але пошук за номером і
 * вибірки помічника (query-views.ts) читають саме колонку. Бекфіл робить
 * те саме, що зробить обмін, одним рухом — не чекаючи нічного прогону.
 *
 * Правило — те саме, що в обміні: primaryMobileE164, тобто перший
 * український мобільний у полі. Міський сюди не йде: Viber і SMS на нього
 * не дійдуть.
 *
 *   npx tsx --env-file=.env scripts/backfill-primary-phone.mts           # READ ONLY
 *   npx tsx --env-file=.env scripts/backfill-primary-phone.mts --apply   # пише
 *
 * Без --apply — лише SELECT і підрахунок. --apply пише тільки туди, де поле
 * ДОСІ порожнє (умова в самому UPDATE), тож номер, який тим часом поставив
 * обмін, не перезаписується. Сирий SQL — щоб не посунути Counterparty.updatedAt:
 * картку ніхто не редагував.
 */
import { prisma } from "../src/lib/prisma";
import { parsePhones, primaryMobileE164 } from "../src/lib/phone";

const APPLY = process.argv.includes("--apply");
const CHUNK = 200;
const SAMPLES = 15;

async function main() {
  const col = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_name = 'Counterparty' AND column_name = 'primaryPhoneE164'
  `;
  const hasColumn = Number(col[0]?.n ?? 0) > 0;

  if (!hasColumn) {
    console.log(
      "Колонки primaryPhoneE164 у цій базі ще немає (міграцію 20260916100000 не накочено) —\n" +
        "рахую так, ніби поле порожнє в усіх карток із телефоном."
    );
    if (APPLY) {
      console.error("--apply без міграції неможливий: писати нікуди.");
      process.exit(2);
    }
  }

  const select = { id: true, code: true, name: true, phone: true } as const;
  const rows = hasColumn
    ? await prisma.counterparty.findMany({ where: { primaryPhoneE164: null, phone: { not: null } }, select })
    : await prisma.counterparty.findMany({ where: { phone: { not: null } }, select });

  const toSet: { id: string; code: string | null; name: string; phone: string; e164: string }[] = [];
  let landlineOnly = 0;
  let nothing = 0;
  let blank = 0;

  for (const r of rows) {
    const phone = r.phone ?? "";
    if (!phone.trim()) {
      blank++;
      continue;
    }
    const e164 = primaryMobileE164(phone);
    if (e164) toSet.push({ id: r.id, code: r.code, name: r.name, phone, e164 });
    else if (parsePhones(phone).some((p) => p.e164)) landlineOnly++;
    else nothing++;
  }

  console.log(`\nКарток із телефоном і порожнім primaryPhoneE164: ${rows.length - blank}`);
  console.log(`  отримають мобільний:  ${toSet.length}`);
  console.log(`  лише міський (лишаться порожніми): ${landlineOnly}`);
  console.log(`  номер не розпізнано:  ${nothing}`);

  if (toSet.length) {
    console.log(`\nЗразки (${Math.min(SAMPLES, toSet.length)}):`);
    for (const s of toSet.slice(0, SAMPLES)) {
      console.log(`  ${s.code ?? "—"} | ${s.name} | ${JSON.stringify(s.phone)} → ${s.e164}`);
    }
  }

  if (!APPLY) {
    console.log("\nREAD ONLY: нічого не записано. Щоб застосувати — додайте --apply.");
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (let i = 0; i < toSet.length; i += CHUNK) {
    const chunk = toSet.slice(i, i + CHUNK);
    const res = await prisma.$transaction(
      chunk.map(
        (s) => prisma.$executeRaw`
          UPDATE "Counterparty" SET "primaryPhoneE164" = ${s.e164}
          WHERE "id" = ${s.id} AND "primaryPhoneE164" IS NULL
        `
      )
    );
    written += res.reduce((sum, n) => sum + n, 0);
  }
  console.log(`\nЗаписано: ${written} (решту тим часом заповнив обмін).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
