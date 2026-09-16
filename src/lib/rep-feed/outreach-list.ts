/**
 * «Кому написати цього тижня» — раз на тиждень, у вівторок з 14:00.
 *
 * Щоденний список дзвінків (call-list.ts) — про сьогодні: борг, ризик,
 * «відновити» впереміш. Сплячим клієнтам дзвінок посеред маршруту не
 * потрібен — їм потрібне одне повідомлення з приводом, і його зручніше
 * відправити з планшета в спокійну хвилину. Тому окремий, тижневий, короткий
 * список: до п'яти людей, яким є куди написати і яким ще ніхто не писав.
 *
 * Хто потрапляє:
 *   - кандидати дій торгового (rep-actions.ts, те саме 30-денне вікно, що й
 *     у списку дзвінків) типів REACTIVATE і CHURN_RISK;
 *   - не свої (склад, співробітники, ФОП торгових — isInternalClient);
 *   - з мобільним, на який іде Viber/SMS (outreachPhone);
 *   - не просили не писати: відписка, згода REFUSED або канал «не турбувати»;
 *   - без жодної пропозиції за QUIET_AFTER_OUTREACH_DAYS днів — від кого б
 *     вона не була.
 * Порядок — оборот за вікно, при рівному (у сплячих він нуль за
 * визначенням: 60+ днів без документа) — хто замовк недавно: його простіше
 * повернути, ніж того, хто пішов пів року тому.
 *
 * Порожній список — жодної події: «Кому написати: 0» — це шум.
 *
 * Модуль без next/*: воркер.
 */

import { prisma } from "@/lib/prisma";
import {
  actionCandidatesByRep,
  type ActionKind,
  type ClientActionCandidate,
} from "@/lib/analytics/company/rep-actions";
import { shiftDay } from "@/lib/analytics/period";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { outreachPhone, QUIET_AFTER_OUTREACH_DAYS, refusesMessages } from "@/lib/outreach/types";
import { isWeekend, worksToday } from "./call-list";
import { describeOutreachList, isOutreachListTime, weekStart } from "./format";
import { isInternalClient, loadInternalContext } from "./internal";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

/** Скільки клієнтів у списку. */
export const OUTREACH_LIST_TOP = 5;

/** Вікно ритму й ризику — те саме, що в списку дзвінків і помічнику. */
const WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

const LIST_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>(["REACTIVATE", "CHURN_RISK"]);

export function outreachListDedupKey(monday: string, repId: string): string {
  return `${REP_FEED_TYPES.OUTREACH_LIST}:${monday}:${repId}`;
}

/** Що про клієнта треба знати, щоб вирішити, чи можна йому писати. */
export type OutreachContactInfo = {
  primaryPhoneE164: string | null;
  phone: string | null;
  marketingOptOutAt: Date | null;
  marketingConsent: string;
  preferredChannel: string | null;
};

/**
 * Клієнт сказав «не писати» — будь-яким із трьох способів. Одне правило на
 * тижневий список, пропозицію на картці й адмінку: живе в outreach/types.ts,
 * тут лише реекспорт для наявних імпортів.
 */
export { refusesMessages };

/**
 * Чистий відбір: кого з кандидатів ставимо в тижневий список і в якому
 * порядку. Окремо від бази — його перевіряє scripts/check-outreach-worker.mts.
 */
