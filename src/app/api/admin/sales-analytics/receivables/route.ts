/**
 * Дебіторка одного торгового в розрізі клієнтів і рахунків.
 *
 * Окремо від зведеної таблиці, бо вантажиться лише коли рядок розгорнули:
 * класти перелік усіх непогашених рахунків кожного торгового в основну
 * відповідь означало б віддавати тисячі рядків, з яких дивляться один.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { calculateAging } from "@/lib/erp/receivables";
import { receivableRowsByRep, toInvoiceList, toAgingInput } from "@/lib/analytics/money-facts";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = session.user.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  if (!isFullAccess && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("repId");
  // Торговий бачить лише свою дебіторку, хоч би що просив у параметрі.
  const repId = isFullAccess ? requested : session.user.id;

  if (!repId) {
    return NextResponse.json({ error: "Потрібен repId" }, { status: 400 });
  }

  const now = new Date();
  const rows = await receivableRowsByRep(repId);
  const invoices = toInvoiceList(rows, now);
  const aging = calculateAging(toAgingInput(rows), now);

  // Групування по клієнтах: розмова з торговим ведеться про клієнта
  // («Петренко винен 40 тисяч»), а не про номер рахунка.
  const byClient = new Map<
    string,
    { counterpartyId: string; name: string; total: number; overdue: number; invoices: typeof invoices }
  >();

  for (const inv of invoices) {
    const entry = byClient.get(inv.counterpartyId) ?? {
      counterpartyId: inv.counterpartyId,
      name: inv.client,
      total: 0,
      overdue: 0,
      invoices: [],
    };
    entry.total += inv.debt;
    if (inv.bucket !== "CURRENT") entry.overdue += inv.debt;
    entry.invoices.push(inv);
    byClient.set(inv.counterpartyId, entry);
  }

  const clients = Array.from(byClient.values()).sort(
    (a, b) => b.overdue - a.overdue || b.total - a.total
  );

  return NextResponse.json({ repId, asOf: now.toISOString(), aging, clients });
}
