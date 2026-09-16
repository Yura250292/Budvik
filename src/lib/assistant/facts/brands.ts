/**
 * Бренд із питання: «по фірмі СИЛА», «гроссер», «сігма», «dnipro m».
 *
 * Раніше інструменти шукали бренд одним `name contains` — і промахувались
 * саме там, де керівник говорить, а не пише: «Гроссер» не знаходив
 * «Grösser», «сігма» — «SIGMA», «Сила» знаходила «СИЛА», але «Силу» —
 * ні. А на «бриг» `findFirst` мовчки брав першого з трьох «Бригадирів».
 *
 * Правило те саме, що для людей (facts/staff.ts): НЕ ВГАДУЄМО. Один збіг —
 * беремо, кілька — повертаємо варіанти, жодного — кажемо, що такого немає.
 *
 * Як порівнюємо. Обидві сторони зводимо до латиниці без діакритики й
 * розділових знаків: «Grösser» → «grosser», «Гроссер» → «hrosser» і
 * «grosser» (г читається обома способами), «СИЛА» → «syla» і «sila». Далі
 * три кроки, кожен лише коли попередній порожній: повна рівність назви чи
 * підказки бренду → назва починається з запиту → запит довше 3 знаків і є
 * підрядком назви. Відмінок знімаємо окремо: «Силі», «Сигми», «Полаксу».
 */

import { prisma } from "@/lib/prisma";

export type BrandRow = { id: string; name: string; products: number };

export type BrandMatch =
  | { ok: true; brand: BrandRow }
  | { ok: false; reason: "ambiguous" | "none"; candidates: BrandRow[] };

const CACHE_MS = 5 * 60_000;
let cache: { at: number; rows: Array<BrandRow & { keys: string[] }> } | null = null;

const CYR: Record<string, string[]> = {
  а: ["a"], б: ["b"], в: ["v", "w"], г: ["h", "g"], ґ: ["g"], д: ["d"], е: ["e"], є: ["ye", "e"],
  ж: ["zh"], з: ["z"], и: ["y", "i"], і: ["i"], ї: ["yi", "i"], й: ["y", "i"], к: ["k", "c"], л: ["l"],
  м: ["m"], н: ["n"], о: ["o"], п: ["p"], р: ["r"], с: ["s"], т: ["t"], у: ["u"], ф: ["f"],
  х: ["kh", "h"], ц: ["ts", "c"], ч: ["ch"], ш: ["sh"], щ: ["shch"], ь: [""], ю: ["yu", "u"], я: ["ya", "a"],
  ы: ["y"], э: ["e"], ё: ["e"], "'": [""], "ʼ": [""], "’": [""],
};

/** «Grösser» → «grosser», «DNIPRO-M» → «dniprom». */
function latin(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґыэё]/g, "");
}

/**
 * Усі латинські прочитання слова — щонайбільше 16, щоб «щ» з «х» не
 * розмножили варіанти до сотень.
 */
function readings(value: string): string[] {
  let out = [""];
  for (const ch of latin(value)) {
    const options = CYR[ch] ?? [ch];
    const next: string[] = [];
    for (const prefix of out) for (const o of options) next.push(prefix + o);
    out = [...new Set(next)].slice(0, 16);
  }
  // «кс» і «x» — одне й те саме в назвах брендів (Полакс / POLAX).
  return [...new Set(out.flatMap((r) => [r, r.replace(/ks/g, "x"), r.replace(/cs/g, "x")]))];
}

/** Відмінки української назви: «Силі», «Сигми», «Полаксу», «Гроссером». */
const CASE_ENDINGS = /(ом|ем|ою|ею|ові|еві|у|ю|і|и|а|я|е)$/i;

async function allBrands() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = await prisma.brand.findMany({
    select: { id: true, name: true, matchPatterns: true, _count: { select: { products: true } } },
  });
  const mapped = rows
    .filter((r) => r._count.products > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      products: r._count.products,
      keys: [...new Set([r.name, ...r.matchPatterns].map((k) => k.trim()).filter(Boolean).flatMap(readings))],
    }));
  cache = { at: Date.now(), rows: mapped };
  return mapped;
}

export async function resolveBrand(query: string): Promise<BrandMatch> {
  const raw = query.trim().replace(/^(бренд[уаи]?|фірм[аиіу]|виробник[аи]?|марк[аиі])\s+/i, "");
  const brands = await allBrands();
  const pick = (rows: typeof brands): BrandMatch | null => {
    if (rows.length === 0) return null;
    const list = [...rows].sort((a, b) => b.products - a.products).map(({ id, name, products }) => ({ id, name, products }));
    return list.length === 1 ? { ok: true, brand: list[0] } : { ok: false, reason: "ambiguous", candidates: list.slice(0, 6) };
  };

  const words = [raw, raw.replace(CASE_ENDINGS, "")].filter((w, i, a) => latin(w).length >= 2 && a.indexOf(w) === i);
  for (const word of words) {
    const q = readings(word);

    const exact = brands.filter((b) => b.keys.some((k) => q.includes(k)));
    const exactHit = pick(exact);
    // Повна рівність із кількома брендами («USH» і «USH Industry» дають
    // лише один точний) — беремо точний, а не питаємо.
    if (exactHit) return exactHit;

    const prefix = brands.filter((b) => b.keys.some((k) => q.some((r) => r.length >= 3 && k.startsWith(r))));
    const prefixHit = pick(prefix);
    if (prefixHit) return prefixHit;

    const inside = brands.filter((b) => b.keys.some((k) => q.some((r) => r.length >= 4 && k.includes(r))));
    const insideHit = pick(inside);
    if (insideHit) return insideHit;
  }
  return { ok: false, reason: "none", candidates: [] };
}

/** Відповідь інструмента, коли бренд не розв'язався. */
export function brandProblem(match: Exclude<BrandMatch, { ok: true }>, query: string) {
  return {
    помилка:
      match.reason === "ambiguous"
        ? `Під «${query}» підходить кілька брендів — покажіть варіанти й попросіть уточнити`
        : `Бренду «${query}» у базі немає`,
    варіанти: match.candidates.map((c) => ({ бренд: c.name, товарів: c.products })),
  };
}
