/**
 * Словник для розпізнавання: імена команди й назви активних клієнтів.
 *
 * Розпізнавач без підказки пише «Кунанець» як «кунан єць», а «Химич» як
 * «хімік». AssemblyAI приймає список слів, які варто чути, — даємо йому людей
 * з персоналу й клієнтів, з якими реально працювали останні два місяці: саме
 * про них і говорять на нараді.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { prisma } from "@/lib/prisma";
import { STAFF_ROLE_LIST } from "./types";

const MAX_TERMS = 100;
const CLIENTS = 60;
const CLIENT_DAYS = 60;

/** Лише літери, цифри, пробіл, апостроф і дефіс; до шести слів — вимога AssemblyAI. */
function clean(term: string): string | null {
  const t = term
    .replace(/[«»"“”()[\]]/g, " ")
    .replace(/[^\p{L}\p{N}\s'’ʼ-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < 3) return null;
  return t.split(" ").slice(0, 6).join(" ");
}

/** «ФОП Химич Іван Петрович (Стрий)» → «Химич Іван». */
function clientTerm(name: string): string | null {
  const stripped = name
    .replace(/\(.*?\)/g, " ")
    .replace(/^\s*(ФОП|ТОВ|ТзОВ|ПП|ПрАТ|ПАТ|ЧП|ООО|СПД)\s+/i, "")
    .trim();
  return clean(stripped.split(/\s+/).slice(0, 2).join(" "));
}

export async function collectWordBoost(): Promise<string[]> {
  const [staff, clients] = await Promise.all([
    prisma.user.findMany({ where: { role: { in: [...STAFF_ROLE_LIST] } }, select: { name: true } }),
    prisma.$queryRaw<{ name: string }[]>`
      SELECT c.name
      FROM "Counterparty" c
      JOIN (
        SELECT "counterpartyId", COUNT(*) AS n
        FROM "SalesDocument"
        WHERE "counterpartyId" IS NOT NULL
          -- ::int обов'язково: Prisma шле число як bigint, а make_interval його не приймає.
          AND "createdAt" > now() - make_interval(days => ${CLIENT_DAYS}::int)
        GROUP BY "counterpartyId"
        ORDER BY n DESC
        LIMIT ${CLIENTS}
      ) top ON top."counterpartyId" = c.id
    `,
  ]);

  const terms = new Set<string>();
  for (const u of staff) {
    for (const word of u.name.split(/\s+/)) {
      const t = clean(word);
      if (t) terms.add(t);
    }
  }
  for (const c of clients) {
    const t = clientTerm(c.name);
    if (t) terms.add(t);
  }
  return [...terms].slice(0, MAX_TERMS);
}
