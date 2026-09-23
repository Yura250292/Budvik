/**
 * Як людина пише клієнта, а як його завела 1С — спільне правило для всіх
 * пошуків контрагента: помічника, редактора маршрутів, клієнтів у місті.
 *
 * Розходиться три речі, і кожна окремо вбиває збіг підрядком (23.09.2026,
 * «Яцків не знайдено», хоча в базі «Яцьків»):
 *
 *   - мʼякий знак і апостроф: «Яцків» не підрядок «Яцьків», а апостроф
 *     1С пише трьома символами — «Мар'яна», «Мар`ян», «Марʼяна»;
 *   - розділові знаки прилипають до слова: «(Перемишляни)» шукалося як
 *     «(Перемишлян», а в назві «(м.Перемишляни)»;
 *   - позначки «м.», «смт» — обовʼязкове слово там, де в назві їх нема.
 *
 * Мʼякий знак і апостроф прибираються з ОБОХ боків: із запиту тут, із
 * назви — в SQL через `translate(…, LOOSE_CHARS, '')`.
 *
 * Лише для контрагентів. У товарах мʼякий знак — частина слова («Кельма»),
 * і та сама чистка там зламала б те, що працює.
 */

import { prisma } from "@/lib/prisma";
import { searchPatterns } from "@/lib/assistant/facts/search-words";

export const LOOSE_CHARS = "ьЬ'ʼ`’´";
const LOOSE_RE = /[ьЬ'ʼ`’´]/g;

/** Позначки населеного пункту — у назві 1С вони є не завжди. */
const SETTLEMENT = new Set(["м", "с", "смт", "сел", "село", "місто", "селище", "пгт", "р-н", "район", "обл"]);

/** «Яцків Іван Теодорович (м. Перемишляни)» → «Яцків Іван Теодорович Перемишляни». */
export function clientQuery(query: string): string {
  return query
    .replace(LOOSE_RE, "")
    .replace(/[()[\]«»"“”„,;:!?.]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SETTLEMENT.has(w.toLowerCase()))
    .join(" ");
}

/** Той самий рядок без мʼякого знака й апострофа — для порівняння в коді. */
export function loose(text: string): string {
  return text.replace(LOOSE_RE, "").toLowerCase();
}

/**
 * Контрагенти, у яких КОЖНЕ слово запиту є хоч в одному полі картки.
 *
 * Для редактора маршрутів: «прізвище + село», де село може стояти і в
 * назві, і в адресі. Слова — основи (відмінок «у Перемишлянах» теж
 * знаходить), і лише коли точна спроба порожня, основа коротшає на букву:
 * «Кунанцем» → «Кунанець». Порядок — справа викликача.
 */
export async function counterpartyIdsByWords(query: string, take: number): Promise<string[]> {
  const cleaned = clientQuery(query);
  if (!cleaned) return [];
  for (const cut of [0, 1]) {
    const patterns = searchPatterns(cleaned, 5, cut);
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM "Counterparty" c
      WHERE translate(
              concat_ws(' ', c.name, c.address, c."deliveryAddress", c."contactPerson", c.code),
              ${LOOSE_CHARS}, ''
            ) ILIKE ALL(${patterns}::text[])
      LIMIT ${take}
    `;
    if (rows.length > 0) return rows.map((r) => r.id);
  }
  return [];
}
