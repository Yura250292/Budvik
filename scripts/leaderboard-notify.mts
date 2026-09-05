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

/**
 * Скільки з них узагалі дістануться телефона.
 *
 * Пуш іде лише на зареєстрований пристрій, а робоча збірка починає
 * реєструватися тільки з оновлення від 05.09.2026 — тож перші дні
 * розсилка може «спрацювати» вхолосту, і це має бути видно.
 */
const live = await prisma.pushToken.groupBy({
  by: ["userId"],
  where: { revokedAt: null, userId: { in: changes.map((c) => c.repId) } },
  _count: true,
});
console.log(`\nіз ${changes.length} у таблиці мають живий пристрій: ${live.length}`);

const pushes = changes.filter((c) => c.send).length;
console.log(`\nзмін ${pushes} із ${changes.length} у таблиці${send ? " — надіслано" : " (нічого не надіслано)"}`);

await prisma.$disconnect();
