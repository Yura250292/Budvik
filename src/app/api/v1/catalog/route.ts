/**
 * Каталог для застосунку.
 *
 * Тонка обгортка над тим самим fetchCatalogPage(), що обслуговує сторінку
 * /catalog: ті самі фільтри, те саме сортування, та сама рятувальна драбина
 * при порожній видачі (інша розкладка → триграми) і той самий кеш, який
 * скидає обмін з 1С. Власного запиту тут немає навмисно — інакше застосунок
 * і сайт з часом почали б показувати різні набори товарів на однакові фільтри.
 */

import { NextResponse } from "next/server";
import {
  parseFilters,
  fetchCatalogPage,
  CATALOG_PAGE_SIZE,
} from "@/lib/catalog/query";
import { serializeCard } from "@/lib/shop/api";

/** Стеля сторінки — та сама, що на сайті: далі йде нескінченний простір для роботів. */
const MAX_PAGE = 100;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filters = parseFilters(searchParams);
  const page = Math.min(
    MAX_PAGE,
    Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1)
  );

  const result = await fetchCatalogPage(filters, page);

  return NextResponse.json({
    items: result.products.map(serializeCard),
    total: result.total,
    page,
    pageSize: CATALOG_PAGE_SIZE,
    totalPages: Math.ceil(result.total / CATALOG_PAGE_SIZE),
    // Ознака, що точний пошук нічого не дав і це результат рятувальної спроби:
    // застосунок має сказати «точного збігу немає, ось схоже», а не вдавати,
    // що знайшов саме те, що просили.
    isFuzzy: "isFuzzy" in result ? result.isFuzzy : false,
  });
}
