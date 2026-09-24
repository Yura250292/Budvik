/**
 * Точки росту для керівника: де взяти оборот у наявних клієнтів і кого з
 * потенційних клієнтів торговому по дорозі.
 *
 * 1. **Хто недокуповує** (`findBrandGaps`). Те саме правило, що в порадах
 *    торговому по одному клієнту (clientOrder.ts, similarClients): «схожий» —
 *    щонайменше 3 спільні бренди, бренд радимо, коли його беруть щонайменше
 *    3 схожі. Але там запит на кожного клієнта окремо, а керівнику потрібна
 *    вся база разом — тому матриця «клієнт × бренд» тягнеться одним запитом,
 *    а схожість рахується в пам'яті (≈1–2 тис. клієнтів, мілісекунди).
 *
 *    Оцінка «скільки це грошей» — частка гаманця: яку частку своїх закупівель
 *    у нас схожі клієнти віддають цьому бренду (медіана), помножена на річний
 *    оборот самого клієнта. Її легко пояснити людині й вона не роздуває
 *    малого клієнта до обороту великого.
 *
 * 2. **Потенційні клієнти по дорозі** (`assignProspects`). Точка «По дорозі» в
 *    того польового торгового, чиї клієнти стоять поруч; день — той, у який
 *    ці сусідні клієнти зазвичай беруть товар. Радіус залежить від точності
 *    піна: для точки, поставленої лише по місту (центр населеного пункту),
 *    він ширший.
 *
 * Обидва ядра — чисті функції (перевірка scripts/check-growth.mts), читання
 * бази — окремо внизу. Нічого не пише.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER, NOT_INTERNAL_DOC } from "@/lib/analytics/facts";
import { FREE_STOCK_ALL } from "@/lib/assistant/facts/sql";
import { haversineM } from "@/lib/track/geo";

/* ── 1. Хто недокуповує ─────────────────────────────────────────────── */

/** Спільних брендів, щоб клієнт був «схожим» — як PEER_OVERLAP у clientOrder.ts. */
export const GAP_PEER_OVERLAP = 3;
/** Схожих, що беруть бренд, щоб він став порадою — як PEER_SUPPORT у clientOrder.ts. */
export const GAP_PEER_SUPPORT = 3;
/**
 * Яка частка схожих має брати бренд. Без неї APRO, який бере половина бази,
 * «радився» б кожному, хто його не бере, навіть коли схожі на нього клієнти
 * здебільшого теж без APRO.
 */
export const GAP_MIN_SHARE = 0.3;
/** За скільки днів купівлі клієнт вважається живим — радити «сплячому» марно. */
export const GAP_ACTIVE_DAYS = 180;

export type ClientBrandRow = {
  clientId: string;
  clientName: string;
  repId: string | null;
  /** Нормалізована назва бренду: у довіднику є дублі на кшталт двох «Grösser» */
  brandKey: string;
  brandName: string;
  /** Сума продажів бренду клієнту за вікно, ₴ */
  amount: number;
  /** Купував у межах GAP_ACTIVE_DAYS */
  active: boolean;
};

