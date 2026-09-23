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

/* Незалежна перевірка дня тижня: систематичний зсув дат на добу не зловила
   б жодна з перевірок вище — кількість клієнтів з вираженим днем лишилась
   би такою ж, просто зсунутою. Джерело істини тут — власний EXTRACT(ISODOW)
   Postgres, а НЕ формула (getUTCDay()+6)%7 з модуля: порівнювати формулу
   саму із собою завжди дало б зелений результат.

   Вибірка — 5 найсвіжіших листів і 6 із часом рівно 00:00 (це найризикованіший
   випадок: зсув на -3 год перекинув би дату на попередній день). Для кожного
   беремо будь-якого клієнта листа й перевіряємо, що в weekdayByClient
   лічильник очікуваного дня (isodow − 1, бо в модуля 0 = понеділок) не нуль. */
type WeekdayCheckRow = { sheet_id: string; sheet_date: Date; expected_weekday: number; cp: string | null };

const since180 = new Date(Date.now() - 180 * 86_400_000);
const weekdaySample = await prisma.$queryRaw<WeekdayCheckRow[]>`
  WITH candidates AS (
    (
      SELECT rs.id, rs.date
      FROM "RouteSheet" rs
      WHERE rs.date >= ${since180}
        AND EXISTS (SELECT 1 FROM "RouteSheetStop" s WHERE s."routeSheetId" = rs.id AND s.hidden = false AND s."counterpartyId" IS NOT NULL)
      ORDER BY rs.date DESC
      LIMIT 5
    )
    UNION
    (
      SELECT rs.id, rs.date
      FROM "RouteSheet" rs
      WHERE rs.date >= ${since180}
        AND to_char(rs.date, 'HH24:MI') = '00:00'
        AND EXISTS (SELECT 1 FROM "RouteSheetStop" s WHERE s."routeSheetId" = rs.id AND s.hidden = false AND s."counterpartyId" IS NOT NULL)
      ORDER BY rs.date DESC
      LIMIT 6
    )
  )
  SELECT c.id AS sheet_id,
         c.date AS sheet_date,
         (EXTRACT(ISODOW FROM c.date)::int - 1) AS expected_weekday,
         (SELECT s."counterpartyId" FROM "RouteSheetStop" s
           WHERE s."routeSheetId" = c.id AND s.hidden = false AND s."counterpartyId" IS NOT NULL
           LIMIT 1) AS cp
  FROM candidates c
`;

check("вибірка для перевірки дня тижня непорожня", weekdaySample.length > 0, weekdaySample.length);

for (const row of weekdaySample) {
  const got = row.cp ? (habits.weekdayByClient.get(row.cp)?.[row.expected_weekday] ?? 0) : 0;
  check(
    `день тижня листа ${row.sheet_id} (${row.sheet_date.toISOString().slice(0, 16)}) — очікували isodow-1=${row.expected_weekday}`,
    got > 0,
    `лічильник дня ${row.expected_weekday} у клієнта ${row.cp} = ${got}`
  );
}

/*
 * Денна норма кілометрів.
 *
 * Поле зʼявилось 23.09.2026, коли виявилось, що distanceKm заповнений у 128
 * зі 139 листів (стара памʼять проєкту казала, що його не ведуть). Норми
 * водіїв різняться вдвічі — 277 км проти 206 — тому перевіряємо не конкретне
 * число, а що воно взагалі є і не абсурдне.
 */
let withKm = 0;
for (const [driverId, cap] of habits.capacity) {
  if (cap.medianKm === null) continue;
  withKm++;
  check(
    `норма км водія ${driverId} у 30..600`,
    cap.medianKm >= 30 && cap.medianKm <= 600 && (cap.p80Km ?? 0) >= cap.medianKm,
    `медіана ${cap.medianKm}, p80 ${cap.p80Km}`
  );
}
check("хоч в одного водія є норма км", withKm > 0, withKm);

await prisma.$disconnect();

if (fails.length) {
  console.error(`\nне зійшлося: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nпрофілі зійшлися");
