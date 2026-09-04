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
 * Основа слова: відкидаємо закінчення, щоб «Кунанця» знайшло «Кунанець».
 *
 * Два символи від шести — саме стільки з'їдають українські закінчення з
 * чергуванням (Кунанець → Кунанця), один — від чотирьох. Менші слова не
 * чіпаємо: від «Біб» після обрізання лишиться шум.
 */
function stem(word: string): string {
  if (word.length >= 6) return word.slice(0, -2);
  if (word.length >= 4) return word.slice(0, -1);
  return word;
}

export async function findClients(
  query: string,
  repId: string,
  { limit = 8, onlyMine = false }: { limit?: number; onlyMine?: boolean } = {}
): Promise<ClientHit[]> {
  /**
   * Кожне слово окремо — і кожне обрізане до основи.
   *
   * Дві різні причини, обидві з бойових даних. Перша: торговий пише «Химич
   * Мар'ян», а в 1С контрагент зветься «ФОП Химич Мар'ян Мар'янович» —
   * суцільний підрядок не збігається. Друга: питання ставлять у непрямому
   * відмінку («до Химича», «винен Кунанець»), а в базі лежить називний,
   * тож навіть послівний пошук нічого не знаходив.
   */
  const words = query
    .split(/\s+/)
    .map((w) => w.replace(/[%_]/g, "").trim())
    .filter((w) => w.length >= 2)
    .slice(0, 5);
  const patterns = (words.length ? words : [query]).map((w) => `%${stem(w)}%`);
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