export type BrandGap = {
  clientId: string;
  clientName: string;
  repId: string | null;
  brandKey: string;
  brandName: string;
  /** Скільки схожих клієнтів знайшлося */
  peers: number;
  /** Скільки з них беруть цей бренд */
  buyers: number;
  /** Медіанна частка бренду в закупівлях схожих, 0..1 */
  walletShare: number;
  /** Оборот клієнта за вікно, ₴ */
  clientTotal: number;
  /** Оцінка річного обороту бренду в цього клієнта, ₴ */
  estimate: number;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function findBrandGaps(rows: ClientBrandRow[], opts: { stockBrands: Set<string> }): BrandGap[] {
  type Client = { id: string; name: string; repId: string | null; active: boolean; brands: Map<string, number>; total: number };
  const clients = new Map<string, Client>();
  const brandName = new Map<string, string>();
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const c = clients.get(r.clientId) ?? { id: r.clientId, name: r.clientName, repId: r.repId, active: false, brands: new Map(), total: 0 };
    c.active ||= r.active;
    c.brands.set(r.brandKey, (c.brands.get(r.brandKey) ?? 0) + r.amount);
    c.total += r.amount;
    clients.set(r.clientId, c);
    if (!brandName.has(r.brandKey)) brandName.set(r.brandKey, r.brandName);
  }
  const all = [...clients.values()];
  const gaps: BrandGap[] = [];

  for (const c of all) {
    if (!c.active || c.brands.size < GAP_PEER_OVERLAP) continue;
    const peers = all.filter((p) => {
      if (p.id === c.id) return false;
      let shared = 0;
      for (const b of c.brands.keys()) if (p.brands.has(b) && ++shared >= GAP_PEER_OVERLAP) return true;
      return false;
    });
    if (peers.length < GAP_PEER_SUPPORT) continue;

    const buyersByBrand = new Map<string, number[]>();
    for (const p of peers) {
      for (const [b, amount] of p.brands) {
        if (c.brands.has(b) || !opts.stockBrands.has(b)) continue;
        const shares = buyersByBrand.get(b) ?? [];
        shares.push(amount / p.total);
        buyersByBrand.set(b, shares);
      }
    }
    for (const [b, shares] of buyersByBrand) {
      if (shares.length < GAP_PEER_SUPPORT || shares.length / peers.length < GAP_MIN_SHARE) continue;
      const walletShare = Math.round(median(shares) * 1000) / 1000;
      gaps.push({
        clientId: c.id,
        clientName: c.name,
        repId: c.repId,
        brandKey: b,
        brandName: brandName.get(b) ?? b,
        peers: peers.length,
        buyers: shares.length,
        walletShare,
        clientTotal: Math.round(c.total),
        estimate: Math.round(walletShare * c.total),
      });
    }
  }
  return gaps.sort((a, b) => b.estimate - a.estimate);
}

/* ── 2. Потенційні клієнти по дорозі ───────────────────────────────── */

/** Радіус «поруч» для точки з точною адресою, км. */
export const PROSPECT_RADIUS_ADDRESS_KM = 2;
/**
 * Для точки, поставленої лише по місту: пін стоїть у центрі населеного
 * пункту, а сам магазин може бути на околиці — радіус ширший.
 */
export const PROSPECT_RADIUS_CITY_KM = 5;

export type ProspectPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** ADDRESS | CITY — з details бази */
  precision: string | null;
  city: string | null;
  /** Категорія точки A–D з бази */
  category: string | null;
  outletType: string | null;
  specialization: string | null;
  status: string;
  /**
   * Обласний центр (details.settlementType). Пін «лише місто» там стоїть у
   * центрі великого міста, і відстань до клієнтів нічого не каже: у Львові
   * всі такі точки діставалися б тому, чиї клієнти біля центру.
   */
  bigCity: boolean;
};

/**
 * Категорія точки A–D. У базі вона записана то латиницею, то кирилицею
 * («B» і «В» — різні символи), і без зведення кирилична «В» сортувалася
 * б перед «A».
 */
export function normalizeCategory(raw: string | null | undefined): string | null {
  const c = (raw ?? "").trim().toUpperCase();
  if (!c) return null;
  const cyr: Record<string, string> = { А: "A", В: "B", С: "C", Д: "D" };
  return cyr[c] ?? c;
}

export type RepClientPoint = {
  clientId: string;
  name: string;
  repId: string;
  lat: number;
  lng: number;
  /** Документи клієнта по днях тижня, пн…нд */
  weekdayDocs: number[];
};

export type ProspectOnRoute = ProspectPoint & {
  repId: string | null;
  /** 0 — понеділок … 6 — неділя */
  weekday: number | null;
  nearbyClients: number;
  nearestClient: string | null;
  nearestKm: number | null;
  /** Чому не приписано: far — поруч немає клієнтів польових; no_address — обласний центр без адреси */
  unplaced: "far" | "no_address" | null;
};

