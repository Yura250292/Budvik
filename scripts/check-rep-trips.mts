/**
 * Поїздки торгових: розбір дня на синтетичних фактах + звірка з живою базою.
 *
 * Частина 1 бази не треба: tripDay — чиста арифметика над фактами дня.
 * Частина 2 (лише з DATABASE_URL) звіряє repTripDays з тими числами, які
 * вже показують shifts_report і аналітика торгових: сума днів мусить дати
 * рівно їхні підсумки, інакше помічник назве два різні пробіги за один місяць.
 *
 *   npx tsx scripts/check-rep-trips.mts                    # лише чиста частина
 *   npx tsx --env-file=.env scripts/check-rep-trips.mts db # + звірка з базою
 *
 * У базу нічого не пише.
 */

import { tripDay, type TripDayFacts } from "../src/lib/analytics/trip-facts";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${typeof got === "string" ? got : JSON.stringify(got)}`);
  if (!ok) fails.push(name);
}

const base: TripDayFacts = {
  userId: "u1",
  day: "2026-09-15",
  shifts: 1,
  odometerKm: 200,
  gpsKm: 190,
  personalKm: 12,
  suspicious: 0,
  autoClosed: 0,
  visitsDone: 10,
  visitsMissed: 1,
  collected: 3500,
  salesAmount: 60000,
  salesDocs: 8,
  salesClients: 7,
  margin: 12000,
  costedAmount: 60000,
};
const golf = { fuelConsumption: 6, fuelPricePerL: 91 };

// 1. Звичайний день.
{
  const d = tripDay(base, golf);
  // 200 × 6 / 100 × 91 = 1092
  check("пальне за одометром і нормою машини", Math.round(d.fuel ?? 0) === 1092, d.fuel);
  check("пальне від валу, %", d.fuelShareOfMarginPct === 9.1, d.fuelShareOfMarginPct);
  check("км на візит", d.kmPerVisit === 20, d.kmPerVisit);
  check("вал на кілометр", d.marginPerKm === 60, d.marginPerKm);
  check("одометр/GPS", d.odometerToGps === 1.05, d.odometerToGps);
  check("звичайний день без прапорців", d.flags.length === 0, d.flags);
}

// 2. Трек не записався: одометр є, GPS майже нуль.
{
  const d = tripDay({ ...base, gpsKm: 20 }, golf);
  check("кілометри без треку", d.flags.some((f) => f.includes("треку")), d.flags);
}

// 3. Трек довший за одометр.
{
  const d = tripDay({ ...base, gpsKm: 300 }, golf);
  check("трек довший за одометр", d.flags.some((f) => f.includes("довший")), d.flags);
}

// 4. Їздив, а візитів і продажів немає.
{
  const d = tripDay({ ...base, visitsDone: 0, visitsMissed: 0, salesAmount: 0, salesDocs: 0, salesClients: 0, margin: 0, costedAmount: 0 }, golf);
  check("без відміток візитів", d.flags.some((f) => f.includes("візит")), d.flags);
  check("без продажів", d.flags.some((f) => f.includes("продаж")), d.flags);
  check("км на візит без візитів — null", d.kmPerVisit === null, d.kmPerVisit);
  check("частка пального без валу — null", d.fuelShareOfMarginPct === null, d.fuelShareOfMarginPct);
}

// 4а. Людина відміток візитів не веде — прапорця «без візитів» немає, решта лишається.
{
  const d = tripDay({ ...base, visitsDone: 0, visitsMissed: 0, salesDocs: 0, salesAmount: 0, margin: 0, costedAmount: 0 }, golf, { marksVisits: false });
  check("без відміток у людини — прапорця візитів немає", !d.flags.some((f) => f.includes("візит")), d.flags);
  check("але «без продажу» лишається", d.flags.some((f) => f.includes("продаж")), d.flags);
}

// 5. Пальне з'їло велику частку валу.
{
  const d = tripDay({ ...base, margin: 2000 }, golf);
  check("пальне понад третину валу", d.flags.some((f) => f.includes("валу")), d.flags);
}

// 6. Одометра немає (зміну закрили без фото) — пальне не вигадуємо з GPS.
{
  const d = tripDay({ ...base, odometerKm: null }, golf);
  check("без одометра пального немає", d.fuel === null, d.fuel);
  check("без одометра прапорець", d.flags.some((f) => f.includes("одометра")), d.flags);
}

// 7. Машини не заведено — типова норма, і про це сказано.
{
  const d = tripDay(base, null);
  // 200 × 10 / 100 × 56 = 1120
  check("типова норма", Math.round(d.fuel!) === 1120 && d.defaultVehicle, [d.fuel, d.defaultVehicle]);
}

// 8. Підозрілий одометр і автозакриття — у прапорцях.
{
  const d = tripDay({ ...base, suspicious: 1, autoClosed: 1 }, golf);
  check("підозрілий одометр", d.flags.some((f) => f.includes("підозрілий")), d.flags);
  check("автозакриття", d.flags.some((f) => f.includes("автоматично")), d.flags);
}

/* ── Частина 2: звірка з базою ───────────────────────────────────────── */

if (process.argv[2] === "db") {
  const { repTripDays } = await import("../src/lib/analytics/trip-facts");
  const { shiftFactsByUser, revenueByRep } = await import("../src/lib/analytics/facts");
  const { kyivDayStart, kyivDayEnd } = await import("../src/lib/date/kyiv");
  const from = kyivDayStart("2026-09-01");
  const to = kyivDayEnd("2026-09-23");

  const days = await repTripDays(from, to);
  const shifts = await shiftFactsByUser(from, to);
  const revenue = await revenueByRep(from, to);
  check("є дні поїздок", days.length > 0, days.length);

  for (const s of shifts) {
    const mine = days.filter((d) => d.userId === s.userId);
    const odo = mine.reduce((a, d) => a + (d.odometerKm ?? 0), 0);
    check(`одометр по днях = shifts_report (${s.userId.slice(0, 6)})`, Math.abs(odo - s.workKm) < 0.5, [odo, s.workKm]);
  }
  // Документи продажу в днях поїздок — лише дні зі зміною, тож їх не більше,
  // ніж за весь місяць торгового. Саме документи, а не суми: повернення
  // від'ємні й можуть лягти на день без зміни, і тоді сума місяця виходить
  // меншою за суму днів поїздок цілком законно.
  for (const r of revenue) {
    const mine = days.filter((d) => d.userId === r.repId);
    if (!mine.length) continue;
    const docs = mine.reduce((a, d) => a + d.salesDocs, 0);
    check(`документи днів ≤ документів місяця (${r.repId.slice(0, 6)})`, docs <= r.docs, [docs, r.docs]);
  }
  // Коли всі документи торгового припали на дні зі зміною, сума днів мусить
  // дорівнювати revenueByRep до гривні — це перевіряє саму формулу продажів.
  const full = revenue.filter((r) => {
    const mine = days.filter((d) => d.userId === r.repId);
    return mine.length > 0 && mine.reduce((a, d) => a + d.salesDocs, 0) === r.docs;
  });
  for (const r of full) {
    const sales = days.filter((d) => d.userId === r.repId).reduce((a, d) => a + d.salesAmount, 0);
    check(`усі продажі в днях зміни — суми рівні (${r.repId.slice(0, 6)})`, Math.abs(sales - r.amount) < 1, [Math.round(sales), Math.round(r.amount)]);
  }
}

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
