/**
 * Пуші керівникам про події стрічки всієї команди.
 *
 * Типово керівник пушів не отримує: подій сотні на день. Сам вибирає
 * категорії на сторінці «Стрічка подій» (`adminTypes` у notificationPrefs,
 * prefs.ts). Один тік воркера — щонайбільше один пуш на людину, зведений.
 *
 * Стеля на день окрема від торгових: у керівника немає рядків Notification,
 * за якими рахується `pushedAt`, тож лічильник — у SyncState
 * `repFeed:admin:<userId>` виду «2026-09-23|4».
 *
 * Без next/*: воркер.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { sendPushToUser } from "@/lib/push/send";
import { getSyncState, setSyncState } from "@/lib/sync-ingest/context";
import { eventsWord, shortName } from "./format";
import { parseAdminFeedPrefs } from "./prefs";
import type { FeedEvent } from "./types";
import type { PushDecision } from "./notify";

export const ADMIN_DAILY_PUSH_CAP = 20;
const GROUP_HEAD = 3;

function capKey(userId: string): string {
  return `repFeed:admin:${userId}`;
}

async function sentToday(userId: string, day: string): Promise<number> {
  const raw = await getSyncState(capKey(userId));
  const [d, n] = (raw ?? "").split("|");
  return d === day ? Number(n) || 0 : 0;
}

/** «Олександр: Химич заплатив 8 400 ₴» — ім'я торгового попереду. */
function line(e: FeedEvent, names: Map<string, string>): string {
  const who = names.get(e.repId);
  return who ? `${shortName(who, 16)}: ${e.title}` : e.title;
}

export function adminPushText(
  events: FeedEvent[],
  names: Map<string, string>
): { title: string; body: string } {
  if (events.length === 1) {
    const [e] = events;
    return { title: line(e, names), body: e.body };
  }
  const n = events.length;
  const head = events.slice(0, GROUP_HEAD).map((e) => line(e, names));
  const rest = n - head.length;
  return {
    title: `Стрічка: ${n} ${eventsWord(n)}`,
    body: rest > 0 ? `${head.join(" · ")} і ще ${rest}` : head.join(" · "),
  };
}

export async function pushAdmins(
  fresh: FeedEvent[],
  opts: { now: Date; dry: boolean; brake: boolean; quiet: boolean }
): Promise<PushDecision[]> {
  if (fresh.length === 0) return [];

  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "MANAGER"] } },
    select: { id: true, name: true, notificationPrefs: true },
  });
  const wanting = admins
    .map((a) => ({ ...a, types: new Set(parseAdminFeedPrefs(a.notificationPrefs).adminTypes) }))
    .filter((a) => a.types.size > 0);
  if (wanting.length === 0) return [];

  const repIds = [...new Set(fresh.map((e) => e.repId))];
  const names = new Map(
    (await prisma.user.findMany({ where: { id: { in: repIds } }, select: { id: true, name: true } })).map((u) => [
      u.id,
      u.name.trim(),
    ])
  );

  const day = kyivDate(opts.now);
  const out: PushDecision[] = [];

  for (const admin of wanting) {
    const events = fresh.filter((e) => admin.types.has(e.type));
    if (events.length === 0) continue;
    const text = adminPushText(events, names);
    const base = { repId: admin.id, name: admin.name, ...text, target: "/admin/feed", events: events.length };

    if (opts.brake) {
      out.push({ ...base, sent: false, why: "керівник: аварійне гальмо" });
      continue;
    }
    if (opts.quiet) {
      out.push({ ...base, sent: false, why: "керівник: тихі години" });
      continue;
    }
    const count = await sentToday(admin.id, day);
    if (count >= ADMIN_DAILY_PUSH_CAP) {
      out.push({ ...base, sent: false, why: `керівник: денна стеля ${ADMIN_DAILY_PUSH_CAP} вичерпана` });
      continue;
    }
    if (opts.dry) {
      out.push({ ...base, sent: false, why: "керівник: dry — надіслали б" });
      continue;
    }

    await sendPushToUser(admin.id, {
      ...text,
      // Кабінет застосунку відкриє /admin/feed, якщо білий список тапів
      // (mobile/src/track/notification-taps.ts) пускає /admin.
      data: { screen: "/cabinet", target: "/admin/feed" },
    });
    await setSyncState(capKey(admin.id), `${day}|${count + 1}`);
    out.push({ ...base, sent: true, why: "керівник: надіслано" });
  }
  return out;
}
