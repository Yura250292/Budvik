/**
 * Хто в кого краде товари: аудит суперечок класифікатора.
 *
 * Запуск (лише читання, нічого не пише):
 *   npx tsx scripts/audit-classify.mts                     — топ конфліктів
 *   npx tsx scripts/audit-classify.mts --pair ruchnyi:zakhyst
 *   npx tsx scripts/audit-classify.mts --section ruchnyi --sample 50
 *
 * Правила в src/lib/catalog/classify.ts читаються згори вниз, і перше збіжне
 * виграє. Це і є механізм розвʼязання суперечок, але він мовчазний: коли
 * широке правило ручного інструменту («ножиці», «ніж», «ключ») перехоплює
 * захисні окуляри чи садовий секатор, у базі лишається лише переможець.
 * Через це покупець, що обрав «Ручний інструмент», бачить у видачі маски.
 *
 * Тут прогоняються ВСІ правила (classifyAll), і показується, яке правило яке
 * затінило. З цього списку й народжуються нові правила-розвʼязання у
 * верхньому блоці RULES; після правки — прогін scripts/classify-catalog.mts.
 */

import { PrismaClient } from "@prisma/client";
import { classifyAll, SECTION_BY_ID } from "../src/lib/catalog/classify";

const prisma = new PrismaClient();

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const PAIR = arg("pair");
const SECTION = arg("section");
const SAMPLE = Number(arg("sample") ?? 0);

const sectionTitle = (id: string) => SECTION_BY_ID.get(id)?.title ?? id;

interface Conflict {
  /** Розділ, який товар отримав. */
  winner: string;
  /** Розділ, що програв суперечку. */
  shadowed: string;
  winnerType: string;
  shadowedType: string;
  count: number;
  inStock: number;
  examples: string[];
}

async function main() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { name: true, sku: true, stock: true, price: true },
  });

  const conflicts = new Map<string, Conflict>();
  /** Назви для режиму --section: подивитись очима, що взагалі лежить у розділі. */
  const sectionSample: string[] = [];
  let multi = 0;

  for (const p of products) {
    const hits = classifyAll(p.name);
    if (hits.length === 0) continue;

    const shoppable = p.stock > 0 && p.price > 0;
    const winner = hits[0];

    if (SECTION && winner.section === SECTION && shoppable) sectionSample.push(p.name);

    // Суперечка — це збіг правил із РІЗНИХ розділів. Кілька груп усередині
    // одного розділу конфліктом не є: там товар усе одно потрапляє куди слід.
    const others = hits.slice(1).filter((h) => h.section !== winner.section);
    if (others.length === 0) continue;
    multi++;

    const seen = new Set<string>();
    for (const loser of others) {
      // Той самий розділ міг збігтися кількома правилами — рахуємо його раз.
      if (seen.has(loser.section)) continue;
      seen.add(loser.section);

      if (PAIR) {
        const [a, b] = PAIR.split(":");
        const match =
          (winner.section === a && loser.section === b) ||
          (winner.section === b && loser.section === a);
        if (!match) continue;
      }

      const key = `${winner.section}>${loser.section}>${winner.type}>${loser.type}`;
      let c = conflicts.get(key);
      if (!c) {
        c = {
          winner: winner.section,
          shadowed: loser.section,
          winnerType: winner.type,
          shadowedType: loser.type,
          count: 0,
          inStock: 0,
          examples: [],
        };
        conflicts.set(key, c);
      }
      c.count++;
      if (shoppable) c.inStock++;
      // Приклади беремо з наявного: саме його бачить покупець у видачі.
      if (shoppable && c.examples.length < 5) c.examples.push(`${p.name}${p.sku ? ` [${p.sku}]` : ""}`);
    }
  }

  console.log(`активних товарів: ${products.length}`);
  console.log(`назв, де правила різних розділів сперечались: ${multi}`);
  if (PAIR) console.log(`фільтр пари: ${PAIR}`);

  const rows = [...conflicts.values()].sort((a, b) => b.inStock - a.inStock || b.count - a.count);
  if (rows.length === 0) {
    console.log("\nконфліктів не знайдено");
  } else {
    console.log(`\nконфлікти (${rows.length}), спершу ті, що видно покупцю:\n`);
    for (const c of rows.slice(0, 40)) {
      console.log(
        `${String(c.inStock).padStart(4)} в наявності / ${String(c.count).padStart(5)} усього  ` +
          `${sectionTitle(c.winner)} «${c.winnerType}»  ←  затінив  →  ${sectionTitle(c.shadowed)} «${c.shadowedType}»`
      );
      for (const e of c.examples) console.log(`        ${e}`);
    }
    if (rows.length > 40) console.log(`\n…і ще ${rows.length - 40} пар`);
  }

  if (SECTION && SAMPLE > 0) {
    console.log(`\nвипадкові назви в наявності з розділу «${sectionTitle(SECTION)}» (${sectionSample.length} усього):\n`);
    // Тасуємо, щоб не дивитись щоразу на той самий алфавітний початок.
    for (let i = sectionSample.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sectionSample[i], sectionSample[j]] = [sectionSample[j], sectionSample[i]];
    }
    for (const n of sectionSample.slice(0, SAMPLE)) console.log(`  ${n}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
