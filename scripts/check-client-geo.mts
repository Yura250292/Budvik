/**
 * Точки клієнтів для помічника: де Львівщина, а де лише доставка, яким
 * точкам вірити і що каже перевірка адреси.
 *
 * 24.09.2026 на проді: 3 089 точок, з них 1 561 поза областю (здебільшого
 * відділення Нової пошти), 849 клієнтів злиплися купками по 3+ різні
 * адреси на одній точці, клієнти ринку «Торпедо» у Львові стояли під
 * Запоріжжям. Помічник цього не бачив: для нього всі точки були однаково
 * точними.
 *
 *   npx tsx scripts/check-client-geo.mts          — чисті правила, без бази
 *   npx tsx scripts/check-client-geo.mts --db     — ще й вид client_geo і
 *     збіг кордону/регулярок у Postgres із JS (DATABASE_URL, лише SELECT)
 *
 * Нічого не пише.
 */

import { inLvivOblast, LVIV_OBLAST_SQL } from "../src/lib/geo/lviv-oblast";
import { precisionOf, addressLookupQueries } from "../src/lib/geo/nominatim";
import { PLACE_LVIV_RE, PLACE_OTHER_RE, NP_BRANCH_RE, placeTest, pinVerdict } from "../src/lib/assistant/facts/client-geo";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${typeof got === "string" ? got : JSON.stringify(got)?.slice(0, 300)}`);
  if (!ok) fails.push(name);
}

/* ── Кордон області ──────────────────────────────────────────────────── */

const PLACES: Array<[string, number, number, boolean]> = [
  ["Львів", 49.8397, 24.0297, true],
  ["Стрий", 49.2622, 23.8561, true],
  ["Шептицький (Червоноград)", 50.386, 24.2289, true],
  ["Самбір", 49.5183, 23.2011, true],
  ["Броди", 50.0815, 25.1508, true],
  ["Турка", 49.1542, 23.0297, true],
  ["Сколе", 49.0371, 23.513, true],
  ["Рава-Руська", 50.2335, 23.6206, true],
  ["Сокаль", 50.4812, 24.2774, true],
  ["Тернопіль", 49.5535, 25.5948, false],
  ["Івано-Франківськ", 48.9226, 24.7111, false],
  ["Калуш (у прямокутнику області)", 49.0119, 24.3731, false],
  ["Воловець (у прямокутнику області)", 48.7115, 23.186, false],
  ["Луцьк", 50.7472, 25.3254, false],
  ["Київ", 50.45, 30.52, false],
  ["Запоріжжя (куди потрапив «Торпедо»)", 47.8015, 35.1936, false],
];
for (const [name, lat, lng, want] of PLACES) {
  check(`${name}: ${want ? "Львівщина" : "поза областю"}`, inLvivOblast(lat, lng) === want, inLvivOblast(lat, lng));
}

/* ── Що каже текст адреси ────────────────────────────────────────────── */

const TEXTS: Array<[string, string, boolean]> = [
  ["lviv", "м.Львів, вул.Городоцька,буд.225", true],
  ["lviv", "м..Львів, ринок Південний,ТЦ Експо Буд,маг.22", true],
  ["lviv", "80100, Львівська обл., м.Червоноград, вул.Івасюка", true],
  ["lviv", "НОВА ПОШТА №76 Київ,вул. Львівська 15 Б", false],
  ["lviv", "м. Стрий, Базар, вул.Зелена 25", false],
  ["other", "НОВА ПОШТА №15,Тернопіль ,бульв. С.Петлюри ,4а", true],
  ["other", "НОВА ПОШТА м.Київ,(Київька обл) вул.Еренбурга", true],
  ["other", "НОВА ПОШТА Біла Церква,Поштомат 5212", true],
  ["other", "Запоріжжя, відділення Нової Пошти № 34", true],
  ["other", "НОВА ПОШТА ,С. Станківці ( Івано-Франківська обл) Пункт", true],
  ["other", "Івано-Франківськ, вул. Незалежності 5", true],
  ["other", "м.Львів, вул. Київська 5", false],
  ["other", "м. Стрий, вул. Тернопільська 3", false],
  ["other", "Львів, магазин Дніпро-М, вул. Городоцька", false],
  ["other", "м.Самбір, вул.Шевченка 1", false],
  // Миколаїв є і на Львівщині (Стрийський район) — клієнти «м.Миколаїв, р-нок» наші.
  ["other", "м.Миколаїв, вул.Воз'єднання 11 маг.Бригадир", false],
  ["other", "НОВА ПОШТА №1, Миколаївська обл., м.Первомайськ", true],
  ["np", "НОВА ПОШТА №  2,с.Солочин", true],
  ["np", "Нова Пошта відділення 4", true],
  ["np", "НОВА ПОШТА Біла Церква,Поштомат 5212", true],
  ["np", "м.Львів, вул.Городоцька,225", false],
];
const RE = { lviv: PLACE_LVIV_RE, other: PLACE_OTHER_RE, np: NP_BRANCH_RE } as const;
for (const [kind, text, want] of TEXTS) {
  const got = placeTest(RE[kind as keyof typeof RE], text);
  check(`${kind}: «${text}» → ${want}`, got === want, got);
}

/* ── Точність знахідки геокодера ─────────────────────────────────────── */

check("будинок — адреса", precisionOf("house") === "ADDRESS", precisionOf("house"));
check("магазин — адреса", precisionOf("shop") === "ADDRESS", precisionOf("shop"));
check("вулиця — вулиця", precisionOf("road") === "STREET", precisionOf("road"));
check("місто — населений пункт", precisionOf("city") === "CITY", precisionOf("city"));
check("село — населений пункт", precisionOf("village") === "CITY", precisionOf("village"));
check("невідоме — вулиця (посередині)", precisionOf("whatever") === "STREET", precisionOf("whatever"));

{
  const q = addressLookupQueries("НОВА ПОШТА №15,Тернопіль ,бульв. С.Петлюри ,4а");
  check("запити: префікс Нової пошти прибрано", q.length > 0 && !/пошт/i.test(q[0]), q);
  check("запити: місто лишилось", q.every((x) => /Тернопіль/.test(x)), q);
  check("запити: без повторів", new Set(q).size === q.length, q);
  check("порожня адреса — жодного запиту", addressLookupQueries("  ").length === 0, addressLookupQueries("  "));
}

/* ── Висновок перевірки ──────────────────────────────────────────────── */

const TORPEDO = { lat: 49.8652, lng: 24.0569 };
const ZAPORIZHZHIA = { lat: 47.8015, lng: 35.1936 };
const near = (p: { lat: number; lng: number }, dLatKm: number) => ({ lat: p.lat + dLatKm / 111.2, lng: p.lng });

{
  const v = pinVerdict({ hasAddress: true, pinSource: "GEOCODED", pin: ZAPORIZHZHIA, found: { ...TORPEDO, precision: "ADDRESS" } });
  check("геокодер під Запоріжжям, адреса у Львові — пересунути", v.code === "MOVE" && (v.km ?? 0) > 700, v);
}
{
  const v = pinVerdict({ hasAddress: true, pinSource: "GEOCODED", pin: near(TORPEDO, 0.1), found: { ...TORPEDO, precision: "ADDRESS" } });
  check("100 м від адреси — точка правильна", v.code === "OK", v);
}
{
  const v = pinVerdict({ hasAddress: true, pinSource: "GEOCODED", pin: near(TORPEDO, 0.8), found: { ...TORPEDO, precision: "ADDRESS" } });
  check("800 м від адреси — поруч, глянути", v.code === "NEAR", v);
}
{
  const v = pinVerdict({ hasAddress: true, pinSource: "MANUAL", pin: near(TORPEDO, 3), found: { ...TORPEDO, precision: "ADDRESS" } });
  check("людина поставила за 3 км від адреси — вірити людині", v.code === "HUMAN_DIFFERS", v);
}
{
  const v = pinVerdict({ hasAddress: true, pinSource: "GEOCODED", pin: near(TORPEDO, 2), found: { ...TORPEDO, precision: "CITY" } });
  check("адреса знайшлась лише до міста, точка в ньому — точніше не скажеш", v.code === "CITY_ONLY", v);
}
{
  const v = pinVerdict({ hasAddress: true, pinSource: "GEOCODED", pin: near(TORPEDO, 40), found: { ...TORPEDO, precision: "CITY" } });
  check("точка за 40 км від міста з адреси — пересунути", v.code === "MOVE", v);
}
{
  const v = pinVerdict({ hasAddress: true, pinSource: "GEOCODED", pin: TORPEDO, found: null });
  check("адресу не знайдено — перевірити нема з чим", v.code === "NOT_FOUND", v);
}
{
  const v = pinVerdict({ hasAddress: true, pinSource: "NONE", pin: null, found: { ...TORPEDO, precision: "ADDRESS" } });
  check("точки немає, адреса знайшлась", v.code === "NO_PIN", v);
}
{
  const v = pinVerdict({ hasAddress: false, pinSource: "NONE", pin: null, found: null });
  check("ні адреси, ні точки", v.code === "NO_ADDRESS", v);
}

/* ── База: вид і збіг Postgres із JS ─────────────────────────────────── */

if (process.argv.includes("--db")) {
  const { prisma } = await import("../src/lib/prisma");
  const { runReadOnlyQuery } = await import("../src/lib/assistant/facts/query-db");
  try {
    const pts = PLACES.map(([, lat, lng], i) => `(${i + 1}, ${lng}::float8, ${lat}::float8)`).join(", ");
    const pg = await prisma.$queryRawUnsafe<Array<{ i: bigint; inside: boolean }>>(
      `SELECT i, ${LVIV_OBLAST_SQL} @> point(x, y) AS inside FROM (VALUES ${pts}) v(i, x, y)`
    );
    const mism = pg.filter((r) => r.inside !== PLACES[Number(r.i) - 1][3]).map((r) => PLACES[Number(r.i) - 1][0]);
    check("кордон у Postgres збігається з JS", mism.length === 0, mism);

    const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const rows = await prisma.$queryRawUnsafe<Array<{ i: bigint; hit: boolean }>>(
      `SELECT i, t ~* p AS hit FROM (VALUES ${TEXTS.map(([k, t], i) => `(${i + 1}, ${lit(t)}, ${lit(RE[k as keyof typeof RE])})`).join(", ")}) v(i, t, p)`
    );
    const bad = rows.filter((r) => r.hit !== TEXTS[Number(r.i) - 1][2]).map((r) => TEXTS[Number(r.i) - 1][1]);
    check("регулярки в Postgres дають те саме, що в JS", bad.length === 0, bad);

    const all = await runReadOnlyQuery(
      "SELECT region, COUNT(*) AS n, COUNT(*) FILTER (WHERE suspect) AS suspect, COUNT(*) FILTER (WHERE shipping_only) AS shipping FROM client_geo GROUP BY region ORDER BY region LIMIT 10"
    );
    check("вид client_geo виконується", all.ok, all.ok ? all.rows : all.error);
    if (all.ok) {
      const lviv = all.rows.find((r) => r.region === "LVIV");
      check("на Львівщині тисяча з гаком точок", Number(lviv?.n ?? 0) > 1000, all.rows);
    }

    const torpedo = await runReadOnlyQuery(
      "SELECT name, region, pin_source, suspect, suspect_reason FROM client_geo WHERE address ILIKE '%Торпедо%' AND region = 'OUTSIDE' LIMIT 20"
    );
    check(
      "«Торпедо» поза областю — підозрілі з причиною «адреса у Львові»",
      torpedo.ok && torpedo.rows.length > 0 && torpedo.rows.every((r) => r.pin_source === "MANUAL" || (r.suspect === true && /Льв/.test(String(r.suspect_reason)))),
      torpedo.ok ? torpedo.rows.slice(0, 3) : torpedo.error
    );

    const manual = await runReadOnlyQuery("SELECT COUNT(*) AS n FROM client_geo WHERE pin_source = 'MANUAL' AND suspect LIMIT 1");
    check("точки, поставлені людьми, не бувають «підозрілими»", manual.ok && Number(manual.rows[0]?.n) === 0, manual.ok ? manual.rows : manual.error);

    const ternopil = await runReadOnlyQuery("SELECT name, shipping_only FROM client_geo WHERE name ILIKE '%Окаринський%' LIMIT 3");
    check("Тернопіль (Нова пошта) — лише доставка", ternopil.ok && ternopil.rows.length > 0 && ternopil.rows.every((r) => r.shipping_only === true), ternopil.ok ? ternopil.rows : ternopil.error);

    const dist = await runReadOnlyQuery(
      "SELECT a.name, ROUND(SQRT(POWER(a.x_km - b.x_km, 2) + POWER(a.y_km - b.y_km, 2))::numeric, 1) AS km FROM client_geo a, client_geo b WHERE a.region = 'LVIV' AND b.region = 'LVIV' AND a.client_id <> b.client_id AND a.name ILIKE '%Скалоцьк%' ORDER BY km LIMIT 3"
    );
    check("відстань між клієнтами через x_km/y_km рахується", dist.ok, dist.ok ? dist.rows : dist.error);
  } finally {
    await prisma.$disconnect();
  }
}

/* ── Живий прогін: build_route mode=pins і stops (база + OpenStreetMap) ── */

if (process.argv.includes("--net")) {
  const { prisma } = await import("../src/lib/prisma");
  const { buildRouteTool } = await import("../src/lib/assistant/tools/route");
  const ctx = {
    userId: "check",
    role: "ADMIN",
    kind: "ADMIN" as const,
    scope: { repId: "check", repName: "Перевірка", company: true },
    today: new Date().toISOString().slice(0, 10),
  };
  try {
    type Pins = { перевірено: Array<{ клієнт: string; висновок: string; відстань_точка_адреса_км: number | null; адреса_за_картою: { регіон: string } | null; точка: { регіон: string } | null }> };
    const t0 = Date.now();
    const out = (await buildRouteTool.run(ctx, { mode: "pins", clients: ["Жук О.М. (ринок Торпедо)"] })) as Pins;
    const r = out.перевірено[0];
    check(
      "«Торпедо» під Запоріжжям — «стоїть не там», адреса знайдена на Львівщині",
      !!r && /не там/.test(r.висновок) && r.адреса_за_картою?.регіон === "Львівщина" && r.точка?.регіон === "поза Львівщиною",
      r
    );
    check("перевірка одного клієнта вкладається в 10 с", Date.now() - t0 < 10_000, `${Date.now() - t0} мс`);

    const tooMany = await buildRouteTool.run(ctx, { mode: "pins", clients: ["a1", "b2", "c3", "d4"] }).then(
      () => "без помилки",
      (e: Error) => e.message
    );
    check("більше 3 клієнтів — зрозуміла відмова", /не більше 3/.test(String(tooMany)), tooMany);

    type Stops = { порядок?: Array<{ назва: string; точка?: string; увага?: string }>; примітка?: string };
    const route = (await buildRouteTool.run(ctx, { stops: ["Жук О.М. (ринок Торпедо)", "Скалоцька"], start: "склад" })) as Stops;
    const zhuk = route.порядок?.find((s) => /Жук/.test(s.назва));
    check("у маршруті підозріла точка позначена «увага»", !!zhuk?.увага && /підозріла/.test(zhuk.увага), route.порядок ?? route);
    check("примітка маршруту каже перевірити точку", /mode=pins/.test(route.примітка ?? ""), route.примітка);
  } finally {
    await prisma.$disconnect();
  }
}

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
