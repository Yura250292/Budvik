/**
 * Кошик: які товари їдуть в одній накладній.
 *
 * По кожній парі товарів рахується, скільки разів вони зустрілись разом,
 * і наскільки це частіше за випадковість (lift). Готовий сценарій
 * допродажу: «клієнт бере відрізні круги — у 60% таких накладних є й
 * зачисні; якщо в замовленні їх немає, варто спитати».
 *
 * Свідомо НЕ асоціативні правила «на всю науку» (apriori з наборами
 * будь-якої довжини): на 8 тисячах накладних стабільні лише пари, а
 * трійки й довші множини дали б поодинокі збіги з гучними відсотками.
 *
 * Лише реалізації: повернення в кошику нічого не каже про попит.
 */

import { prisma } from "@/lib/prisma";
import { clampFrom } from "@/lib/analytics/facts";

/**
 * Мінімум спільних накладних, щоб пара вважалася закономірністю.
 *
 * Нижче — випадковість: два товари, куплені разом двічі, дають
 * «зв'язок 100%», який ніколи не повториться. П'ять — емпірична межа,
 * з якої відсоток супроводу починає відтворюватись місяць до місяця.
 */
const MIN_TOGETHER = 5;

/**
 * Мінімальний lift, щоб показувати пару.
 *
 * lift = 1 означає «зустрічаються разом рівно так часто, як випадково».
 * 1.5 — зв'язок уже помітний оком; все, що нижче, — шум великих чисел
 * (два бестселери опиняються разом просто тому, що обидва скрізь).
 */
const MIN_LIFT = 1.5;

export type BasketPair = {
  productA: { id: string; name: string; brandName: string | null; docs: number };
  productB: { id: string; name: string; brandName: string | null; docs: number };
  /** Накладних, де товари разом. */
  together: number;
  /** % накладних з A, у яких є і B — напрямок підказки продавцю. */
  confidenceAtoB: number;
  confidenceBtoA: number;
  /** У скільки разів частіше за випадковість. */
  lift: number;
};

export type BasketReport = {
  totalDocs: number;
  minTogether: number;
  pairs: BasketPair[];
};

type PairRow = {
  aId: string;
  aName: string;
  aBrand: string | null;
  aDocs: number;
  bId: string;
  bName: string;
  bBrand: string | null;
  bDocs: number;
  together: number;
  totalDocs: number;
};

export async function buildBasketReport(from: Date, to: Date, limit = 100): Promise<BasketReport> {
  from = clampFrom(from);

  // Пари й частоти одним запитом: тягнути 40 тис. рядків у JS заради
  // самозʼєднання немає сенсу — Postgres робить його по індексованих id.
  const rows = await prisma.$queryRaw<PairRow[]>`
    WITH doc_items AS (
      SELECT DISTINCT s.id AS doc, i."productId" AS pid
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
    ),
    product_docs AS (
      SELECT pid, COUNT(*)::int AS docs FROM doc_items GROUP BY pid
    ),
    total AS (SELECT COUNT(DISTINCT doc)::int AS n FROM doc_items),
    pairs AS (
      -- a.pid < b.pid: кожна пара один раз, без дзеркал і само-пар.
      SELECT a.pid AS "aPid", b.pid AS "bPid", COUNT(*)::int AS together
      FROM doc_items a
      JOIN doc_items b ON b.doc = a.doc AND a.pid < b.pid
      GROUP BY a.pid, b.pid
      HAVING COUNT(*) >= ${MIN_TOGETHER}
    )
    SELECT
      pa.id AS "aId", pa.name AS "aName", ba.name AS "aBrand", da.docs AS "aDocs",
      pb.id AS "bId", pb.name AS "bName", bb.name AS "bBrand", db.docs AS "bDocs",
      pr.together,
      t.n AS "totalDocs"
    FROM pairs pr
    JOIN product_docs da ON da.pid = pr."aPid"
    JOIN product_docs db ON db.pid = pr."bPid"
    JOIN "Product" pa ON pa.id = pr."aPid"
    JOIN "Product" pb ON pb.id = pr."bPid"
    LEFT JOIN "Brand" ba ON ba.id = pa."brandId"
    LEFT JOIN "Brand" bb ON bb.id = pb."brandId"
    CROSS JOIN total t
    ORDER BY pr.together DESC
  `;

  const totalDocs = rows[0]?.totalDocs ?? 0;

  const pairs: BasketPair[] = rows
    .map((r) => {
      // lift = P(A і B) / (P(A) × P(B)): наскільки спільна поява частіша
      // за добуток самостійних частот.
      const lift =
        totalDocs > 0 ? (r.together * totalDocs) / (r.aDocs * r.bDocs) : 0;
      return {
        productA: { id: r.aId, name: r.aName, brandName: r.aBrand, docs: r.aDocs },
        productB: { id: r.bId, name: r.bName, brandName: r.bBrand, docs: r.bDocs },
        together: r.together,
        confidenceAtoB: (r.together / r.aDocs) * 100,
        confidenceBtoA: (r.together / r.bDocs) * 100,
        lift,
      };
    })
    .filter((p) => p.lift >= MIN_LIFT)
    // Сила зв'язку × масштаб: голий lift підняв би нагору рідкісні пари,
    // голий together — пари бестселерів без реального зв'язку.
    .sort((a, b) => b.together * Math.log(b.lift + 1) - a.together * Math.log(a.lift + 1))
    .slice(0, limit);

  return { totalDocs, minTogether: MIN_TOGETHER, pairs };
}
