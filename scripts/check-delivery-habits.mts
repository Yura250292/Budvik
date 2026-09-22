/**
 * Профілі доставки на справжній історії листів.
 *
 * Навіщо. Увесь розподіл точок між водіями спирається на пʼять лічильників
 * з історії. Якщо вони порахуються криво — план виглядатиме розумним і буде
 * неправильним, а помітить це тільки водій, що поїхав не туди. Тому числа
 * звіряються з тим, що було виміряно на етапі дизайну 22.09.2026.
 *
 *   npx tsx --env-file=.env scripts/check-delivery-habits.mts
 *
 * Лише читання бази.
 */

import { deliveryHabits } from "../src/lib/routes/delivery-habits";
import { PAIR_MIN } from "../src/lib/routes/plan-day";
import { prisma } from "../src/lib/prisma";

const fails: string[] = [];

function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

const habits = await deliveryHabits(180);

// 380 клієнтів мали доставки за виміром 22.09.2026; історія росте, тож нижня межа.
check("клієнтів з доставками", habits.deliveriesByClient.size >= 300, habits.deliveriesByClient.size);

// Частка «свого» водія: 0.64 на 22.09.2026. Ширші межі — щоб скрипт не падав
// від природного дрейфу, але ловив зламаний підрахунок.
let withThree = 0;
let shareSum = 0;
for (const [cp, list] of habits.driverByClient) {
  const total = list.reduce((s, h) => s + h.count, 0);
  if (total < 3) continue;
  withThree++;
  shareSum += list[0].count / total;
  void cp;
}
const share = withThree ? shareSum / withThree : 0;
check("частка «свого» водія 0.5..0.8", share >= 0.5 && share <= 0.8, share.toFixed(3));

// 819 пар ≥5 разів на 22.09.2026.
let strongPairs = 0;
for (const n of habits.pairs.values()) if (n >= PAIR_MIN) strongPairs++;
check("стійких пар ≥ 500", strongPairs >= 500, strongPairs);

// Медіана 15–16 точок на лист; межа дня не може бути абсурдною.
for (const [driverId, cap] of habits.capacity) {
  check(
    `межа дня водія ${driverId} у 5..45`,
    cap.maxStops >= 5 && cap.maxStops <= 45,
    `${cap.maxStops} (медіана ${cap.medianStops}, днів ${cap.days})`
  );
}

// Дні тижня: хоч у когось має бути виражений день.
let withWeekday = 0;
for (const w of habits.weekdayByClient.values()) {
  if (w.some((n) => n >= 2)) withWeekday++;
}
check("клієнтів з повторюваним днем ≥ 50", withWeekday >= 50, withWeekday);

await prisma.$disconnect();

if (fails.length) {
  console.error(`\nне зійшлося: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nпрофілі зійшлися");
