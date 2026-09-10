/**
 * Пошук клієнта за назвою — спільний для інструмента моделі й для
 * відповідей, які складає код.
 *
 * Портфель торгового позначаємо прапорцем, а не фільтром: питання «а що з
 * цим магазином» виникає і про чужого клієнта, і відповідь «не знайдено»
 * там була б неправдою.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { myClientsCte } from "@/lib/assistant/facts/sql";
import { searchPatterns } from "@/lib/assistant/facts/search-words";

export type ClientHit = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  phone: string | null;
  mine: boolean;
  lastDocAt: Date | null;
};

/**
 * Один клієнт зі списку збігів — там, де спитати «котрий із них?» не можна.
 *
 * Маршрут збирається з десятка імен одразу; зупинити людину списком
 * однофамільців на другому імені означало б змусити її диктувати весь
 * перелік заново. Тому правило те саме, що й у решті пошуку: свій клієнт
 * із документами перемагає однофамільця з чужого портфеля, а серед чужих
 * береться той, хто взагалі щось купував. Кілька збігів без жодного
 * документа — null: такого вибору робити не варто, і викликач має сказати
 * «не впізнав».
 */
export function pickOneClient(hits: ClientHit[]): ClientHit | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  const mine = hits.filter((h) => h.mine && h.lastDocAt);
  if (mine.length >= 1) return mine[0];
  const withDocs = hits.filter((h) => h.lastDocAt);
  return withDocs.length >= 1 ? withDocs[0] : null;
}

export async function findClients(
  query: string,
  repId: string,
  opts: { limit?: number; onlyMine?: boolean } = {}
): Promise<ClientHit[]> {
  const rows = await search(query, repId, opts, 0);
  /**
   * Друга спроба з коротшою основою.
   *
   * «Що з Кунанцем» не знаходило нікого: основа «Кунанц» не збігається з
   * «Кунанець» через випадну голосну. Одразу різати глибше не можна —
   * тоді «Ремонт» знаходить пів бази, — тож глибше йдемо лише тоді, коли
   * перший пошук повернув порожнечу.
   */
  if (rows.length > 0) return rows;
  return search(query, repId, opts, 1);
}

async function search(
  query: string,
  repId: string,
  { limit = 8, onlyMine = false }: { limit?: number; onlyMine?: boolean },
  cut: number
): Promise<ClientHit[]> {
  // Послівно й по основах — див. search-words.ts.
  const patterns = searchPatterns(query, 5, cut);
  const whole = `%${query.replace(/[%_]/g, "")}%`;

  return prisma.$queryRaw<ClientHit[]>`
    WITH ${myClientsCte(repId)}
    SELECT
      c.id, c.name, c.code, c.address, c.phone,
      (c.id IN (SELECT id FROM my_clients)) AS mine,
      (SELECT MAX(s."createdAt") FROM "SalesDocument" s
        WHERE s."counterpartyId" = c.id AND s."docType" <> 'RETURN') AS "lastDocAt"
    FROM "Counterparty" c
    WHERE (
        c.name ILIKE ALL(${patterns}::text[])
        OR c.code ILIKE ${whole}
        OR c."contactPerson" ILIKE ${whole}
        -- Адреса теж: місто в 1С пишуть де завгодно, і «Сокільники»
        -- частіше стоїть саме там, а не в назві.
        OR c.address ILIKE ALL(${patterns}::text[])
      )
      ${onlyMine ? Prisma.sql`AND c.id IN (SELECT id FROM my_clients)` : Prisma.empty}
    ORDER BY
      (c.id IN (SELECT id FROM my_clients)) DESC,
      c."isActive" DESC,
      (SELECT MAX(s."createdAt") FROM "SalesDocument" s
        WHERE s."counterpartyId" = c.id AND s."docType" <> 'RETURN') DESC NULLS LAST
    LIMIT ${limit}
  `;
}
