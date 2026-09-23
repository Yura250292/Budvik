/**
 * Перерахувати сезонні профілі руками.
 *
 * Воркер робить це раз на місяць сам. Руками потрібно у двох випадках, і
 * обидва — не «про всяк випадок»:
 *
 *   1. ПІСЛЯ БЕКФІЛУ історії з 1С. Доти профілів немає взагалі, і вся
 *      механіка мовчить.
 *   2. ПІСЛЯ ПРОГОНУ КЛАСИФІКАТОРА каталогу. `typeKey` рахується з назв
 *      товарів, тож нове правило класифікації мовчки переписує історію
 *      групування: та сама бензопила вчора була в одній групі, сьогодні
 *      в іншій, а профіль лишився старий.
 *
 *   npx tsx --env-file=.env scripts/recompute-season.mts
 *
 * Пише лише у власну таблицю SeasonProfile. У базу 1С — нічого.
 */

import { prisma } from "@/lib/prisma";
import { completeYears, recomputeProfiles } from "@/lib/analytics/seasonality";

async function main() {
  const { years, note } = await completeYears();
  console.log(`Повні роки: ${years.length ? years.join(", ") : "жодного"} (${note})`);

  if (years.length === 0) {
    console.log("\nРахувати нема на чому: потрібен щонайменше один ПОВНИЙ рік реалізацій.");
    console.log("Після бекфілу 2024–2025 запустіть цей скрипт ще раз.");
    return;
  }

  const t0 = Date.now();
  const res = await recomputeProfiles();
  console.log(`\nЗаписано профілів: ${res.written} за ${Math.round((Date.now() - t0) / 100) / 10} с`);

  const byLevel = await prisma.seasonProfile.groupBy({ by: ["level", "confidence"], _count: { id: true } });
  console.log("\nРівень        довіра   шт.");
  for (const r of byLevel.sort((a, b) => a.level.localeCompare(b.level))) {
    console.log(`${r.level.padEnd(12)}  ${r.confidence.padEnd(7)}  ${r._count.id}`);
  }

  const high = byLevel.filter((r) => r.confidence === "HIGH").reduce((s, r) => s + r._count.id, 0);
  console.log(`\nВисокої довіри: ${high} — саме вони можуть рухати закупівлю.`);
  console.log("Далі: scripts/check-season-profile.mts (очима) і scripts/check-season-backtest.mts (гейт).");
}

main().finally(() => prisma.$disconnect());
