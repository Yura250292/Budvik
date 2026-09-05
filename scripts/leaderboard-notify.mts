/**
 * Хто піднявся, хто опустився — і кому через це піде пуш.
 *
 *   npx tsx --env-file=.env scripts/leaderboard-notify.mts          # лише показати
 *   npx tsx --env-file=.env scripts/leaderboard-notify.mts --send   # і надіслати
 *
 * Без --send знімок місць лишається недоторканим, тож прогін можна
 * повторювати скільки завгодно: він нічого не змінює й нікого не будить.
 */

import { prisma } from "../src/lib/prisma";
import { notifyStandingChanges } from "../src/lib/leaderboard/standings";

const send = process.argv.includes("--send");

const changes = await notifyStandingChanges({ dry: !send });

for (const c of changes) {
  const place = c.prevPlace == null ? `${c.place}` : `${c.prevPlace} → ${c.place}`;
  console.log(
    `${c.send ? "ПУШ " : "    "} ${place.padEnd(8)} ${(c.name ?? "—").padEnd(24)} ${Math.round(c.revenue).toLocaleString("uk-UA").padStart(10)} ₴  ${c.why}`
  );
  if (c.send) console.log(`         ${c.title}\n         ${c.body}`);
}

const pushes = changes.filter((c) => c.send).length;
console.log(`\nзмін ${pushes} із ${changes.length} у таблиці${send ? " — надіслано" : " (нічого не надіслано)"}`);

await prisma.$disconnect();
