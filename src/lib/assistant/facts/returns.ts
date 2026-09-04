/**
 * Повернення торгового: скільки, від кого, чого — і чи це багато.
 *
 * Сама сума повернень нічого не каже. 88 тисяч це багато? Відповідь
 * залежить від обороту й від решти команди: заміряно 04.09.2026, у одного
 * торгового 5,4 % від валу, у решти 0-1,3 %. Тому тут поруч завжди стоїть
 * частка і медіана по команді — без них цифра не перетворюється на дію.
 *
 * Частку рахуємо від ВАЛУ (нетто + повернення), а не від нетто: при
 * поверненнях, більших за продажі, від нетто вийшло б понад 100 %.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  clampFrom,
  returnedProducts,
  returnsByClient,
  RETURNS_ONLY,
  SOURCE_FILTER,
  SALES_ONLY,
} from "@/lib/analytics/facts";
import type { Period } from "@/lib/analytics/period";

export type ReturnsFacts = {
  /** Сума повернень, додатна. */
  amount: number;
  docs: number;
  /** Оборот нетто за той самий період — знаменник для частки. */
  net: number;
  /** Частка повернень у валу, %. */
  share: number;
  /** Медіана частки по торгових, у кого був оборот. */
  teamShare: number;
  /** Скільки торгових мають гіршу частку. */
  worseThanMe: number;
  teamSize: number;
  byClient: Array<{ clientId: string | null; name: string; amount: number; docs: number }>;
  byProduct: Array<{ productId: string; name: string; brand: string | null; amount: number; qty: number }>;
};

type TeamRow = { repId: string; net: number; returns: number };

export async function returnsFacts(repId: string, period: Period): Promise<ReturnsFacts> {
  const from = clampFrom(period.from);

  const [mine, byClient, byProduct, team] = await Promise.all([
    prisma.$queryRaw<Array<{ net: number; returns: number; docs: number }>>`
      SELECT
        COALESCE(SUM(s."totalAmount"), 0)::float AS net,
        COALESCE(-SUM(s."totalAmount") FILTER (WHERE NOT (${SALES_ONLY})), 0)::float AS returns,
        COUNT(*) FILTER (WHERE NOT (${SALES_ONLY}))::int AS docs
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."salesRepId" = ${repId}
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${period.to}
    `,
    returnsByClient(period.from, period.to, repId, 8),
    returnedProducts(period.from, period.to, repId, 8),
    prisma.$queryRaw<TeamRow[]>`
      SELECT
        s."salesRepId" AS "repId",
        COALESCE(SUM(s."totalAmount"), 0)::float AS net,
        COALESCE(-SUM(s."totalAmount") FILTER (WHERE NOT (${SALES_ONLY})), 0)::float AS returns
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."salesRepId" IS NOT NULL
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${period.to}
      GROUP BY 1
      HAVING SUM(s."totalAmount") > 0
    `,
  ]);

  const row = mine[0] ?? { net: 0, returns: 0, docs: 0 };
  const shareOf = (net: number, returns: number) => {
    const gross = net + returns;
    return gross > 0 ? (returns / gross) * 100 : 0;
  };

  const myShare = shareOf(row.net, row.returns);
  const shares = team.map((t) => shareOf(t.net, t.returns)).sort((a, b) => a - b);
  const median = shares.length
    ? shares.length % 2
      ? shares[(shares.length - 1) / 2]
      : (shares[shares.length / 2 - 1] + shares[shares.length / 2]) / 2
    : 0;

  return {
    amount: row.returns,
    docs: row.docs,
    net: row.net,
    share: myShare,
    teamShare: median,
    worseThanMe: shares.filter((s) => s > myShare).length,
    teamSize: shares.length,
    byClient: byClient.map((c) => ({
      clientId: c.clientId,
      name: c.clientName ?? "—",
      amount: c.amount,
      docs: c.docs,
    })),
    byProduct: byProduct.map((p) => ({
      productId: p.productId,
      name: p.name,
      brand: p.brandName,
      amount: p.amount,
      qty: p.qty,
    })),
  };
}

/**
 * Найчастіші причини повернення на рівні даних — товар, який купують і
 * повертають той самий клієнт.
 *
 * Причини в 1С немає, тож пояснити «чому» ми не можемо. Але можемо
 * показати повторюваність: та сама пара клієнт+товар у поверненнях двічі
 * і більше — це вже не випадковість, а привід спитати.
 */
export async function repeatedReturns(repId: string, period: Period, limit = 5) {
  const from = clampFrom(period.from);
  return prisma.$queryRaw<
    Array<{ clientId: string; clientName: string; productName: string; times: number; amount: number }>
  >`
    SELECT
      s."counterpartyId" AS "clientId",
      c.name AS "clientName",
      p.name AS "productName",
      COUNT(DISTINCT s.id)::int AS times,
      -SUM(i.quantity * i."sellingPrice")::float AS amount
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    JOIN "Product" p ON p.id = i."productId"
    JOIN "Counterparty" c ON c.id = s."counterpartyId"
    WHERE ${RETURNS_ONLY}
      AND s."salesRepId" = ${repId}
      AND s."createdAt" >= ${from} AND s."createdAt" <= ${period.to}
    GROUP BY 1, 2, 3
    HAVING COUNT(DISTINCT s.id) >= 2
    ORDER BY amount DESC
    LIMIT ${Prisma.raw(String(limit))}
  `;
}
