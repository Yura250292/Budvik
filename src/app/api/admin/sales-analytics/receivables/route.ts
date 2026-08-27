/**
 * Дебіторка одного торгового в розрізі клієнтів і рахунків.
 *
 * Окремо від зведеної таблиці, бо вантажиться лише коли рядок розгорнули:
 * класти перелік усіх непогашених рахунків кожного торгового в основну
 * відповідь означало б віддавати тисячі рядків, з яких дивляться один.
 */

import { NextRequest, NextResponse } from "next/server";
import { receivableRowsByRep, toDebtorList, sumAging } from "@/lib/analytics/money-facts";
import { resolveIdentity } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const role = me.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  if (!isFullAccess && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("repId");
  // Торговий бачить лише свою дебіторку, хоч би що просив у параметрі.
  const repId = isFullAccess ? requested : me.userId;

  if (!repId) {
    return NextResponse.json({ error: "Потрібен repId" }, { status: 400 });
  }

  const rows = await receivableRowsByRep(repId);

  // Групувати нема чого: 1С віддає сальдо одним числом на клієнта, тож
  // рядок = клієнт. Дат окремих накладних у нас немає взагалі.
  const clients = toDebtorList(rows);
  const aging = sumAging(rows);

  return NextResponse.json({
    repId,
    // Актуальність даних задає 1С, а не момент запиту
    syncedAt: rows.reduce<string | null>((latest, r) => {
      const t = r.syncedAt ? new Date(r.syncedAt).toISOString() : null;
      return t && (!latest || t > latest) ? t : latest;
    }, null),
    aging,
    clients,
  });
}
