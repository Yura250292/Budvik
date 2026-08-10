/**
 * Заведення торгових із 1С як користувачів сайту.
 *
 * Навіщо: синхронізація прив'язує замовлення до торгового, зіставляючи
 * «Ответственный» із 1С із користувачами сайту. Кого немає — той лишається
 * без прив'язки, і його продажі випадають зі звітів. Після першого бойового
 * прогону таких виявилось семеро.
 *
 * Створені користувачі НЕ МОЖУТЬ увійти: пароль не задається. Це навмисно —
 * запис існує лише щоб було до чого прив'язати продажі. Дати доступ можна
 * пізніше, встановивши пароль в адмінці.
 *
 * Email генерується технічний (rep-<slug>@budvik.local), бо поле обов'язкове
 * й унікальне, а справжніх адрес ми не знаємо. Домен .local гарантує, що на
 * ці адреси нічого не піде.
 *
 * Запуск:
 *   npx tsx scripts/seed-sales-reps.ts            — показати, що зробив би
 *   npx tsx scripts/seed-sales-reps.ts --apply    — створити
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Імена рівно як у 1С — саме за ними йде зіставлення.
 *
 * «Склад» до списку не входить: у 1С це технічний запис, а не людина, і
 * заводити його як торгового означало б домішати складські операції до
 * чиїхось продажів.
 */
const REPS = [
  "Кавецький Віктор",
  "Калашник Дарья",
  "Кулик Дмитро",
  "Паршина Анна",
  "Передрій Дмитро",
  "Струк Ольга Іванівна",
  "Щомак Марьяна",
];

function toEmailSlug(name: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
    з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
    о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ъ: "",
  };
  return name
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const apply = process.argv.includes("--apply");

  const existing = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
  });

  // Те саме послівне зіставлення, що й у синхронізації: користувач уже є,
  // якщо всі слова його імені входять в ім'я з 1С. Інакше створили б
  // «Пац Валентин» поруч із наявним «Валентин» і роздвоїли б його продажі.
  const wordsOf = (n: string) =>
    new Set(
      n.toLowerCase().split(/[\s.]+/).map((w) => w.trim()).filter((w) => w.length >= 3)
    );

  const toCreate: Array<{ name: string; email: string }> = [];
  const alreadyThere: string[] = [];

  for (const repName of REPS) {
    const target = wordsOf(repName);
    const matches = existing.filter((u) => {
      if (!u.name?.trim()) return false;
      const uw = wordsOf(u.name);
      return uw.size > 0 && [...uw].every((w) => target.has(w));
    });

    if (matches.length > 0) {
      alreadyThere.push(`${repName} → вже є як «${matches.map((m) => m.name).join(", ")}»`);
      continue;
    }

    toCreate.push({
      name: repName,
      email: `rep-${toEmailSlug(repName)}@budvik.local`,
    });
  }

  console.log("── Торгові з 1С ──");
  for (const a of alreadyThere) console.log(`  ${a}`);
  console.log("");
  console.log(`Буде створено: ${toCreate.length}`);
  for (const u of toCreate) {
    console.log(`  ${u.name.padEnd(24)} ${u.email}`);
  }
  console.log("");

  if (!apply) {
    console.log("Це був перегляд. Щоб створити, додайте --apply");
    return;
  }

  for (const u of toCreate) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, name: u.name, role: "SALES" },
      update: { name: u.name, role: "SALES" },
    });
    console.log(`  створено: ${u.name}`);
  }
  console.log("\nГотово. Наступний цикл синхронізації припише їхні продажі.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
