/**
 * Огляд одного бренду: скільки продаємо, куди йде, що ходове, що лежить.
 *
 * Питання власника 16.09.2026 — «посортуй мені по фірмі СИЛА». Досі на нього
 * відповідали лише шматки: дефіцит бренду (stock_health), частка в обороті
 * торгового (team_overview by_brand) і сирий query_db. Керівникові ж
 * потрібна одна картина: тренд бренду по місяцях, його частка у фірмі,
 * маржа, найходовіші товари з тим, на скільки їх вистачить, і хто цей бренд
 * продає.
 *
 * Рядки накладних, а не шапки: одна накладна везе кілька брендів, і
 * розкласти шапку неможливо (див. revenueByRepBrand). Тому оборот бренду
 * не включає знижку з шапки й трохи вищий за «справжній» — сказано в
 * примітці, щоб модель не порівнювала його з оборотом фірми по шапках.
 * Частка рахується від суми тих самих рядків по всіх брендах — яблука з
 * яблуками.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER, clampFrom, ANALYTICS_SINCE } from "@/lib/analytics/facts";
import { ANALYTICS_SINCE_DAY } from "@/lib/analytics/since";
import { kyivDayStart } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";
import { uah, pct } from "@/lib/assistant/format";

type Period = { fromDay: string; toDay: string; from: Date; to: Date; days: number; label: string };

type Totals = { amount: number; qty: number; docs: number; clients: number; costed: number; profit: number };

async function totals(brandId: string | null, from: Date, to: Date): Promise<Totals> {
  const brand = brandId ? Prisma.sql`AND p."brandId" = ${brandId}` : Prisma.empty;
  const [row] = await prisma.$queryRaw<Totals[]>`
    SELECT
      COALESCE(SUM(i.quantity * i."sellingPrice"), 0)::float AS amount,
      COALESCE(SUM(i.quantity), 0)::float AS qty,
      COUNT(DISTINCT s.id) FILTER (WHERE s."docType" = 'REALIZATION')::int AS docs,
      COUNT(DISTINCT s."counterpartyId") FILTER (WHERE s."docType" = 'REALIZATION')::int AS clients,
      COALESCE(SUM(i.quantity * i."sellingPrice") FILTER (WHERE i."purchasePrice" > 0), 0)::float AS costed,
      COALESCE(SUM(i.quantity * (i."sellingPrice" - i."purchasePrice")) FILTER (WHERE i."purchasePrice" > 0), 0)::float AS profit
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    JOIN "Product" p ON p.id = i."productId"
    WHERE ${SOURCE_FILTER}
      AND s."createdAt" >= ${clampFrom(from)} AND s."createdAt" <= ${to}
      ${brand}
  `;
  return row;
}

export async function brandOverviewFacts(brand: { id: string; name: string }, period: Period) {
  const prevTo = new Date(period.from.getTime() - 1);
  const prevFromDay = shiftDay(period.fromDay, -period.days);
  const prevFrom = kyivDayStart(prevFromDay);
  const prevAvailable = prevFrom >= ANALYTICS_SINCE;

  const [cur, prev, company, months, products, reps, stock] = await Promise.all([
    totals(brand.id, period.from, period.to),
    prevAvailable ? totals(brand.id, prevFrom, prevTo) : Promise.resolve(null),
    totals(null, period.from, period.to),
    /*
     * Помісячно — з початку історії, а не лише за період: тренд бренду
     * читається лише на кількох місяцях, а місяців у базі поки вісім.
     */
    prisma.$queryRaw<Array<{ month: string; amount: number; total: number }>>`
      SELECT
        to_char(date_trunc('month', s."createdAt"), 'YYYY-MM') AS month,
        COALESCE(SUM(i.quantity * i."sellingPrice") FILTER (WHERE p."brandId" = ${brand.id}), 0)::float AS amount,
        COALESCE(SUM(i.quantity * i."sellingPrice"), 0)::float AS total
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      WHERE ${SOURCE_FILTER}
        AND s."createdAt" >= ${ANALYTICS_SINCE} AND s."createdAt" <= ${period.to}
      GROUP BY 1
      ORDER BY 1
    `,
    /*
     * «Ходове» — те, що беруть ЧАСТО, а не те, що дороге: за оборотом
     * першими ставали палатки й шланги по 3–4 штуки, а круги й піна,
     * які йдуть у кожну третю накладну, губилися внизу. Тому порядок — за
     * кількістю накладних, оборот лише розводить рівні.
     */
    prisma.$queryRaw<
      Array<{ id: string; sku: string | null; name: string; docs: number; qty: number; amount: number; stock: number; profit: number; costed: number }>
    >`
      SELECT
        p.id, p.sku, p.name,
        COUNT(DISTINCT s.id) FILTER (WHERE s."docType" = 'REALIZATION')::int AS docs,
        SUM(i.quantity)::float AS qty,
        SUM(i.quantity * i."sellingPrice")::float AS amount,
        MAX(p.stock)::float AS stock,
        COALESCE(SUM(i.quantity * (i."sellingPrice" - i."purchasePrice")) FILTER (WHERE i."purchasePrice" > 0), 0)::float AS profit,
        COALESCE(SUM(i.quantity * i."sellingPrice") FILTER (WHERE i."purchasePrice" > 0), 0)::float AS costed
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      WHERE ${SOURCE_FILTER}
        AND s."createdAt" >= ${clampFrom(period.from)} AND s."createdAt" <= ${period.to}
        AND p."brandId" = ${brand.id}
      GROUP BY p.id, p.sku, p.name
      HAVING SUM(i.quantity) > 0
      ORDER BY docs DESC, amount DESC
      LIMIT 15
    `,
    prisma.$queryRaw<Array<{ repId: string; name: string | null; amount: number; clients: number }>>`
      SELECT
        s."salesRepId" AS "repId",
        u.name,
        SUM(i.quantity * i."sellingPrice")::float AS amount,
        COUNT(DISTINCT s."counterpartyId")::int AS clients
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "User" u ON u.id = s."salesRepId"
      WHERE ${SOURCE_FILTER}
        AND s."salesRepId" IS NOT NULL
        AND s."createdAt" >= ${clampFrom(period.from)} AND s."createdAt" <= ${period.to}
        AND p."brandId" = ${brand.id}
      GROUP BY s."salesRepId", u.name
      HAVING SUM(i.quantity * i."sellingPrice") > 0
      ORDER BY amount DESC
      LIMIT 10
    `,
    prisma.$queryRaw<Array<{ items: number; inStock: number; units: number }>>`
      SELECT
        COUNT(*)::int AS items,
        COUNT(*) FILTER (WHERE p.stock > 0)::int AS "inStock",
        COALESCE(SUM(GREATEST(p.stock, 0)), 0)::float AS units
      FROM "Product" p
      WHERE p."brandId" = ${brand.id} AND p."isActive" AND p."externalId" IS NOT NULL
    `,
  ]);

  const days = Math.max(1, period.days);
  const margin = (profit: number, costed: number) => (costed > 0 ? pct((profit / costed) * 100) : null);
  const change = prev && prev.amount > 0 ? pct(((cur.amount - prev.amount) / prev.amount) * 100) : null;

  return {
    бренд: brand.name,
    період: { з: period.fromDay, по: period.toDay, днів: period.days, підпис: period.label },
    продажі: {
      оборот: uah(cur.amount),
      штук: Math.round(cur.qty),
      реалізацій: cur.docs,
      клієнтів: cur.clients,
      частка_фірми_відсотків: company.amount > 0 ? pct((cur.amount / company.amount) * 100) : null,
      маржа_відсотків: margin(cur.profit, cur.costed),
      на_день: uah(cur.amount / days),
    },
    попередній_період: prev
      ? { з: prevFromDay, по: shiftDay(period.fromDay, -1), оборот: uah(prev.amount), зміна_відсотків: change }
      : { примітка: `рівного попереднього періоду в базі немає: реалізації лише з ${ANALYTICS_SINCE_DAY}` },
    помісячно: months.map((m) => ({
      місяць: m.month,
      оборот: uah(m.amount),
      частка_відсотків: m.total > 0 ? pct((m.amount / m.total) * 100) : null,
    })),
    найходовіші: products.map((p) => {
      const perDay = p.qty / days;
      return {
        товар_id: p.id,
        артикул: p.sku,
        назва: p.name,
        накладних: p.docs,
        продано_шт: Math.round(p.qty),
        оборот: uah(p.amount),
        маржа_відсотків: margin(p.profit, p.costed),
        залишок: Math.round(p.stock),
        шт_на_день: Math.round(perDay * 10) / 10,
        вистачить_днів: perDay > 0 ? Math.floor(Math.max(0, p.stock) / perDay) : null,
      };
    }),
    хто_продає: reps.map((r) => ({
      торговий_id: r.repId,
      торговий: r.name ?? "—",
      оборот: uah(r.amount),
      клієнтів: r.clients,
      частка_бренду_відсотків: cur.amount > 0 ? pct((r.amount / cur.amount) * 100) : null,
    })),
    асортимент: { позицій_в_обліку: stock[0]?.items ?? 0, у_наявності: stock[0]?.inStock ?? 0, штук_на_складі: Math.round(stock[0]?.units ?? 0) },
    примітка:
      "Оборот бренду — з рядків накладних без знижки з шапки, тому трохи вищий за частку в обороті по документах; частка рахується від тих самих рядків усієї фірми. Дефіцит і мертві залишки бренду — stock_health з brand.",
  };
}