export function assignProspects(prospects: ProspectPoint[], clients: RepClientPoint[]): ProspectOnRoute[] {
  const none = { repId: null, weekday: null, nearbyClients: 0, nearestClient: null, nearestKm: null };
  return prospects.map((p) => {
    if (p.precision !== "ADDRESS" && p.bigCity) return { ...p, ...none, unplaced: "no_address" as const };
    const radius = p.precision === "ADDRESS" ? PROSPECT_RADIUS_ADDRESS_KM : PROSPECT_RADIUS_CITY_KM;
    const near = clients
      .map((c) => ({ c, km: haversineM(p.lat, p.lng, c.lat, c.lng) / 1000 }))
      .filter((x) => x.km <= radius);
    if (near.length === 0) return { ...p, ...none, unplaced: "far" as const };
    // Ближчі клієнти важать більше: точка між двома торговими — того, хто поруч.
    const score = new Map<string, number>();
    for (const x of near) score.set(x.c.repId, (score.get(x.c.repId) ?? 0) + 1 / (1 + x.km));
    const repId = [...score.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const mine = near.filter((x) => x.c.repId === repId).sort((a, b) => a.km - b.km);
    const days = [0, 0, 0, 0, 0, 0, 0];
    for (const x of mine) x.c.weekdayDocs.forEach((n, i) => (days[i] += n));
    const best = Math.max(...days);
    return {
      ...p,
      repId,
      weekday: best > 0 ? days.indexOf(best) : null,
      nearbyClients: mine.length,
      nearestClient: mine[0].c.name,
      nearestKm: Math.round(mine[0].km * 10) / 10,
      unplaced: null,
    };
  });
}

/* ── Читання бази (лише SELECT) ─────────────────────────────────────── */

/** Нормалізована назва бренду — та сама, що в clientOrder.ts (дублі «Grösser»). */
export const brandKey = (name: string) => name.trim().normalize("NFC").toLowerCase();

/** Матриця «клієнт × бренд» за вікно, без повернень і без своїх контрагентів. */
export async function loadClientBrandMatrix(months = 12): Promise<ClientBrandRow[]> {
  const since = new Date(Date.now() - months * 30.44 * 86_400_000);
  const activeSince = new Date(Date.now() - GAP_ACTIVE_DAYS * 86_400_000);
  const rows = await prisma.$queryRaw<
    { clientId: string; clientName: string; repId: string | null; brandName: string; amount: number; lastAt: Date }[]
  >`
    WITH lines AS (
      SELECT s."counterpartyId" AS cid, p."brandId", s."salesRepId", s."createdAt",
             i.quantity * i."sellingPrice" AS amount
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      WHERE ${SOURCE_FILTER}
        AND s."docType" = 'REALIZATION'
        AND ${NOT_INTERNAL_DOC}
        AND s."counterpartyId" IS NOT NULL
        AND p."brandId" IS NOT NULL
        AND s."createdAt" >= ${since}
    ),
    rep AS (
      -- Торговий клієнта — той, хто оформив йому найбільше документів у вікні.
      SELECT DISTINCT ON (cid) cid, "salesRepId"
      FROM (SELECT cid, "salesRepId", COUNT(*) AS n FROM lines WHERE "salesRepId" IS NOT NULL GROUP BY 1, 2) x
      ORDER BY cid, n DESC
    )
    SELECT l.cid AS "clientId", c.name AS "clientName", r."salesRepId" AS "repId",
           b.name AS "brandName", SUM(l.amount)::float AS amount, MAX(l."createdAt") AS "lastAt"
    FROM lines l
    JOIN "Counterparty" c ON c.id = l.cid
    JOIN "Brand" b ON b.id = l."brandId"
    LEFT JOIN rep r ON r.cid = l.cid
    GROUP BY 1, 2, 3, 4
  `;
  // «Живий» — за останньою покупкою клієнта взагалі, а не цього бренду.
  const lastByClient = new Map<string, number>();
  for (const r of rows) lastByClient.set(r.clientId, Math.max(lastByClient.get(r.clientId) ?? 0, r.lastAt.getTime()));
  return rows.map((r) => ({
    clientId: r.clientId,
    clientName: r.clientName,
    repId: r.repId,
    brandKey: brandKey(r.brandName),
    brandName: r.brandName.trim(),
    amount: r.amount,
    active: (lastByClient.get(r.clientId) ?? 0) >= activeSince.getTime(),
  }));
}

/** Бренди, у яких зараз є що продати: активний товар з ціною й вільним залишком. */
export async function loadStockBrands(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ name: string; items: number }[]>`
    WITH ${FREE_STOCK_ALL}
    SELECT b.name, COUNT(*)::int AS items
    FROM "Product" p
    JOIN "Brand" b ON b.id = p."brandId"
    JOIN free_stock fs ON fs."productId" = p.id
    WHERE p."isActive" AND p.price > 0 AND fs.free > 0
    GROUP BY b.name
  `;
  const out = new Map<string, number>();
  for (const r of rows) out.set(brandKey(r.name), (out.get(brandKey(r.name)) ?? 0) + r.items);
  return out;
}

