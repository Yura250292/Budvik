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

export async function findClients(
  query: string,
  repId: string,
  { limit = 8, onlyMine = false }: { limit?: number; onlyMine?: boolean } = {}
): Promise<ClientHit[]> {
  // Послівно й по основах — див. search-words.ts.
  const patterns = searchPatterns(query, 5);
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
