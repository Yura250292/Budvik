/**
 * Дерево брендів — навігація каталогу в застосунку.
 *
 * Бренд, а не категорія: 84% товарів лежать у звалищі «Імпорт з 1С», решта
 * службових груп називається числами, тож категорійне дерево з 1С покупцю
 * нічого не пояснює. Бренд заповнений майже скрізь.
 *
 * Логіка та сама, що в /api/catalog/brands; окремий роут потрібен тому, що
 * застосунок ходить лише під префіксом /api/v1/ — саме він внесений у
 * правило bypass фаєрвола, і кожен виняток поза ним довелося б заводити руками.
 */

import { NextResponse } from "next/server";
import { getBrandTree, getBrandTypes } from "@/lib/catalog/brand-tree";

/** Структура каталогу змінюється не частіше, ніж приїжджає обмін із 1С. */
export const revalidate = 3600;

export async function GET(req: Request) {
  const brand = new URL(req.url).searchParams.get("brand");

  if (brand) {
    return NextResponse.json({ types: await getBrandTypes(brand) });
  }

  return NextResponse.json(await getBrandTree());
}
