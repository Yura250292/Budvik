/**
 * Курси валют для віджета дашборду.
 *
 * Уся логіка джерел — у src/lib/currency/rates.ts, спільному для віджета
 * і звітів: звіти викликають getCurrencyRates() напряму, без HTTP і сесії.
 *
 * Проксі на сервері, а не fetch із браузера: сторонні API не віддають
 * CORS-заголовки, а ще так курс кешується один раз на всіх користувачів.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrencyRates } from "@/lib/currency/rates";

export type { CurrencyRate, CurrencyResponse } from "@/lib/currency/rates";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "MANAGER", "SALES"];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  return NextResponse.json(await getCurrencyRates());
}
