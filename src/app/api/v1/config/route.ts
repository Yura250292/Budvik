/**
 * Налаштування, які застосунок питає при старті.
 *
 * Головне тут — minSupportedBuild: установлену збірку не можна оновити
 * примусово, а рев'ю в магазині триває днями. Без такого рубильника зламана
 * версія лишалася б у руках у людей доти, доки кожен сам не оновиться.
 * Доробити це потім неможливо за визначенням — старі збірки про такий роут
 * просто не знатимуть.
 */

import { NextResponse } from "next/server";
import { SITE_CONTACTS } from "@/lib/seo/site";
import { BOLTS_CASHBACK_RATE, BOLTS_MAX_USAGE_RATE } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Нижче цієї збірки застосунок мусить показати екран «оновіть». */
const MIN_SUPPORTED_BUILD = 1;
/** Найсвіжіша збірка в магазинах — щоб запропонувати оновлення мʼяко. */
const LATEST_BUILD = 1;

export async function GET() {
  return NextResponse.json(
    {
      minSupportedBuild: MIN_SUPPORTED_BUILD,
      latestBuild: LATEST_BUILD,
      // Ставки Болтів приїжджають з сервера, а не зашиті у збірку: змінити
      // кешбек маркетинговим рішенням має бути можливо без релізу.
      boltsCashbackRate: BOLTS_CASHBACK_RATE,
      boltsMaxUsageRate: BOLTS_MAX_USAGE_RATE,
      contacts: SITE_CONTACTS,
      maintenance: null as string | null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
