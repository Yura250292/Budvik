/**
 * Кому піде нагадування про оновлення — БЕЗ відправки.
 *
 * Розсилка людям у полі не має бути сюрпризом навіть для того, хто її пише:
 * помилка в порівнянні версій означає сповіщення тим, у кого все актуальне,
 * а таке швидко привчає ігнорувати всі наші сповіщення разом.
 *
 * Показує рішення по КОЖНОМУ, зокрема й «не піде, бо…»: «нікому не пішло»
 * і «всі вже оновлені» — різні новини, і перша означає поламку.
 *
 *   npx tsx scripts/check-update-nudge.ts          # лише подивитись
 *   npx tsx scripts/check-update-nudge.ts --send   # справді надіслати
 */

import { prisma } from "../src/lib/prisma";
import { notifyOutdatedApps } from "../src/lib/app/update-nudge";
import { STAFF_APK_VERSION_NAME } from "../src/lib/app-builds";

async function main() {
  const send = process.argv.includes("--send");
  const results = await notifyOutdatedApps({ dry: !send, ignoreHours: true });

  console.log(`\nАктуальна збірка: ${STAFF_APK_VERSION_NAME}`);
  console.log(send ? "РЕЖИМ: справді шлемо\n" : "РЕЖИМ: лише перегляд (додайте --send)\n");

  for (const r of results) {
    const mark = r.sent ? "→ ПІШЛО " : r.why.startsWith("стара") ? "→ пішло б" : "  ·      ";
    console.log(`${mark} ${r.name.padEnd(20)} ${r.installed.padEnd(24)} ${r.why}`);
  }

  const would = results.filter((r) => r.why.startsWith("стара")).length;
  const blind = results.filter((r) => r.why === "немає адреси для сповіщень").length;
  console.log(`\nСповіщень: ${would}`);
  if (blind > 0) {
    console.log(
      `Не дістати сповіщенням: ${blind} — саме тому, що збірка стара (ключі\n` +
        `сповіщень з'явилися лише в 1.6.2). Ці планшети доведеться взяти в руки.`
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
