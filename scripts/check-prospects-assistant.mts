/**
 * Потенційні клієнти (ромби на карті, «База Львів») у помічнику й MCP.
 *
 * 24.09.2026: вид prospects віддавав лише назву, адресу й status — а status
 * CONVERTED ніхто не пише (конверсія рахується на льоту, prospects/converted.ts),
 * тож модель не могла відрізнити «ще розпрацювати» від «уже клієнт», не бачила
 * категорії A–D, спеціалізації й того, що 151 з 444 точок стоять лише до міста.
 * І в маршрут ромб за назвою не ставився — лише клієнти 1С.
 *
 *   npx tsx scripts/check-prospects-assistant.mts    (DATABASE_URL; лише SELECT, нічого не пише)
 */

import { prisma } from "../src/lib/prisma";
import { runReadOnlyQuery } from "../src/lib/assistant/facts/query-db";
import { OPEN_PROSPECT } from "../src/lib/prospects/converted";
import { loadProspects } from "../src/lib/analytics/growth";
import { resolveRouteStops } from "../src/lib/assistant/facts/route-build";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${typeof got === "string" ? got : JSON.stringify(got)?.slice(0, 300)}`);
  if (!ok) fails.push(name);
}

try {
  const openCount = await prisma.prospectClient.count({ where: OPEN_PROSPECT });

  const sum = await runReadOnlyQuery(
    "SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE open) AS open, COUNT(*) FILTER (WHERE region = 'LVIV') AS lviv, COUNT(*) FILTER (WHERE pin_precision = 'CITY') AS city FROM prospects LIMIT 1"
  );
  check("вид prospects має open, region, pin_precision", sum.ok, sum.ok ? sum.rows : sum.error);
  if (sum.ok) {
    const r = sum.rows[0];
    check("open у виді = правило ромба на карті (OPEN_PROSPECT)", Number(r.open) === openCount, [r.open, openCount]);
    check("майже всі на Львівщині", Number(r.lviv) > Number(r.n) * 0.9, r);
    check("точки «лише до міста» видно", Number(r.city) > 0, r);
  }

  const cats = await runReadOnlyQuery("SELECT category, COUNT(*) AS n FROM prospects GROUP BY category ORDER BY category LIMIT 10");
  check(
    "категорії лише латинські A–D (кирилична «В» зведена)",
    cats.ok && cats.rows.every((r) => r.category === null || /^[ABCD]$/.test(String(r.category))),
    cats.ok ? cats.rows : cats.error
  );

  const cols = await runReadOnlyQuery(
    "SELECT name, specialization, outlet_type, price_segment, city, similar_client, km_from_depot, x_km, y_km, map_url FROM prospects WHERE open LIMIT 3"
  );
  check(
    "поля бази-джерела й відстані читаються",
    cols.ok && cols.rows.length > 0 && cols.rows.every((r) => r.specialization && r.x_km !== null && String(r.map_url).startsWith("https://")),
    cols.ok ? cols.rows[0] : cols.error
  );

  const near = await runReadOnlyQuery(
    "SELECT p.name, ROUND(SQRT(POWER(p.x_km - c.x_km, 2) + POWER(p.y_km - c.y_km, 2))::numeric, 1) AS km FROM prospects p JOIN client_geo c ON c.name ILIKE '%Скалоцьк%' WHERE p.open ORDER BY km LIMIT 3"
  );
  check("«ромби біля клієнта» — відстань між prospects і client_geo рахується", near.ok && near.rows.length > 0, near.ok ? near.rows : near.error);

  const growth = await loadProspects();
  check("sales_analysis mode=prospects бере ті самі відкриті ромби", growth.length === openCount, [growth.length, openCount]);

  // Ромб у маршруті за назвою — той, що не збігається з жодним клієнтом 1С.
  const sample = await prisma.prospectClient.findFirst({
    where: { ...OPEN_PROSPECT, name: { contains: "Мостиська" } },
    select: { name: true, lat: true, lng: true },
  });
  if (sample) {
    const res = await resolveRouteStops([sample.name, "склад"], "check", { geocode: false });
    const stop = res.picked.find((s) => s.source === "потенційний");
    check("ромб за назвою стає точкою маршруту «потенційний»", !!stop && stop.lat === sample.lat && stop.lng === sample.lng, res);
    check("точка ромба несе примітку з категорією", !!stop?.note && /категорія/.test(stop.note), stop?.note);
  } else {
    check("є ромб у Мостиськах для перевірки маршруту", false, null);
  }
} finally {
  await prisma.$disconnect();
}

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
