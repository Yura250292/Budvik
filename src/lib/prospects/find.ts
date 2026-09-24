/**
 * Потенційний клієнт (ромб на карті) за тим, як його назвала людина.
 *
 * «Маршрут: Кунанець, Стельмах Мостиська» — другий ще не клієнт 1С, а ромб
 * з бази для розпрацювання. Без цього пошуку він падав у «нерозпізнані», і
 * маршрут на розпрацювання доводилося диктувати адресами.
 *
 * Слова — те саме правило, що в пошуку контрагентів (search/client-words):
 * мʼякий знак і апостроф не рахуються, кожне слово має бути в назві чи
 * адресі. Лише відкриті ромби (OPEN_PROSPECT): той, хто вже став клієнтом,
 * знайдеться як клієнт.
 */

import { prisma } from "@/lib/prisma";
import { clientQuery, LOOSE_CHARS } from "@/lib/search/client-words";
import { searchPatterns } from "@/lib/assistant/facts/search-words";
import { OPEN_PROSPECT } from "@/lib/prospects/converted";
import { normalizeCategory } from "@/lib/analytics/growth";

export type ProspectHit = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: string | null;
  specialization: string | null;
  /** Точка стоїть лише в центрі населеного пункту — магазин шукати на місці. */
  approximate: boolean;
};

export async function findOpenProspects(query: string, take = 3): Promise<ProspectHit[]> {
  const cleaned = clientQuery(query);
  if (!cleaned) return [];
  for (const cut of [0, 1]) {
    const patterns = searchPatterns(cleaned, 5, cut);
    if (patterns.length === 0) return [];
    const ids = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT pc.id FROM "ProspectClient" pc
      WHERE translate(concat_ws(' ', pc.name, pc.address), ${LOOSE_CHARS}, '') ILIKE ALL(${patterns}::text[])
      LIMIT ${take * 3}
    `;
    if (ids.length === 0) continue;
    const rows = await prisma.prospectClient.findMany({
      where: { AND: [OPEN_PROSPECT, { id: { in: ids.map((r) => r.id) } }] },
      select: { id: true, name: true, address: true, lat: true, lng: true, details: true },
      orderBy: { name: "asc" },
      take,
    });
    if (rows.length === 0) continue;
    return rows.map((r) => {
      const d = (r.details && typeof r.details === "object" && !Array.isArray(r.details) ? r.details : {}) as Record<string, unknown>;
      const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
      return {
        id: r.id,
        name: r.name,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        category: normalizeCategory(s("category")),
        specialization: s("specialization"),
        approximate: s("precision") === "CITY",
      };
    });
  }
  return [];
}

/** Примітка до точки маршруту: хто це і чи точна точка. */
export function prospectNote(p: ProspectHit): string {
  const what = [p.category ? `категорія ${p.category}` : null, p.specialization].filter(Boolean).join(", ");
  return (
    `потенційний клієнт (ромб на карті)${what ? `, ${what}` : ""}` +
    (p.approximate ? "; точка лише до населеного пункту — магазин шукати на місці" : "")
  );
}
