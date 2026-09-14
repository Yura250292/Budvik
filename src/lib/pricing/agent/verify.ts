/**
 * Чи називає сторінка наш артикул — єдина підстава прийняти адресу від агента.
 *
 * Дивимось лише в «паспорт» сторінки: адреса, <title>, <h1>, og:title, опис і
 * JSON-LD товару (name, sku, mpn, model). Не в усе тіло: нижче стоять «схожі
 * товари» й аксесуари зі своїми артикулами, і наш знайшовся б і там.
 *
 * Артикул звіряємо цілими словами: «GCD 520» не повинна прийняти сторінку
 * «GCD 520T». Роздільники не важать — «76836-000» збігається з «76836000».
 */

const HOMOGLYPHS: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", І: "I",
};

/** Великі латинські літери й цифри, решта — пробіли. Кирилиця-двійник стає латиницею. */
function normText(s: string): string {
  return s
    .normalize("NFC")
    .toUpperCase()
    .replace(/[АВЕКМНОРСТУХІ]/g, (c) => HOMOGLYPHS[c] ?? c)
    .replace(/Ö/g, "O")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Шаблон артикулу. null — артикул закороткий, щоб ним щось перевіряти
 * («1-01», «S2»): такий збігся б із чим завгодно.
 *
 * Хвіст-код імпортера («g0346» у Grösser) і слово «каркас» прибираємо: на
 * сторінці магазину їх немає, а модель є.
 */
export function articlePattern(sku: string): RegExp | null {
  const cleaned = sku.replace(/\bg\d{4}\b/gi, " ").replace(/каркас|karkas/gi, " ");
  const tokens = normText(cleaned).split(" ").filter(Boolean);
  const compact = tokens.join("");
  if (compact.length < 5 || !/\d/.test(compact)) return null;
  return new RegExp(`(?:^| )${tokens.map(escapeRe).join(" ?")}(?: |$)`);
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");

function meta(html: string, prop: string): string | null {
  return (
    html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i"))?.[1] ??
    null
  );
}

function jsonLdProductFields(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o: unknown): void => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(walk);
        const rec = o as Record<string, unknown>;
        const t = rec["@type"];
        if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) {
          for (const k of ["name", "sku", "mpn", "model", "gtin13"]) if (typeof rec[k] === "string") out.push(rec[k] as string);
        }
        if (rec["@graph"]) walk(rec["@graph"]);
      };
      walk(JSON.parse(m[1].trim().replace(/^﻿/, "")));
    } catch {
      /* битий JSON-LD — не привід відкидати всю сторінку */
    }
  }
  return out;
}

/** Назва сторінки для показу адміну. */
export function pageTitle(html: string): string | null {
  const raw =
    meta(html, "og:title") ??
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    null;
  const text = raw ? decode(raw).replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, 200) : null;
}

export function pageNamesArticle(html: string, url: string, sku: string): boolean {
  const re = articlePattern(sku);
  if (!re) return false;
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    /* дивна адреса — перевіримо як є */
  }
  const parts = [
    path,
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1],
    meta(html, "og:title"),
    meta(html, "description"),
    ...jsonLdProductFields(html),
  ];
  return parts.some((p) => typeof p === "string" && re.test(` ${normText(decode(p))} `));
}
