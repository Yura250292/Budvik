/**
 * Географія обороту: скільки грошей дає кожне місто.
 *
 * Відповідає на «де ми сильні, а де білі плями»: місто з 20 клієнтами і
 * оборотом 40 тис./міс — це або слабкий торговий, або ринок, який ніхто
 * не розпрацьовує. Порівнювати міста між собою можна лише через «оборот
 * на клієнта» — самим оборотом велике місто завжди виграє.
 *
 * ЗВІДКИ МІСТО. Окремого поля «місто» в 1С немає, тож воно витягується
 * евристикою у два кроки:
 *   1) з дужок у назві клієнта — «Іванів Ольга (м.Радехів)» → Радехів;
 *      маркер «м./с./смт» обов'язковий, бо в дужках буває і назва магазину;
 *   2) з першої частини адреси до коми — «м.Суми, вул.Роменська» → Суми.
 * Кому не вдалося — чесний рядок «місто не визначене», а не тихе зникнення
 * з підсумків. Це та сама евристика, що при геокодуванні карти клієнтів.
 */

import { prisma } from "@/lib/prisma";
import { clampFrom } from "@/lib/analytics/facts";

/** Маркери населеного пункту: місто, село, селище, смт. */
const SETTLEMENT_PREFIX = /^(м|с|смт|с-ще|сел|м-ко)\s*\.?\s*/i;

/**
 * Дістає місто з назви клієнта або адреси.
 *
 * Експортована окремо, бо та сама евристика потрібна і карті («місто з
 * дужок» — випробуваний шлях геокодування), і будь-якому наступному
 * звіту по географії: копія колись розійшлася б.
 */
export function extractCityFrom(name: string, address: string | null): string | null {
  // 1. Дужки в назві: беремо ЛИШЕ фрагменти з маркером населеного пункту —
  //    у дужках живуть і назви магазинів («ОЛІВЕЦЬ»), і примітки («сусід»).
  for (const m of name.matchAll(/\(([^)]{2,40})\)/g)) {
    const inside = m[1].trim();
    if (SETTLEMENT_PREFIX.test(inside)) {
      const city = normalizeCity(inside.replace(SETTLEMENT_PREFIX, ""));
      if (city) return city;
    }
  }

  // Маркер міста буває і поза дужками: «Середа Євген с. Дубляни».
  const inline = name.match(/(?:^|\s)(?:м|с|смт)\s*\.\s*([А-ЯІЇЄҐ][а-яіїєґ'’-]{2,25})/);
  if (inline) {
    const city = normalizeCity(inline[1]);
    if (city) return city;
  }

  // 2. Перша частина адреси до коми.
  if (address) {
    const head = address.split(",")[0]?.trim() ?? "";
    const stripped = head.replace(SETTLEMENT_PREFIX, "").trim();
    // Вулиця на початку означає адресу без міста.
    if (/^(вул|просп|пров|бул)/i.test(stripped)) return null;
    const city = normalizeCity(stripped);
    if (city) return city;
  }

  return null;
}

/**
 * Нормалізація: обрізає хвости після міста, відкидає сміття.
 *
 * «Львів, с.Сокільники» лишає перше — воно точніше для групування, бо
 * саме так люди називають напрямок.
 */
function normalizeCity(raw: string): string | null {
  const first = raw.split(/[,;/]/)[0].trim().replace(/["«»]/g, "");
  // Місто — одне-три слова кирилицею; цифри чи латиниця — це не воно.
  if (!/^[А-ЯІЇЄҐа-яіїєґ'’\-\s]{3,30}$/.test(first)) return null;
  const words = first.split(/\s+/);
  if (words.length > 3) return null;
  // Кожне слово з великої: «нова пошта» відсіється, «Кривий Ріг» пройде.
  if (!words.every((w) => /^[А-ЯІЇЄҐ]/.test(w))) return null;
  return words.join(" ");
}

export type CityRow = {
  city: string;
  /** Клієнти з покупками за період. */
  buyers: number;
  /** Всі відомі клієнти міста (з історією покупок будь-коли). */
  clients: number;
  amount: number;
  perBuyer: number;
  debt: number;
  /** Скільки клієнтів міста мають координати — повнота карти. */
  withGeo: number;
  repNames: string[];
};

export type GeoRevenueReport = {
  cities: CityRow[];
  /** Оборот клієнтів, місто яких визначити не вдалося. */
  unknown: { clients: number; buyers: number; amount: number };
  totalAmount: number;
};

type ClientRow = {
  counterpartyId: string;
  name: string;
  address: string | null;
  deliveryAddress: string | null;
  lat: number | null;
  debt: number;
  amount: number;
  repName: string | null;
};

export async function buildGeoRevenueReport(from: Date, to: Date): Promise<GeoRevenueReport> {
  from = clampFrom(from);

  const rows = await prisma.$queryRaw<ClientRow[]>`
    WITH turnover AS (
      SELECT s."counterpartyId", SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" IN ('REALIZATION', 'RETURN')
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
        AND s."counterpartyId" IS NOT NULL
      GROUP BY 1
    ),
    ever AS (
      SELECT DISTINCT s."counterpartyId"
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
    )
    SELECT
      c.id AS "counterpartyId",
      c.name,
      c.address,
      c."deliveryAddress",
      c."deliveryLat" AS lat,
      COALESCE(c."receivableBalance", 0)::float AS debt,
      COALESCE(t.amount, 0)::float AS amount,
      (
        SELECT u.name FROM "SalesDocument" sd
        JOIN "User" u ON u.id = sd."salesRepId"
        WHERE sd."counterpartyId" = c.id AND sd."salesRepId" IS NOT NULL
          AND sd."docType" <> 'RETURN'
        ORDER BY (sd."docType" = 'REALIZATION') DESC, sd."createdAt" DESC
        LIMIT 1
      ) AS "repName"
    FROM ever e
    JOIN "Counterparty" c ON c.id = e."counterpartyId"
    LEFT JOIN turnover t ON t."counterpartyId" = c.id
  `;

  const byCity = new Map<string, { buyers: number; clients: number; amount: number; debt: number; withGeo: number; reps: Set<string> }>();
  const unknown = { clients: 0, buyers: 0, amount: 0 };
  let totalAmount = 0;

  for (const r of rows) {
    totalAmount += r.amount;
    const city = extractCityFrom(r.name, r.deliveryAddress ?? r.address);

    if (!city) {
      unknown.clients++;
      if (r.amount > 0) unknown.buyers++;
      unknown.amount += r.amount;
      continue;
    }

    const agg = byCity.get(city) ?? { buyers: 0, clients: 0, amount: 0, debt: 0, withGeo: 0, reps: new Set<string>() };
    agg.clients++;
    if (r.amount > 0) agg.buyers++;
    agg.amount += r.amount;
    agg.debt += r.debt;
    if (r.lat !== null) agg.withGeo++;
    if (r.repName) agg.reps.add(r.repName);
    byCity.set(city, agg);
  }

  const cities: CityRow[] = [...byCity.entries()]
    .map(([city, a]) => ({
      city,
      buyers: a.buyers,
      clients: a.clients,
      amount: a.amount,
      perBuyer: a.buyers > 0 ? a.amount / a.buyers : 0,
      debt: a.debt,
      withGeo: a.withGeo,
      repNames: [...a.reps].sort(),
    }))
    .sort((a, b) => b.amount - a.amount);

  return { cities, unknown, totalAmount };
}
