/**
 * Розблокування цін, які запобіжник тримав місяцями.
 *
 * Зміну ціни більш ніж у 5 разів синхронізація не застосовує (apply-prices.ts):
 * захист від одруківки в 1С. Але для товарів, чия ціна на сайті приїхала зі
 * старого імпорту, «правильна» ціна з 1С назавжди виглядає підозрілою — і 1С
 * щоночі просила виправити, а ми щоночі відмовляли.
 *
 * Тепер синхронізація приймає ціну, яку 1С повторила через добу (див.
 * PRICE_CONFIRM_HOURS). Цей скрипт — разова робота за минулий період: бере
 * ціни, які 1С уже називала, і застосовує їх, не чекаючи наступної ночі.
 *
 * Джерело ціни — журнал розбіжностей: те, що 1С реально прислала. Беремо лише
 * останнє значення по товару і лише якщо воно повторювалось (одноразове
 * відхилення могло бути тією самою одруківкою).
 *
 *   npx tsx --env-file=.env scripts/unblock-stuck-prices.mts           # звіт
 *   npx tsx --env-file=.env scripts/unblock-stuck-prices.mts --apply   # застосувати
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const MIN_REPEATS = 2;

const rows = await prisma.syncDiscrepancy.findMany({
  where: { field: "price_rejected" },
  orderBy: { createdAt: "desc" },
  select: { entityRef: true, entityName: true, value1C: true, valueBudvik: true, createdAt: true },
});

type Stuck = { ref: string; name: string; want: number; seen: number; first: Date; last: Date };
const byRef = new Map<string, Stuck>();
for (const r of rows) {
  const want = Number(r.value1C);
  if (!Number.isFinite(want) || want <= 0) continue;
  const cur = byRef.get(r.entityRef);
  if (!cur) {
    byRef.set(r.entityRef, { ref: r.entityRef, name: r.entityName, want, seen: 1, first: r.createdAt, last: r.createdAt });
    continue;
  }
  if (cur.want !== want) continue; // 1С передумала — беремо лише найсвіжішу ціну
  cur.seen++;
  cur.first = r.createdAt < cur.first ? r.createdAt : cur.first;
}

const plan: { id: string; ref: string; name: string; from: number; to: number; stock: number; seen: number; days: number }[] = [];
const skipped: string[] = [];
for (const s of byRef.values()) {
  const p = await prisma.product.findFirst({ where: { sku: s.ref }, select: { id: true, price: true, stock: true, name: true } });
  if (!p) { skipped.push(`${s.ref}: товару з таким кодом немає`); continue; }
  if (Math.abs(p.price - s.want) < 0.01) { skipped.push(`${s.ref}: ціна вже збігається`); continue; }
  if (s.seen < MIN_REPEATS) { skipped.push(`${s.ref}: 1С називала таку ціну лише раз — чекаємо повтору`); continue; }
  const days = Math.round((Date.now() - s.first.getTime()) / 86_400_000);
  plan.push({ id: p.id, ref: s.ref, name: p.name, from: p.price, to: s.want, stock: p.stock, seen: s.seen, days });
}

plan.sort((a, b) => b.stock - a.stock || Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
console.log(`Товарів із застряглою ціною: ${plan.length}${skipped.length ? `, пропущено ${skipped.length}` : ""}\n`);
console.log("код".padEnd(12) + "назва".padEnd(46) + "на сайті".padStart(11) + "→ з 1С".padStart(12) + "залишок".padStart(9) + "днів".padStart(6));
for (const p of plan) {
  console.log(
    p.ref.padEnd(12) + p.name.slice(0, 44).padEnd(46) +
    p.from.toFixed(2).padStart(11) + p.to.toFixed(2).padStart(12) +
    String(p.stock).padStart(9) + String(p.days).padStart(6)
  );
}
for (const s of skipped) console.log(`  · ${s}`);

const cheaper = plan.filter((p) => p.to > p.from);
const dearer = plan.filter((p) => p.to < p.from);
console.log(`\nПродавали дешевше за облік: ${cheaper.length} (найгірше — ${cheaper[0] ? `${cheaper[0].ref}: ${cheaper[0].from} замість ${cheaper[0].to}` : "—"})`);
console.log(`Ціна на сайті була завищена: ${dearer.length}`);

fs.mkdirSync("output", { recursive: true });
const path = `output/stuck-prices-${new Date().toISOString().slice(0, 10)}${APPLY ? "-applied" : "-dry"}.json`;
fs.writeFileSync(path, JSON.stringify(plan, null, 1));
console.log(`\nЗвіт (і бекап старих цін): ${path}`);

if (APPLY) {
  for (const p of plan) await prisma.product.update({ where: { id: p.id }, data: { price: p.to } });
  console.log(`Оновлено цін: ${plan.length}`);
} else if (plan.length) {
  console.log("Сухий прогін. Щоб застосувати: --apply");
}
await prisma.$disconnect();