export function selectOutreachTargets(
  candidates: Pick<ClientActionCandidate, "counterpartyId" | "name" | "kind" | "amountPeriod" | "daysSinceLast">[],
  info: ReadonlyMap<string, OutreachContactInfo>,
  contactedRecently: ReadonlySet<string>,
  isInternal: (c: { id: string; name: string }) => boolean,
  top = OUTREACH_LIST_TOP
): { counterpartyId: string; name: string; daysSinceLast: number; amountPeriod: number }[] {
  return candidates
    .filter((c) => LIST_KINDS.has(c.kind))
    .filter((c) => !isInternal({ id: c.counterpartyId, name: c.name }))
    .filter((c) => {
      const i = info.get(c.counterpartyId);
      return !!i && outreachPhone(i) !== null && !refusesMessages(i);
    })
    .filter((c) => !contactedRecently.has(c.counterpartyId))
    .sort((a, b) => b.amountPeriod - a.amountPeriod || a.daysSinceLast - b.daysSinceLast)
    .slice(0, top)
    .map((c) => ({
      counterpartyId: c.counterpartyId,
      name: c.name,
      daysSinceLast: c.daysSinceLast,
      amountPeriod: c.amountPeriod,
    }));
}

export async function collectOutreachLists(now: Date): Promise<FeedEvent[]> {
  // isWeekend — страховка на випадок, якщо день списку колись перенесуть.
  if (!isOutreachListTime(now) || isWeekend(now)) return [];

  const day = kyivDate(now);
  const monday = weekStart(day);

  const reps = await prisma.user.findMany({ where: { role: "SALES" }, select: { id: true } });
  if (reps.length === 0) return [];
  const known = new Set(
    (
      await prisma.notification.findMany({
        where: { dedupKey: { in: reps.map((r) => outreachListDedupKey(monday, r.id)) } },
        select: { dedupKey: true },
      })
    ).map((n) => n.dedupKey)
  );

  // Хто сьогодні не працює, списку не отримує: «напишіть п'ятьом» у
  // відпустці — перший крок до вимкнення каналу (як у call-list.ts).
  const active: string[] = [];
  for (const { id } of reps) {
    if (known.has(outreachListDedupKey(monday, id))) continue;
    if (await worksToday(id, day)) active.push(id);
  }
  if (active.length === 0) return [];

  const fromDay = shiftDay(day, -(WINDOW_DAYS - 1));
  const period = {
    fromDay,
    toDay: day,
    from: kyivDayStart(fromDay),
    to: kyivDayEnd(day),
    days: WINDOW_DAYS,
    clamped: false,
  };

  // Дебіторка й дисципліна — один раз на всіх, а не на кожного торгового.
  const byRep = await actionCandidatesByRep(active, period);

  const ids = [
    ...new Set(
      [...byRep.values()].flatMap((list) => list.filter((c) => LIST_KINDS.has(c.kind)).map((c) => c.counterpartyId))
    ),
  ];
  if (ids.length === 0) return [];

  const [cps, recent, internal] = await Promise.all([
    prisma.counterparty.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        primaryPhoneE164: true,
        phone: true,
        marketingOptOutAt: true,
        marketingConsent: true,
        preferredChannel: true,
      },
    }),
    prisma.clientOutreach.findMany({
      where: {
        counterpartyId: { in: ids },
        sentAt: { gte: new Date(now.getTime() - QUIET_AFTER_OUTREACH_DAYS * DAY_MS) },
      },
      select: { counterpartyId: true },
      distinct: ["counterpartyId"],
    }),
    loadInternalContext(),
  ]);

  const info = new Map(cps.map((c) => [c.id, c]));
  const contacted = new Set(recent.map((r) => r.counterpartyId));
  const isInternal = (c: { id: string; name: string }) => isInternalClient(c, internal);

  const events: FeedEvent[] = [];
  for (const repId of active) {
    const targets = selectOutreachTargets(byRep.get(repId) ?? [], info, contacted, isInternal);
    if (targets.length === 0) continue;
    events.push({
      type: REP_FEED_TYPES.OUTREACH_LIST,
      repId,
      dedupKey: outreachListDedupKey(monday, repId),
      relatedId: null,
      // Окрема сторінка без параметрів: білий список тапів застосунку
      // (CABINET_TARGET) параметрів запиту не пропускає.
      target: "/sales/outreach",
      ...describeOutreachList(targets.map((t) => ({ name: t.name, daysSinceLast: t.daysSinceLast }))),
      at: now,
      standalone: true,
    });
  }
  return events;
}
