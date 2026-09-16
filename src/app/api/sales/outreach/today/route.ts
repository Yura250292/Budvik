import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CABINET_ROLES, requireRoles, scopeToSelf } from "@/lib/app/identity";
import { ACTION_LABELS, repActionCandidates, type ActionKind } from "@/lib/analytics/company/rep-actions";
import { shiftDay } from "@/lib/analytics/period";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { outreachStats } from "@/lib/outreach/client-facts";
import { ACTION_TO_OUTREACH, outreachPhone } from "@/lib/outreach/types";
import { isInternalClient, loadInternalContext } from "@/lib/rep-feed/internal";

/**
 * «Кому написати / подзвонити сьогодні» — той самий список, що приходить
 * пушем об 11:00 (rep-feed/call-list.ts), але повністю й з тим, що вже
 * писали. Вікно й порядок ті самі: пуш каже «Петренко — забрати борг», і
 * сторінка, на яку він веде, не має показувати інший топ.
 */
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
const TOP = 12;

/** Копія порядку з call-list.ts: спершу гроші, потім ті, кого можна втратити. */
const KIND_ORDER: Record<ActionKind, number> = {
  COLLECT_DEBT: 0,
  CHURN_RISK: 1,
  REACTIVATE: 2,
  DEVELOP: 3,
  OFFER_BONUS: 4,
};

export async function GET(req: Request) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const repId = scopeToSelf(auth.me, new URL(req.url).searchParams.get("repId"), ["SALES"]);
  const now = new Date();
  const day = kyivDate(now);
  const fromDay = shiftDay(day, -(WINDOW_DAYS - 1));
  const period = {
    fromDay,
    toDay: day,
    from: kyivDayStart(fromDay),
    to: kyivDayEnd(day),
    days: WINDOW_DAYS,
    clamped: false,
  };

  const [candidates, internal] = await Promise.all([repActionCandidates(repId, period), loadInternalContext()]);
  const top = candidates
    .filter((c) => !isInternalClient({ id: c.counterpartyId, name: c.name }, internal))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.overdue - a.overdue || b.debt - a.debt)
    .slice(0, TOP);

  const ids = top.map((c) => c.counterpartyId);
  const [contacts, stats] = await Promise.all([
    prisma.counterparty.findMany({
      where: { id: { in: ids } },
      select: { id: true, phone: true, primaryPhoneE164: true },
    }),
    outreachStats(ids, now),
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  return NextResponse.json(
    {
      day,
      items: top.map((c) => {
        const contact = contactById.get(c.counterpartyId);
        const last = stats.get(c.counterpartyId)?.last ?? null;
        return {
          counterpartyId: c.counterpartyId,
          name: c.name,
          action: c.kind,
          actionLabel: ACTION_LABELS[c.kind],
          outreachKind: ACTION_TO_OUTREACH[c.kind],
          why: c.why,
          debt: c.debt,
          overdue: c.overdue,
          daysSinceLast: c.daysSinceLast,
          phone: contact?.phone ?? null,
          phoneE164: contact ? outreachPhone(contact) : null,
          lastOutreach: last ? { at: last.at, channel: last.channel, outcome: last.outcome, daysAgo: last.daysAgo } : null,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
