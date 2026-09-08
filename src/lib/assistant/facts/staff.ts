/**
 * Довідник людей фірми: хто є, і хто саме мався на увазі.
 *
 * У помічника керівника майже кожне питання містить прізвище: «скільки
 * продав Кулик», «де Пайда», «зарплата Кравцова». Промах тут коштує
 * дорожче за промах у товарі: керівник ухвалює за цією відповіддю
 * рішення про людину, і показати їй чужі числа гірше, ніж не показати
 * жодних.
 *
 * Тому правило одне: НІКОЛИ не вгадуємо. Збігів кілька або жодного —
 * повертаємо варіанти, а вибір лишаємо людині.
 *
 * Про склад команди. Ролі SALES у базі носять і польові торгові, і офіс,
 * який виписує документи на себе (перевірено 07.09.2026: жодного
 * SalesRepRegion немає ні в кого, тож відрізнити їх ознакою в базі
 * неможливо). Викидати офіс не можна — їхній оборот з 1С справжній, — і
 * саме тому у відповідях стоїть окрема примітка, а не мовчазний фільтр.
 */

import { prisma } from "@/lib/prisma";
import { stem, translit } from "@/lib/assistant/facts/search-words";

export type StaffRole = "SALES" | "DRIVER" | "WAREHOUSE";

export type Staff = { id: string; name: string; role: StaffRole };

export const ROLE_WORD: Record<StaffRole, string> = {
  SALES: "торговий",
  DRIVER: "водій",
  WAREHOUSE: "складовщик",
};

/**
 * Список людей кешується на пʼять хвилин.
 *
 * Він потрібен майже кожному інструменту керівника — і як довідник імен,
 * і як перелік для таблиці, — а міняється раз на місяці.
 */
const CACHE_MS = 5 * 60_000;
let cache: { at: number; rows: Staff[] } | null = null;

async function allStaff(): Promise<Staff[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = await prisma.user.findMany({
    where: { role: { in: ["SALES", "DRIVER", "WAREHOUSE"] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name ?? "",
    role: r.role as StaffRole,
  }));
  cache = { at: Date.now(), rows: mapped };
  return mapped;
}

export async function listStaff(roles: StaffRole[]): Promise<Staff[]> {
  const all = await allStaff();
  return all.filter((s) => roles.includes(s.role));
}

/** Скинути кеш — для скриптів і тестів. */
export function resetStaffCache() {
  cache = null;
}

export type StaffMatch =
  | { ok: true; user: Staff }
  | { ok: false; reason: "none" | "ambiguous"; candidates: Staff[] };

/** Слова запиту без сміття: «у Кулика», «по Пайді». */
function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[«»"'’`.,!?]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !/^(торгов|воді|склад|мене|нього|нашого|фірм)/.test(w))
    .slice(0, 3);
}

/**
 * Хто саме мався на увазі.
 *
 * Питання ставлять у непрямому відмінку («у Кулика», «Пайді»), а в базі
 * лежить називний, тож порівнюємо основи. Друга спроба з коротшою
 * основою — лише коли перша не дала нічого: інакше «Дмитро» знайшов би
 * половину відділу і відповідь пішла б не про ту людину.
 */
export async function resolveStaff(query: string, roles: StaffRole[]): Promise<StaffMatch> {
  const pool = await listStaff(roles);
  const words = queryWords(query);
  if (words.length === 0 || pool.length === 0) return { ok: false, reason: "none", candidates: [] };

  const hit = (person: Staff, cut: number) => {
    const parts = person.name.toLowerCase().split(/\s+/).filter(Boolean);
    return words.some((w) =>
      parts.some((part) => {
        const base = stem(w, cut);
        if (base.length < 3) return false;
        return part.startsWith(base) || translit(part).startsWith(translit(base));
      })
    );
  };

  for (const cut of [0, 1]) {
    const found = pool.filter((p) => hit(p, cut));
    if (found.length === 1) return { ok: true, user: found[0] };
    if (found.length > 1) return { ok: false, reason: "ambiguous", candidates: found.slice(0, 8) };
  }

  return { ok: false, reason: "none", candidates: [] };
}

/**
 * Відповідь інструмента, коли ім'я не розв'язалося.
 *
 * Це не помилка виконання, а дані: модель мусить показати варіанти
 * керівникові, а не обрати за нього.
 */
export function staffProblem(
  match: Exclude<StaffMatch, { ok: true }>,
  what: string
): { помилка: string; варіанти: Array<{ id: string; ім_я: string; роль: string }> } {
  return {
    помилка:
      match.reason === "ambiguous"
        ? `Під це ім'я підходить кілька людей — покажіть варіанти й попросіть уточнити`
        : `Такого ${what} у базі немає`,
    варіанти: match.candidates.map((c) => ({ id: c.id, ім_я: c.name, роль: ROLE_WORD[c.role] })),
  };
}

/**
 * Чий це клієнт.
 *
 * Потрібно там, де порада рахується від ПОРТФЕЛЯ торгового: «з чим
 * заходити» бере гачки з того, що беруть сусідні клієнти цієї людини, і
 * від імені керівника (порожній портфель) вийшла б порожня порада.
 *
 * Спершу закріплення, потім останній документ: закріплення — це рішення
 * офісу, документ — факт. orderBy обов'язковий: клієнт може бути
 * закріплений за кількома, і findFirst без порядку віддає довільного.
 */
export async function ownerRepOf(
  counterpartyId: string
): Promise<{ id: string; name: string } | null> {
  const pinned = await prisma.salesRepClient.findFirst({
    where: { counterpartyId },
    orderBy: { id: "asc" },
    select: { salesRep: { select: { id: true, name: true } } },
  });
  if (pinned?.salesRep) {
    return { id: pinned.salesRep.id, name: pinned.salesRep.name ?? "" };
  }

  const last = await prisma.salesDocument.findFirst({
    // Лише проведені: відколи склад бачить накладну ще в наборі, чернетка
    // з confirmedAt = null ставала б «останнім документом» (у Postgres DESC
    // кладе NULL першими) і перекидала б клієнта на чужого торгового.
    where: {
      counterpartyId,
      docType: "REALIZATION",
      status: "CONFIRMED",
      salesRepId: { not: null },
    },
    orderBy: { confirmedAt: "desc" },
    select: { salesRep: { select: { id: true, name: true } } },
  });
  return last?.salesRep ? { id: last.salesRep.id, name: last.salesRep.name ?? "" } : null;
}
