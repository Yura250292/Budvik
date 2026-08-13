/**
 * Безкоштовні джерела фото товарів.
 *
 * Google Search grounding коштує $35 за 1000 запитів — на 23 097 товарів без
 * фото це ~35 тис. грн. Тому спершу вичерпуємо те, за що платити не треба:
 * старий сайт budvik.com і пошук в українських магазинах звичайним HTTP.
 *
 * Заміряно, що працює, а що ні:
 *   budvik.com (сайтмапи) — 10 201 фото, але майже все вже перенесене;
 *                           непокритим товарам дає лише ~220 збігів;
 *   epicentrk.ua          — віддає HTML з фото на прямий пошук, різні
 *                           артикули дають різні картинки. Основне джерело;
 *   prom.ua               — HTML без товарів (рендерить скриптом), у пошуку
 *                           знаходиться лише банер сайту. Не використовуємо;
 *   rozetka.com.ua        — 403 на серверні запити. Не використовуємо;
 *   yato.pl / yato.ua     — редирект на toya24.pl і 404 за артикулом.
 *
 * Знайдене звіряємо зором (див. enrich.ts): пошук за артикулом легко
 * повертає сусідню модель того ж бренда, а чуже фото в каталозі гірше за
 * порожнє місце.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export interface FreeHit {
  url: string;
  source: string;
}

/** Артикул із 1С без справжнього коду — для пошуку марний. */
export function realSku(sku: string | null): string {
  return sku && !sku.startsWith("1C-") ? sku : "";
}

/**
 * Пошук в Епіцентрі.
 *
 * Беремо перше фото товару з видачі. `cdn.NN.ua/original/...` — повний
 * розмір; варіанти з числом у першому сегменті це прев'ю, вони теж годяться,
 * але великий файл краще виглядає на планшеті торгового.
 */
export async function searchEpicentr(query: string, take = 3): Promise<FreeHit[]> {
  try {
    const res = await fetch(`https://epicentrk.ua/ua/search/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const all = html.match(/https:\/\/cdn\.\d+\.ua\/[^"'\\ ]+\.(?:jpe?g|png|webp)/gi) || [];

    // Службова графіка магазину — не товар.
    const goods = all.filter((u) => !/sc--media--prod|\/default\/|logo|icon|banner/i.test(u));
    if (goods.length === 0) return [];

    // Видача містить 27–40 картинок, і перша не обов'язково та: поруч із
    // результатами йдуть «схожі» і «популярні». Тому повертаємо кілька
    // кандидатів — перевірка зором сама відбере той, що збігається.
    //
    // Один товар присутній у кількох розмірах (/190/…, /799/…, /original/…),
    // тож групуємо за ідентифікатором файлу і беремо по одному варіанту.
    const seen = new Set<string>();
    const out: FreeHit[] = [];
    for (const url of goods) {
      const id = url.split("/").pop() || url;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ url, source: "Епіцентр" });
      if (out.length >= take) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Фото зі старого сайту budvik.com за сайтмапами.
 *
 * Індекс будується один раз на прогін: 11 сайтмапів по 1000 позицій.
 * Ключ — транслітерована назва без розділювачів, бо slug у нашій базі й
 * URL старого сайту будуються різними правилами (точний збіг по slug дав
 * лише 5 позицій із 23 097, по транслітерації назви — 105, а з нечітким
 * зіставленням — близько 220).
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
  з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ъ: "",
};

function translit(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((c) => TRANSLIT[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(translit(s).split(/\s+/).filter((t) => t.length > 1));
}

export interface OldSiteIndex {
  items: { img: string; tokens: Set<string> }[];
  /** Рідкісні токени → позиції, щоб не порівнювати 23k×10k напряму. */
  byToken: Map<string, number[]>;
  size: number;
}

export async function buildOldSiteIndex(): Promise<OldSiteIndex> {
  const items: { img: string; tokens: Set<string> }[] = [];

  for (let i = 1; i <= 11; i++) {
    const n = String(i).padStart(2, "0");
    try {
      const res = await fetch(
        `https://budvik.com/content/export/budvik.com/catalog-sitemap-${n}.xml`,
        { signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) continue;
      const xml = await res.text();

      for (const block of xml.split("<url>").slice(1)) {
        const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
        const img = block.match(/<image:loc>([^<]+)<\/image:loc>/)?.[1];
        if (!loc || !img) continue;

        const slug = (loc.split("/").filter(Boolean).pop() || "").replace(/-/g, " ");
        const t = new Set(slug.split(/\s+/).filter((x) => x.length > 1));
        if (t.size > 0) items.push({ img, tokens: t });
      }
    } catch {
      // сайтмап недоступний — рухаємось далі, це не привід валити прогін
    }
  }

  const byToken = new Map<string, number[]>();
  items.forEach((it, i) => {
    for (const t of it.tokens) {
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t)!.push(i);
    }
  });

  return { items, byToken, size: items.length };
}

/** Схожість Жаккара: частка спільних токенів. */
function similarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Знайти фото товару в індексі старого сайту.
 *
 * Поріг 0.75 підібрано за пробним прогоном: нижче починають з'являтися
 * сусідні моделі того ж бренда (той самий набір слів, інший розмір).
 */
export function matchOldSite(name: string, idx: OldSiteIndex, minScore = 0.75): FreeHit | null {
  const pt = tokens(name);
  if (pt.size === 0) return null;

  const candidates = new Set<number>();
  for (const t of pt) {
    const list = idx.byToken.get(t);
    // Надто частий токен («apro», «nabir») кандидатів не звужує.
    if (list && list.length < 400) list.forEach((i) => candidates.add(i));
  }

  let best = 0;
  let bestImg = "";
  for (const i of candidates) {
    const s = similarity(pt, idx.items[i].tokens);
    if (s > best) {
      best = s;
      bestImg = idx.items[i].img;
    }
  }

  return best >= minScore ? { url: bestImg, source: "budvik.com (архів)" } : null;
}
