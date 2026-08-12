/**
 * Звіт: що заважає ставити клієнтів на карту і що з цього можна виправити.
 *
 * Маршрут водія тримається на координатах: без них клієнта не поставити в
 * послідовність об'їзду і не визначити зону (місто 25 ₴ / область 15 ₴).
 * Зараз координати має 375 карток із 3689, і частина з них — з точністю
 * лише до міста, тобто пін стоїть у центрі, а не там, де магазин.
 *
 * Звіт нічого не змінює. Він лише сортує клієнтів за тим, ЩО з ними робити:
 * геокодувати, уточнити, чи взагалі прибрати з маршрутів. Виправлення —
 * окремим скриптом, після того як список перегляне власник.
 *
 * Запуск:
 *   node --experimental-strip-types scripts/report-geo-coverage.ts
 *   node --experimental-strip-types scripts/report-geo-coverage.ts --all
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const showAll = process.argv.includes("--all");

/**
 * Адреси, які не є доставкою до клієнта.
 *
 * «Самовивіз» — клієнт приїжджає сам. «Нова пошта» — везуть на відділення,
 * і адреса відділення не є адресою клієнта: завтра він забере на іншому.
 * Такі картки не мають потрапляти в маршрут водія взагалі, інакше
 * оптимізатор поведе його через пів області до чужого складу.
 */
const NOT_DELIVERY = /нова\s*пошта|новапошта|\bнп\b|самовив|укрпошт|міст\s*експрес|meest|делів|delivery\s*auto|justin/i;

/**
 * Адреса детальніша за назву міста: є вулиця, будинок, ринок або магазин.
 * Саме такі можна догеокодувати до точки, а не до центру населеного пункту.
 */
const HAS_DETAIL = /вул|улиц|просп|бульв|пров|буд\b|б-р|ринок|р-?к\b|маг\.|магазин|шосе|дорог|площ|\d+\s*[а-яa-z]?\s*$|\d+\/\d+/i;

/** Службові картки: склади, співробітники, знеособлені покупці. */
const INTERNAL = /^склад|^фізична особа|^інтернет|співроб|\(співроб/i;

type Row = {
  id: string;
  name: string;
  address: string | null;
  deliveryAddress: string | null;
  deliveryLat: number | null;
  geoSource: string | null;
  docs: number;
};

async function main() {
  // Беремо лише тих, кому реально возили: картка без відвантажень за пів
  // року нічого не важить для маршрутів, а таких у базі більшість.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT c.id, c.name, c.address, c."deliveryAddress",
           c."deliveryLat", c."geoSource"::text AS "geoSource",
           count(d.id)::int AS docs
    FROM "Counterparty" c
    LEFT JOIN "SalesDocument" d
      ON d."counterpartyId" = c.id
     AND d."docType" = 'REALIZATION'
     AND d."createdAt" > now() - interval '180 days'
    GROUP BY c.id, c.name, c.address, c."deliveryAddress", c."deliveryLat", c."geoSource"
    HAVING count(d.id) > 0
    ORDER BY count(d.id) DESC`;

  const buckets = {
    ok: [] as Row[],
    geocode: [] as Row[],
    refine: [] as Row[],
    noAddress: [] as Row[],
    notDelivery: [] as Row[],
    internal: [] as Row[],
  };

  for (const r of rows) {
    const addr = (r.deliveryAddress || r.address || "").trim();

    if (INTERNAL.test(r.name)) {
      buckets.internal.push(r);
      continue;
    }
    if (addr && NOT_DELIVERY.test(addr)) {
      buckets.notDelivery.push(r);
      continue;
    }
    if (!addr) {
      buckets.noAddress.push(r);
      continue;
    }
    if (r.deliveryLat == null) {
      buckets.geocode.push(r);
      continue;
    }
    // Координати є, але лише по місту — уточнюємо, якщо адреса детальніша.
    if (r.geoSource === "CITY" && HAS_DETAIL.test(addr)) {
      buckets.refine.push(r);
      continue;
    }
    buckets.ok.push(r);
  }

  const total = rows.length;
  console.log(`\nКлієнти з відвантаженнями за 180 днів: ${total}\n`);

  const line = (label: string, list: Row[], note: string) => {
    const pct = Math.round((list.length / Math.max(1, total)) * 100);
    console.log(`  ${label.padEnd(34)} ${String(list.length).padStart(4)}  ${String(pct).padStart(3)}%   ${note}`);
  };

  console.log("СТАН:");
  line("Готові до маршруту", buckets.ok, "координати є, точність достатня");
  line("Уточнити пін", buckets.refine, "пін у центрі міста, адреса детальна");
  line("Геокодувати", buckets.geocode, "адреса є, координат немає");
  line("Немає адреси", buckets.noAddress, "нічого геокодувати");
  line("Не доставка", buckets.notDelivery, "Нова пошта, самовивіз");
  line("Службові", buckets.internal, "склади, співробітники");

  const fixable = buckets.refine.length + buckets.geocode.length;
  console.log(`\n  ВИПРАВНО ЗАРАЗ: ${fixable} клієнтів (${buckets.geocode.length} геокодувати + ${buckets.refine.length} уточнити)`);
  console.log(`  ВИКЛЮЧИТИ З МАРШРУТІВ: ${buckets.notDelivery.length + buckets.internal.length}`);

  const limit = showAll ? 10_000 : 15;

  const dump = (title: string, list: Row[], hint: string) => {
    if (list.length === 0) return;
    console.log(`\n${title} (${list.length})`);
    console.log(`  ${hint}`);
    for (const r of list.slice(0, limit)) {
      const addr = (r.deliveryAddress || r.address || "").trim() || "(порожньо)";
      console.log(`  ${String(r.docs).padStart(3)} накл.  ${r.name}`);
      console.log(`            ${addr}`);
    }
    if (list.length > limit) {
      console.log(`  ... ще ${list.length - limit}. Повний список: --all`);
    }
  };

  dump(
    "ГЕОКОДУВАТИ",
    buckets.geocode,
    "адреса в картці є, координат немає — клієнт не потрапляє на карту"
  );
  dump(
    "УТОЧНИТИ ПІН",
    buckets.refine,
    "координати лише до міста; адреса дозволяє знайти точніше"
  );
  dump(
    "НЕМАЄ АДРЕСИ",
    buckets.noAddress,
    "потрібна адреса від менеджера, або клієнт справді не для доставки"
  );
  dump(
    "НЕ ДОСТАВКА",
    buckets.notDelivery,
    "відділення перевізника чи самовивіз — прибрати з маршрутів водія"
  );

  console.log(`\nЩо далі: виправлення робить окремий скрипт, спершу в режимі`);
  console.log(`перегляду. Цей звіт нічого не змінює.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
