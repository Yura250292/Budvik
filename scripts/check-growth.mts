/**
 * Точки росту на синтетичних даних: хто недокуповує бренд і які потенційні
 * клієнти лежать по дорозі в торгових.
 *
 * Бази не треба: findBrandGaps і assignProspects — чисті функції. Правила
 * «схожості» ті самі, що в порадах торговому (clientOrder.ts): щонайменше 3
 * спільні бренди, бренд беруть щонайменше 3 схожі.
 *
 *   npx tsx scripts/check-growth.mts
 *
 * Бази не торкається.
 */

import { findBrandGaps, assignProspects, normalizeCategory, type ClientBrandRow, type ProspectPoint, type RepClientPoint } from "../src/lib/analytics/growth";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${typeof got === "string" ? got : JSON.stringify(got)?.slice(0, 300)}`);
  if (!ok) fails.push(name);
}

/* ── Хто недокуповує ─────────────────────────────────────────────────── */

const row = (clientId: string, brand: string, amount: number, repId = "r1"): ClientBrandRow => ({
  clientId,
  clientName: `Клієнт ${clientId}`,
  repId,
  brandKey: brand.toLowerCase(),
  brandName: brand,
  amount,
  active: true,
});

// Чотири схожі клієнти беруть A, B, C і D; «x» бере A, B, C, але не D.
// D у схожих — 10 % закупівель, у «x» оборот 30 000 → оцінка ≈ 3 000.
const rows: ClientBrandRow[] = [];
for (const p of ["p1", "p2", "p3", "p4"]) {
  rows.push(row(p, "A", 30_000), row(p, "B", 30_000), row(p, "C", 30_000), row(p, "D", 10_000));
}
rows.push(row("x", "A", 10_000, "r2"), row("x", "B", 10_000, "r2"), row("x", "C", 10_000, "r2"));
// «y» збігається лише двома брендами — не схожий ні на кого.
rows.push(row("y", "A", 5_000), row("y", "E", 5_000));
// «z» неактивний: у поради не йде, але як схожий для інших рахується.
rows.push({ ...row("z", "A", 1), active: false });

{
  const gaps = findBrandGaps(rows, { stockBrands: new Set(["a", "b", "c", "d"]) });
  const xd = gaps.find((g) => g.clientId === "x" && g.brandKey === "d");
  check("x недокуповує D", !!xd, gaps.map((g) => `${g.clientId}:${g.brandKey}`));
  check("схожих 4, беруть D усі 4", xd?.peers === 4 && xd?.buyers === 4, [xd?.peers, xd?.buyers]);
  check("частка гаманця схожих — 10 %", xd?.walletShare === 0.1, xd?.walletShare);
  check("оцінка = частка × оборот клієнта", xd?.estimate === 3000, xd?.estimate);
  check("торговий клієнта", xd?.repId === "r2", xd?.repId);
  check("у схожих клієнтів, що вже беруть усе, прогалин немає", !gaps.some((g) => g.clientId.startsWith("p")), gaps.filter((g) => g.clientId.startsWith("p")));
  check("клієнт з 2 спільними брендами — не схожий, порад немає", !gaps.some((g) => g.clientId === "y"), gaps.filter((g) => g.clientId === "y"));
  check("неактивному порад немає", !gaps.some((g) => g.clientId === "z"), "");
}
{
  // Бренду немає на складі — радити нема чого.
  const gaps = findBrandGaps(rows, { stockBrands: new Set(["a", "b", "c"]) });
  check("бренд без залишку не радимо", !gaps.some((g) => g.brandKey === "d"), gaps.map((g) => g.brandKey));
}
{
  // Лише 2 зі схожих беруть D — нижче порогу підтримки 3.
  const thin = rows.filter((r) => !(r.brandKey === "d" && (r.clientId === "p1" || r.clientId === "p2")));
  const gaps = findBrandGaps(thin, { stockBrands: new Set(["a", "b", "c", "d"]) });
  check("бренд бере менше 3 схожих — не порада", !gaps.some((g) => g.clientId === "x" && g.brandKey === "d"), gaps);
}

/* ── Потенційні клієнти по дорозі ───────────────────────────────────── */

// Стрий ≈ 49.26, 23.85. Два клієнти Кулика у Стрию (обидва замовляють у вівторок),
// один клієнт Передрія за 30 км. Точка з точністю «місто» в центрі Стрия.
const clients: RepClientPoint[] = [
  { clientId: "c1", name: "Стрий-1", repId: "kulyk", lat: 49.262, lng: 23.853, weekdayDocs: [0, 5, 0, 1, 0, 0, 0] },
  { clientId: "c2", name: "Стрий-2", repId: "kulyk", lat: 49.258, lng: 23.846, weekdayDocs: [0, 3, 0, 0, 0, 0, 0] },
  { clientId: "c3", name: "Далеко", repId: "peredrii", lat: 49.5, lng: 23.9, weekdayDocs: [4, 0, 0, 0, 0, 0, 0] },
];
const pr = (id: string, lat: number, lng: number, precision: string, category = "B", bigCity = false): ProspectPoint => ({
  id, name: `Точка ${id}`, lat, lng, precision, city: "Стрий", category, outletType: "Магазин", specialization: "Будматеріали", status: "NEW", bigCity,
});
{
  const res = assignProspects(
    [pr("s1", 49.26, 23.85, "CITY"), pr("s2", 49.2605, 23.8505, "ADDRESS", "A"), pr("far", 48.0, 22.0, "ADDRESS")],
    clients
  );
  const s1 = res.find((r) => r.id === "s1");
  check("точка в Стрию — Кулику", s1?.repId === "kulyk", s1?.repId);
  check("день — вівторок (індекс 1)", s1?.weekday === 1, s1?.weekday);
  check("найближчий клієнт і відстань", s1?.nearestClient === "Стрий-1" && (s1?.nearestKm ?? 99) < 1, [s1?.nearestClient, s1?.nearestKm]);
  check("клієнтів поруч", s1?.nearbyClients === 2, s1?.nearbyClients);
  const far = res.find((r) => r.id === "far");
  check("далека точка — поза маршрутами", far?.repId === null && far?.weekday === null, far);
}
{
  // Точність «адреса» — радіус менший: клієнт за 4 км не рахується поруч, «місто» — рахується.
  const c = [{ ...clients[0], lat: 49.296, lng: 23.853 }]; // ~3,8 км на північ
  const byAddress = assignProspects([pr("a", 49.262, 23.853, "ADDRESS")], c)[0];
  const byCity = assignProspects([pr("b", 49.262, 23.853, "CITY")], c)[0];
  check("адреса: 3,8 км — уже не поруч", byAddress.repId === null, byAddress);
  check("місто: 3,8 км — поруч", byCity.repId === "kulyk", byCity);
}

{
  // Обласний центр і пін «лише місто»: точка в центрі міста, відстань нічого не
  // означає — нікому не приписуємо, а просимо адресу.
  const [r] = assignProspects([pr("lviv", 49.262, 23.853, "CITY", "A", true)], clients);
  check("обласний центр без адреси — не приписуємо", r.repId === null && r.unplaced === "no_address", r);
  const [far] = assignProspects([pr("far2", 48.0, 22.0, "ADDRESS")], clients);
  check("далека — поза маршрутами", far.unplaced === "far", far.unplaced);
  const [ok] = assignProspects([pr("ok", 49.26, 23.85, "CITY")], clients);
  check("приписана — без позначки", ok.unplaced === null, ok.unplaced);
}
{
  // Пін, уточнений руками (MANUAL), — найточніший: у Львові його приписуємо,
  // і радіус у нього «адресний», а не «міський».
  const [lviv] = assignProspects([pr("man", 49.262, 23.853, "MANUAL", "A", true)], clients);
  check("ручний пін в обласному центрі — приписуємо", lviv.repId === "kulyk" && lviv.unplaced === null, lviv);
  const c = [{ ...clients[0], lat: 49.296, lng: 23.853 }]; // ~3,8 км
  const [far] = assignProspects([pr("man2", 49.262, 23.853, "MANUAL")], c);
  check("ручний пін — радіус адреси (3,8 км уже не поруч)", far.repId === null && far.unplaced === "far", far);
}
{
  // У базі категорії то латиницею, то кирилицею («B» і «В»).
  check("кирилична В → латинська B", normalizeCategory("В") === "B" && normalizeCategory(" а ") === "A" && normalizeCategory("С") === "C", [normalizeCategory("В"), normalizeCategory(" а "), normalizeCategory("С")]);
  check("порожня категорія — null", normalizeCategory("") === null && normalizeCategory(null) === null, normalizeCategory(""));
}

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
