/**
 * Пошук товару за кодом, знятим камерою.
 *
 * Драбина з трьох шарів, і кожен працює незалежно від решти:
 *
 *  1. Власний QR — це просто посилання на картку (https://www.budvik27.com/
 *     catalog/{slug}). Працює з першого дня, і той самий цінник лишається
 *     корисним людині без застосунку: у неї відкриється сторінка в браузері.
 *  2. Артикул із власної етикетки — точний збіг по sku.
 *  3. Штрихкод виробника — масив Product.barcodes, який наповнює обмін з 1С.
 *     Поки 1С їх не віддає, шар мовчить і нікому не заважає.
 *
 * Триграмного пошуку тут свідомо НЕМАЄ. rescueSearch робить similarity()-скан
 * по всій таблиці; сканер, який годує в нього кожен нерозпізнаний EAN, влаштує
 * такий скан на кожен промах — а промахи в сканера рядові, не виняткові.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRealSku } from "@/lib/catalog/sku-search";
import { CARD_SELECT } from "@/lib/catalog/query";
import { serializeCard } from "@/lib/shop/api";
import { SITE_URL } from "@/lib/seo/site";

/** Скільки показати, якщо точного збігу немає, але щось схоже знайшлось. */
const FALLBACK_TAKE = 10;

/**
 * Slug із власного QR.
 *
 * Приймаємо і www, і голий домен: QR друкувалися в різний час, а голий домен
 * на сайті лише 308-редіректить — тут же редіректу немає кому виконати.
 */
function slugFromUrl(raw: string): string | null {
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== new URL(SITE_URL).hostname.replace(/^www\./, "")) return null;
    const m = url.pathname.match(/^\/catalog\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const code = (new URL(req.url).searchParams.get("code") || "").trim();
  if (!code) {
    return NextResponse.json({ error: "Порожній код" }, { status: 400 });
  }

  // Шар 1: власний QR.
  const slug = slugFromUrl(code);
  if (slug) {
    const bySlug = await prisma.product.findUnique({ where: { slug }, select: CARD_SELECT });
    if (bySlug) return NextResponse.json({ match: "qr", product: serializeCard(bySlug) });
  }

  // Шар 3 перед шаром 2: штрихкод виробника однозначніший за артикул, який у
  // різних постачальників буває однаковим.
  const byBarcode = await prisma.product.findFirst({
    where: { barcodes: { has: code } },
    select: CARD_SELECT,
  });
  if (byBarcode) {
    return NextResponse.json({ match: "barcode", product: serializeCard(byBarcode) });
  }

  // Шар 2: артикул. isRealSku відсіює ~11 тис. згенерованих заглушок «1C-…» —
  // без нього сканер міг би «впізнати» службовий рядок як товар.
  if (isRealSku(code)) {
    const bySku = await prisma.product.findFirst({
      where: { sku: { equals: code, mode: "insensitive" } },
      select: CARD_SELECT,
    });
    if (bySku) return NextResponse.json({ match: "sku", product: serializeCard(bySku) });
  }

  /**
   * Промах не має бути глухим кутом: людина стоїть із коробкою в руках.
   * Показуємо, що знайшлося за початком артикула, і чесно кажемо, що точного
   * збігу немає — застосунок покаже це списком, а не помилкою.
   */
  const fallback = await prisma.product.findMany({
    where: { isActive: true, price: { gt: 0 }, sku: { startsWith: code, mode: "insensitive" } },
    select: CARD_SELECT,
    orderBy: [{ stock: "desc" }],
    take: FALLBACK_TAKE,
  });

  return NextResponse.json({
    match: "none",
    /** Сирий код — щоб застосунок міг запропонувати звичайний пошук цим рядком. */
    code,
    fallback: fallback.map(serializeCard),
  });
}