/** Потенційні клієнти з полями з details бази. */
export async function loadProspects(): Promise<ProspectPoint[]> {
  const rows = await prisma.prospectClient.findMany({
    where: { status: { in: ["NEW", "IN_PROGRESS"] } },
    select: { id: true, name: true, lat: true, lng: true, status: true, details: true },
  });
  return rows.map((r) => {
    const d = (r.details && typeof r.details === "object" && !Array.isArray(r.details) ? r.details : {}) as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
    return {
      id: r.id,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      precision: s("precision"),
      city: s("city"),
      category: normalizeCategory(s("category")),
      outletType: s("outletType"),
      specialization: s("specialization"),
      status: r.status,
      bigCity: /областн/i.test(s("settlementType") ?? ""),
    };
  });
}

/**
 * Клієнти з піном у заданих торгових і їхні дні тижня за півроку.
 *
 * День тижня документа 1С — простим EXTRACT: дата там київський стінний
 * час, записаний як UTC (див. route-habits.ts), конверсія зсунула б його.
 */
export async function loadRepClientPoints(repIds: string[]): Promise<RepClientPoint[]> {
  if (repIds.length === 0) return [];
  const since = new Date(Date.now() - 182 * 86_400_000);
  const rows = await prisma.$queryRaw<{ clientId: string; name: string; repId: string; lat: number; lng: number; dow: number; n: number }[]>`
    SELECT c.id AS "clientId", c.name, s."salesRepId" AS "repId", c."deliveryLat" AS lat, c."deliveryLng" AS lng,
           EXTRACT(ISODOW FROM s."createdAt")::int AS dow, COUNT(*)::int AS n
    FROM "SalesDocument" s
    JOIN "Counterparty" c ON c.id = s."counterpartyId"
    WHERE ${SOURCE_FILTER}
      AND s."docType" = 'REALIZATION'
      AND s."salesRepId" IN (${Prisma.join(repIds)})
      AND s."createdAt" >= ${since}
      AND c."deliveryLat" IS NOT NULL AND c."deliveryLng" IS NOT NULL
      AND NOT c."isInternal"
    GROUP BY 1, 2, 3, 4, 5, 6
  `;
  const byKey = new Map<string, RepClientPoint>();
  for (const r of rows) {
    const key = `${r.clientId}:${r.repId}`;
    const p = byKey.get(key) ?? { clientId: r.clientId, name: r.name, repId: r.repId, lat: r.lat, lng: r.lng, weekdayDocs: [0, 0, 0, 0, 0, 0, 0] };
    p.weekdayDocs[r.dow - 1] += r.n;
    byKey.set(key, p);
  }
  return [...byKey.values()];
}
