import { NextResponse } from "next/server";
import { CABINET_ROLES, requireRoles, scopeToSelf } from "@/lib/app/identity";
import { isClientFilter, listOutreachClients } from "@/lib/outreach/client-facts";

/**
 * Клієнти торгового зі станом: «давно не брав», «згасає», «без пропозиції».
 *
 * Окремо від /api/erp/counterparties: той роут читає десяток селектів у
 * формах, і його відповідь мусить лишатися масивом контрагентів. Тут інше
 * питання — не «хто в базі», а «з ким із моїх пора говорити», і відповідь
 * несе стан, ритм, прострочку й останню пропозицію.
 *
 * Лише «мої» (scope=mine): уся база компанії зі станами — це 3,7 тис.
 * клієнтів і кілька секунд, а шукати чужого клієнта торговий і далі може
 * старим списком.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const sp = new URL(req.url).searchParams;
  const filterParam = sp.get("filter") ?? "all";
  if (!isClientFilter(filterParam)) {
    return NextResponse.json({ error: "Невідомий фільтр" }, { status: 400 });
  }
  const scope = sp.get("scope") ?? "mine";
  if (scope !== "mine") {
    return NextResponse.json({ error: "Підтримується лише scope=mine" }, { status: 400 });
  }

  // Торговий бачить лише свій портфель; офіс може спитати про конкретного.
  const repId = scopeToSelf(auth.me, sp.get("repId"), ["SALES"]);
  const result = await listOutreachClients(repId, filterParam);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
