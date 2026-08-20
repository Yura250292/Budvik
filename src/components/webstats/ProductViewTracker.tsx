"use client";

/**
 * Позначка «цю картку товару відкрили». Нічого не рендерить.
 *
 * Ставиться на ISR-сторінку товару: пропси запікаються у статичний
 * рендер, тому кеш не страждає — той самий підхід, що в ProductPriceBlock.
 *
 * Рахуємо раз на сесію на товар: людина, що гортає між карткою і
 * каталогом, — це один інтерес, а не десять переглядів.
 */

import { useEffect } from "react";
import { track, markOnce } from "@/lib/webstats/client";

export default function ProductViewTracker({
  productId,
  slug,
}: {
  productId: string;
  slug: string;
}) {
  useEffect(() => {
    if (!markOnce(`p_${productId}`)) return;
    track("product_view", { productId, path: `/catalog/${slug}` });
  }, [productId, slug]);

  return null;
}
