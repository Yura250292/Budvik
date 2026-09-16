import { NextResponse } from "next/server";
import { OFFICE_ROLES, requireRoles } from "@/lib/app/identity";
import { parsePeriod } from "@/lib/analytics/period";
import { marketingBaseStats } from "@/lib/outreach/admin-stats";
import { isOutreachTableMissing } from "@/lib/outreach/settle";

/**
 * «Робота з базою» для офісу: стани клієнтів, контакти, пропозиції торгових,
 * нічийні сплячі. ?days=30 (або ?from&to) — вікно пропозицій і стан на його кінець.
 *
 * Лише ADMIN і MANAGER: тут телефони, згоди й борги всієї бази. Торговому
 * сторінку закриває ще й middleware.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const period = parsePeriod(new URL(req.url).searchParams, 30);
  try {
    return NextResponse.json(await marketingBaseStats(period));
  } catch (e) {
    if (isOutreachTableMissing(e)) {
      return NextResponse.json(
        { error: "Таблиці пропозицій у базі ще немає: міграцію client_outreach не накочено" },
        { status: 503 }
      );
    }
    throw e;
  }
}
