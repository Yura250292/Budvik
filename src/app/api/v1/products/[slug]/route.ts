/**
 * Картка товару для застосунку.
 *
 * На сайті картки в JSON немає взагалі — /catalog/[slug] це серверна
 * сторінка. Тут той самий набір полів плюс розбір опису на секції тим самим
 * splitDescription(), яким користується сторінка: характеристики й
 * комплектація мають виглядати однаково в браузері й у застосунку.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { splitDescription } from "@/lib/catalog/description-sections";
import { showableProductWhere } from "@/lib/catalog/showable";
import { CARD_SELECT } from "@/lib/catalog/query";
import { serializeCard } from "@/lib/shop/api";

/** Скільки схожих показувати під карткою. */
const RELATED_TAKE = 8;

export const revalidate = 300;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const product = await prisma.product.findUnique({
    where: { slug },
    select: {
      ...CARD_SELECT,
      description: true,
      brandId: true,
      categoryId: true,
      powerWatts: true,
      rpm: true,
      discDiameterMm: true,
      chuckMm: true,
      weightKg: true,
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Товар не знайдено" }, { status: 404 });
  }

  /**
   * Схожі — з того самого бренда, а не з категорії.
   *
   * 84% товарів лежать у звалищі «Імпорт з 1С», тож підбір за категорією дав
   * би випадковий набір: до дриля пропонувалися б шпалери. Бренд заповнений
   * у переважної більшості й тримає товар у межах одного виробника.
   */
  const related = product.brandId
    ? await prisma.product.findMany({
        where: {
          ...showableProductWhere(),
          brandId: product.brandId,
          NOT: { id: product.id },
        },
        select: CARD_SELECT,
        orderBy: [{ stock: "desc" }, { priority: "desc" }],
        take: RELATED_TAKE,
      })
    : [];

  const sections = splitDescription(product.description ?? "");

  return NextResponse.json({
    ...serializeCard(product),
    description: product.description ?? "",
    sections,
    specs: {
      powerWatts: product.powerWatts,
      rpm: product.rpm,
      discDiameterMm: product.discDiameterMm,
      chuckMm: product.chuckMm,
      weightKg: product.weightKg,
    },
    related: related.map(serializeCard),
  });
}
