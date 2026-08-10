/**
 * Перепризначення кольорів брендам за валідованою палітрою.
 *
 * Наявні кольори були підібрані на око й не розрізняються: MAGTOOLS
 * (#480CA8) і ULTRA (#3A0CA3) мали ΔE 2.9 при потрібних 15 — два різні
 * бренди виглядали однаково навіть для людини з нормальним зором.
 *
 * Кольори роздаються за оборотом: найбільші бренди отримують перші слоти
 * палітри, які найкраще розрізняються між собою. Дрібні бренди — сірий:
 * на графіку вони й так у хвості, а витрачати на них слот означало б
 * зробити кольори важливих брендів менш помітними.
 *
 * Запуск: npx tsx scripts/assign-brand-colors.ts [--dry]
 */

import { PrismaClient } from "@prisma/client";
import { CATEGORICAL, NEUTRAL } from "../src/lib/analytics/colors";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

/**
 * Скільки брендів отримують власний колір. Палітра має 8 хюїв; далі
 * кольори довелося б повторювати, а два бренди одного кольору гірші за
 * бренд без кольору.
 */
const COLORED_SLOTS = CATEGORICAL.length;

async function main() {
  // Оборот за рік — щоб сезонний сплеск одного місяця не вирішував,
  // який бренд «головний».
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const revenue = await prisma.$queryRaw<Array<{ brandId: string; amount: number }>>`
    SELECT p."brandId" AS "brandId", SUM(i.quantity * i."sellingPrice")::float AS amount
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    JOIN "Product" p ON p.id = i."productId"
    WHERE s."externalId" IS NOT NULL
      AND s.status = 'CONFIRMED'
      AND s."createdAt" >= ${yearAgo}
      AND p."brandId" IS NOT NULL
    GROUP BY p."brandId"
    ORDER BY amount DESC
  `;

  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    select: { id: true, name: true, color: true, priority: true },
  });

  const amountById = new Map(revenue.map((r) => [r.brandId, r.amount]));

  // Бренди без продажів ідуть у кінець за алфавітом — порядок стабільний
  // між запусками, тож повторний прогін не перетасує кольори.
  const ordered = [...brands].sort((a, b) => {
    const diff = (amountById.get(b.id) ?? 0) - (amountById.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, "uk");
  });

  let changed = 0;
  const plan: Array<{ name: string; from: string | null; to: string; amount: number }> = [];

  for (const [index, brand] of ordered.entries()) {
    const color = index < COLORED_SLOTS ? CATEGORICAL[index] : NEUTRAL;
    // priority керує порядком у списках — вирівнюємо з оборотом, щоб
    // кольорові бренди були і вгорі списків.
    const priority = index < COLORED_SLOTS ? COLORED_SLOTS - index : 0;

    if (brand.color === color) continue;

    plan.push({ name: brand.name, from: brand.color, to: color, amount: amountById.get(brand.id) ?? 0 });
    changed++;

    if (!DRY) {
      await prisma.brand.update({ where: { id: brand.id }, data: { color, priority } });
    }
  }

  console.log(`Брендів активних: ${brands.length}, із продажами за рік: ${revenue.length}`);
  console.log(`${DRY ? "БУЛО Б змінено" : "Змінено"}: ${changed}\n`);
  console.log("Топ-10 за оборотом:");
  for (const row of plan.slice(0, 10)) {
    const amount = Math.round(row.amount).toLocaleString("uk-UA");
    console.log(`  ${row.to}  ${row.name.padEnd(18)} (було ${row.from ?? "—"})  ${amount} грн`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
