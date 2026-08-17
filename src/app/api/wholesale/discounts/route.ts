import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBrandDiscounts } from "@/lib/wholesale-pricing";

export const dynamic = "force-dynamic";

/**
 * Знижки по брендах для оптовика — щоб каталог міг кешуватись без сесії.
 *
 * Раніше оптову ціну рахував сервер прямо в сторінці каталогу, але для
 * цього їй потрібна була сесія, а читання cookies мовчки вимикає ISR —
 * усі 98% роздрібних відвідувачів чекали повний рендер заради 2%
 * оптовиків. Тепер сторінка кешується для всіх, а оптовик добирає свою
 * знижку цим запитом уже після гідрації.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "WHOLESALE") {
    return NextResponse.json({ wholesale: false, discounts: {} });
  }
  const map = await getBrandDiscounts();
  return NextResponse.json(
    { wholesale: true, discounts: Object.fromEntries(map) },
    // Знижки міняються з адмінки нечасто — хвилинний приватний кеш знімає
    // повторні запити при навігації між сторінками каталогу.
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
