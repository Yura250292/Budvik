/**
 * Злиття брендів-дублів, що розійшлися через Unicode-форми.
 *
 * Звідки дублі: назви з 1С приходять із «ö» у двох формах — складеній (U+00F6)
 * і розкладеній (o + U+0308). Для Postgres і для @unique це різні рядки, тож
 * у довіднику з'явилось два «Grösser» (slug grosser і gro-sser), а товари
 * розійшлись між ними; аналітика по бренду й лендинг бренду бачили половину.
 *
 * Що робить: групує бренди за name.trim().normalize("NFC").toLowerCase();
 * у кожній групі лишає бренд з найбільшою кількістю товарів (при рівності —
 * з NFC-назвою), переносить на нього товари, плани, правила мотивації й
 * розподіли оплат, об'єднує matchPatterns, нормалізує назви товарів у NFC
 * (щоб пошук по «Grösser» знаходив усе) і видаляє дубль.
 *
 * Плани з @@unique([period, metric, periodStart, repId, brandId]) при
 * перенесенні можуть зіткнутися з планами вцілілого бренду — такі лишаємо
 * і повідомляємо, руками вирішити, який план правильний.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/merge-brand-duplicates.mts          # звіт
 *   npx tsx --env-file=.env scripts/merge-brand-duplicates.mts --apply  # злити
 * Бекап переприв'язаних товарів — output/brand-merge-backup-<дата>.json.
 */
import fs from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const brands = await prisma.brand.findMany({
  select: { id: true, name: true, slug: true, matchPatterns: true, _count: { select: { products: true, plans: true, rules: true } } },
});
const groups = new Map<string, typeof brands>();
for (const b of brands) {
  const k = b.name.trim().normalize("NFC").toLowerCase();
  groups.set(k, [...(groups.get(k) ?? []), b]);
}
const dupGroups = [...groups.values()].filter((g) => g.length > 1);
console.log(`Брендів: ${brands.length}, груп-дублів: ${dupGroups.length}`);

const nfdProducts = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "Product" WHERE name <> normalize(name, NFC)`;
console.log(`Товарів з назвою не в NFC: ${nfdProducts[0].n}`);

const backup: { productId: string; oldBrandId: string; newBrandId: string }[] = [];

for (const g of dupGroups) {
  const sorted = [...g].sort((a, b) => b._count.products - a._count.products || (a.name === a.name.normalize("NFC") ? -1 : 1));
  const keep = sorted[0];
  const losers = sorted.slice(1);
  console.log(`\n«${keep.name.normalize("NFC")}»: лишаємо ${keep.slug} (${keep._count.products} товарів) ← ${losers.map((l) => `${l.slug} (${l._count.products} товарів, ${l._count.plans} планів, ${l._count.rules} правил)`).join(", ")}`);

  for (const loser of losers) {
    const products = await prisma.product.findMany({ where: { brandId: loser.id }, select: { id: true } });
    backup.push(...products.map((p) => ({ productId: p.id, oldBrandId: loser.id, newBrandId: keep.id })));

    const keepPlans = await prisma.salesPlan.findMany({ where: { brandId: keep.id }, select: { period: true, metric: true, periodStart: true, repId: true } });
    const loserPlans = await prisma.salesPlan.findMany({ where: { brandId: loser.id }, select: { id: true, period: true, metric: true, periodStart: true, repId: true } });
    const clash = loserPlans.filter((lp) => keepPlans.some((kp) => kp.period === lp.period && kp.metric === lp.metric && kp.periodStart.getTime() === lp.periodStart.getTime() && kp.repId === lp.repId));
    if (clash.length) console.log(`  ⚠ ${clash.length} планів дубля збігаються з планами вцілілого — лишаю на дублі, бренд не видаляю`);

    const patterns = [...new Set([...keep.matchPatterns, ...loser.matchPatterns].map((p) => p.normalize("NFC").toLowerCase().trim()))];
    console.log(`  товарів переносимо: ${products.length}; matchPatterns → ${JSON.stringify(patterns)}`);

    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      await tx.product.updateMany({ where: { brandId: loser.id }, data: { brandId: keep.id } });
      await tx.salesPlan.updateMany({ where: { brandId: loser.id, id: { notIn: clash.map((c) => c.id) } }, data: { brandId: keep.id } });
      await tx.motivationRule.updateMany({ where: { brandId: loser.id }, data: { brandId: keep.id } });
      await tx.paymentAllocation.updateMany({ where: { brandId: loser.id }, data: { brandId: keep.id } });
      await tx.brand.update({ where: { id: keep.id }, data: { name: keep.name.normalize("NFC"), matchPatterns: patterns } });
      if (!clash.length) await tx.brand.delete({ where: { id: loser.id } });
    });
    console.log(`  ✓ перенесено${clash.length ? "" : ", дубль видалено"}`);
  }
}

if (APPLY) {
  fs.mkdirSync("output", { recursive: true });
  const path = `output/brand-merge-backup-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(path, JSON.stringify(backup, null, 1));
  const fixed = await prisma.$executeRaw(Prisma.sql`UPDATE "Product" SET name = normalize(name, NFC) WHERE name <> normalize(name, NFC)`);
  console.log(`\nНазв товарів приведено до NFC: ${fixed}. Бекап привʼязок: ${path}`);
} else if (dupGroups.length) {
  console.log("\nСухий прогін. Щоб застосувати: --apply");
}
await prisma.$disconnect();
