/**
 * Стан точки клієнта: хто, коли і що з нею робив.  # READ ONLY
 *
 * Запуск:
 *   npx tsx -r dotenv/config scripts/check-client-pin.ts            # зведення по базі
 *   npx tsx -r dotenv/config scripts/check-client-pin.ts "Струк"    # по клієнту
 *
 * Заради чого. Торгові скаржилися, що уточнена точка «через час знову не
 * уточнена». Причиною виявилася відмова сервера чужому клієнту (знято
 * 22.09.2026), але сама перевірка лишається потрібною: коли хтось скаже
 * «точка зникла», відповідь має бути з даних, а не з припущень.
 *
 * Головне число — `затерті`: пін, який людина ставила руками (`geoAt` є),
 * а джерело вже не MANUAL. Такий рядок означав би, що уточнення хтось
 * перезаписав. На 22.09.2026 їх нуль, і так має лишатися: обмін з 1С
 * координат не чіпає (apply-counterparties.ts), а геокодер бере лише тих,
 * у кого точки немає взагалі (api/admin/client-map/geocode).
 *
 * Нічого не пише в базу.
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const dt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");

type Row = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  src: string | null;
  attempted: Date | null;
  at: Date | null;
  accuracy: number | null;
  author: string | null;
};

async function summary() {
  const [t] = await p.$queryRaw<Array<Record<string, number>>>`
    SELECT COUNT(*)::int AS "всього",
           COUNT(*) FILTER (WHERE "geoSource"::text = 'MANUAL')::int AS "уточнено руками",
           COUNT(*) FILTER (WHERE "geoSource"::text = 'GEOCODED')::int AS "геокодер",
           COUNT(*) FILTER (WHERE "geoSource"::text = 'CITY')::int AS "лише місто",
           COUNT(*) FILTER (WHERE "deliveryLat" IS NULL)::int AS "без точки",
           COUNT(*) FILTER (WHERE "geoAt" IS NOT NULL AND "geoSource"::text <> 'MANUAL')::int AS "затерті",
           COUNT(*) FILTER (WHERE "geoAt" IS NOT NULL AND "deliveryLat" IS NULL)::int AS "без координат"
    FROM "Counterparty"`;
  console.log("Точки клієнтів:", t);

  if (t["затерті"] > 0 || t["без координат"] > 0) {
    const bad = await p.$queryRaw<Row[]>`
      SELECT c.id, c.name, c."geoSource"::text AS src, c."geoAt" AS at, c."deliveryLat" AS lat
      FROM "Counterparty" c
      WHERE c."geoAt" IS NOT NULL AND (c."geoSource"::text <> 'MANUAL' OR c."deliveryLat" IS NULL)
      ORDER BY c."geoAt" DESC LIMIT 20`;
    console.log("\n⚠ Ручні уточнення, які хтось перезаписав:");
    for (const r of bad) console.log(`  ${r.name} — тепер ${r.src}, ставили ${dt(r.at)}`);
  } else {
    console.log("✓ Жодне ручне уточнення не перезаписане.");
  }

  const who = await p.$queryRaw<Array<{ rep: string; pins: number; last: Date }>>`
    SELECT u.name AS rep, COUNT(*)::int AS pins, MAX(c."geoAt") AS last
    FROM "Counterparty" c JOIN "User" u ON u.id = c."geoById"
    GROUP BY 1 ORDER BY pins DESC LIMIT 15`;
  console.log("\nХто ставив точки:");
  for (const w of who) console.log(`  ${w.rep.padEnd(20)} ${String(w.pins).padStart(4)} — востаннє ${dt(w.last)}`);
}

async function one(query: string) {
  const rows = await p.$queryRaw<Row[]>`
    SELECT c.id, c.name, c.code, c.address,
           c."deliveryLat" AS lat, c."deliveryLng" AS lng,
           c."geoSource"::text AS src, c."geoAttemptedAt" AS attempted,
           c."geoAt" AS at, c."geoAccuracyM" AS accuracy, u.name AS author
    FROM "Counterparty" c
    LEFT JOIN "User" u ON u.id = c."geoById"
    WHERE c.id = ${query} OR c.name ILIKE ${"%" + query + "%"} OR c.code = ${query}
    ORDER BY c.name LIMIT 20`;

  if (rows.length === 0) {
    console.log(`Нікого не знайшов за «${query}».`);
    return;
  }

  for (const r of rows) {
    console.log(`\n${r.name}${r.code ? ` (${r.code})` : ""}`);
    console.log(`  адреса:    ${r.address ?? "—"}`);
    console.log(`  точка:     ${r.lat != null ? `${r.lat}, ${r.lng}` : "немає"}`);
    console.log(`  джерело:   ${r.src ?? "—"}${r.src === "MANUAL" ? " (уточнено людиною)" : ""}`);
    /*
      Три різні «порожньо», і плутати їх не можна. Точку або ставила людина
      й ми знаємо хто (з 27.08.2026 пишемо автора — див. lib/analytics/
      field-work), або ставила людина ще до того, або не ставив ніхто і
      там здогад геокодера. Одне «—» на всі три випадки читалося б як
      «уточнення пропало».
    */
    console.log(
      `  уточнив:   ${
        r.at
          ? `${r.author ?? "невідомо хто"} ${dt(r.at)}`
          : r.src === "MANUAL"
            ? "— (уточнено до 27.08.2026, автора тоді не писали)"
            : "ніхто — точку поставив геокодер"
      }`
    );
    if (r.at) {
      console.log(`  точність:  ${r.accuracy != null ? `±${r.accuracy} м (стояв на місці)` : "— (тягнув пін по карті)"}`);
    }
    console.log(`  торкались: ${dt(r.attempted)} (будь-хто, зокрема геокодер)`);
    if (r.at && r.src !== "MANUAL") {
      console.log(`  ⚠ УТОЧНЕННЯ ЗАТЕРТЕ: людина ставила точку, а джерело вже ${r.src}`);
    }
  }
}

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (query) await one(query);
  else await summary();
  console.log("\nNothing was written.");
}

main().finally(() => p.$disconnect());
