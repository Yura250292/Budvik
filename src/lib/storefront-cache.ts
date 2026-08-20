import { revalidatePath, revalidateTag } from "next/cache";
import { CATEGORIES_CACHE_TAG } from "@/lib/categories-cache";
import { CATALOG_CACHE_TAG } from "@/lib/catalog/brand-tree";

/**
 * Скидає кеш вітрини після обміну з 1С.
 *
 * Єдине місце, де перелічено, що саме протухає від нових даних. Викликається
 * з двох боків: маршрутом `complete` (коли обмін іде через Vercel) і
 * маршрутом `/api/revalidate` (коли обмін приймає воркер на Railway і не може
 * викликати `revalidate*` сам — ці функції працюють лише всередині Next).
 *
 * Тротл — не тут, а у викликача (`CACHE_BUST_INTERVAL_MS` у sync-ingest):
 * стан вікна живе в Postgres і спільний для обох шляхів.
 */
export function bustStorefrontCache(): void {
  revalidateTag(CATEGORIES_CACHE_TAG, { expire: 3600 });
  // Дерево брендів, зміст і кешовані сторінки видачі каталогу — все, що
  // читає товари з кешу.
  revalidateTag(CATALOG_CACHE_TAG, { expire: 3600 });
  revalidatePath("/");
  revalidatePath("/catalog");
}
