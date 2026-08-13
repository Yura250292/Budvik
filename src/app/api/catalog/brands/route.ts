import { NextResponse } from "next/server";
import { getBrandTree, getBrandTypes } from "@/lib/catalog/brand-tree";

/**
 * Структура каталогу для клієнтських екранів.
 *
 * Публічний роут без перевірки ролі: каталог відкритий усім, а бренд і
 * кількість позицій — те саме, що видно на сторінці. `?brand=<slug>` додає
 * групи товарів усередині бренда.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const brand = searchParams.get("brand");

  if (brand) {
    const types = await getBrandTypes(brand);
    return NextResponse.json({ types });
  }

  const tree = await getBrandTree();
  return NextResponse.json(tree);
}
