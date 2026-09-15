/**
 * Підсумок наради для команди: керівник надсилає, торговий, водій і склад
 * читають у своєму кабінеті.
 *
 * Що бачать люди: підсумок, рішення, ключові моменти, відкриті питання, хід
 * по попередніх задачах і підтверджені задачі — хто що робить. Запис,
 * транскрипт, «хто говорив» і непідтверджені пропозиції лишаються в
 * керівника: там жива розмова про людей і гроші, а не те, що вирішили.
 *
 * Облік розсилки — рядки Notification типу REP_MEETING з ключем
 * «REP_MEETING:<нарада>:<людина>», без окремої таблиці. Рядок і є доступом:
 * є рядок — людина відкриває нараду; керівник прибрав — рядок стерто, і
 * сторінка віддає 404. Повторне надсилання тим самим людям нічого не дублює,
 * а торговим той самий рядок стає подією в стрічці.
 *
 * Пуш шле роут у момент розсилки, а не воркер: надсилає людина, чекати тіку
 * нема сенсу. Поза робочими годинами розсилка сама пуша не шле — підсумок у
 * кабінеті вже є, а розбудити людей керівник може окремою кнопкою, свідомо
 * (наради бувають і о восьмій вечора).
 *
 * Модуль без next/*.
 */

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push/send";
import { inPushHours } from "@/lib/rep-feed/format";
import { REP_FEED_TYPES } from "@/lib/rep-feed/types";
import { ROLE_LABELS } from "@/lib/roles";
import { listTasks } from "@/lib/tasks";
import { MeetingError, parseStructured } from "./index";
import {
  SHARE_NEW_MS,
  SHARE_ROLE_LIST,
  type ShareRecipient,
  type ShareState,
  type SharedMeetingRow,
  type SharedMeetingView,
  type TaskRow,
  type TeamTask,
} from "./types";

const TYPE = REP_FEED_TYPES.MEETING;
const MAX_RECIPIENTS = 200;
/** Пуші паралельно, але пачками: кожен — запит у базу й в Expo. */
const PUSH_CHUNK = 10;

export function shareKey(meetingId: string, userId: string): string {
  return `${TYPE}:${meetingId}:${userId}`;
}

/** Розділ кабінету за роллю — туди веде пуш. */
function cabinetBase(role: string): string | null {
  if (role === "SALES") return "/sales";
  if (role === "DRIVER") return "/driver";
  if (role === "WAREHOUSE") return "/warehouse";
  return null;
}

function isShareRole(role: string): boolean {
  return (SHARE_ROLE_LIST as readonly string[]).includes(role);
}

function roleRank(role: string): number {
  const i = (SHARE_ROLE_LIST as readonly string[]).indexOf(role);
  return i < 0 ? SHARE_ROLE_LIST.length : i;
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Перше речення підсумку — для пуша, стрічки й списку нарад. */
export function teaser(summary: string | null | undefined): string {
  const clean = (summary ?? "").replace(/\s+/g, " ").trim();
  const first = clean.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? clean;
  return clip(first, 160);
}

/* ---------- Керівник ---------- */

export async function getShareState(meetingId: string, now = new Date()): Promise<ShareState> {
  const exists = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true } });
  if (!exists) throw new MeetingError("Нараду не знайдено", 404);

  const [shares, tasks] = await Promise.all([
    prisma.notification.findMany({
      where: { type: TYPE, relatedId: meetingId },
      select: { userId: true, createdAt: true, pushedAt: true },
    }),
    prisma.staffTask.findMany({
      where: { meetingId, status: { in: ["ASSIGNED", "DONE"] } },
      select: { assigneeId: true },
    }),
  ]);
  const shared = new Map(shares.map((s) => [s.userId, s]));

  const users = await prisma.user.findMany({
    // Отримувач, якому відтоді змінили роль, лишається в списку — щоб його можна було прибрати.
    where: { OR: [{ role: { in: [...SHARE_ROLE_LIST] } }, { id: { in: [...shared.keys()] } }] },
    select: { id: true, name: true, role: true },
  });

  const people: ShareRecipient[] = users
    .map((u) => {
      const s = shared.get(u.id);
      return {
        id: u.id,
        name: u.name.trim(),
        role: u.role,
        roleLabel: roleLabel(u.role),
        sharedAt: s?.createdAt.toISOString() ?? null,
        pushedAt: s?.pushedAt?.toISOString() ?? null,
      };
    })
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name, "uk"));

  const assignees = new Set(tasks.map((t) => t.assigneeId));
  const suggested = people
    .filter((p) => !p.sharedAt && isShareRole(p.role) && (p.role === "SALES" || assignees.has(p.id)))
    .map((p) => p.id);

  return { people, suggested, pushHours: inPushHours(now) };
}

/** Надіслати підсумок людям. Тим, хто вже має, нічого не станеться. */
export async function shareMeeting(meetingId: string, input: unknown): Promise<{ added: number }> {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>).userIds : null;
  const ids = Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
  if (ids.length === 0) throw new MeetingError("Оберіть, кому надіслати");
  if (ids.length > MAX_RECIPIENTS) throw new MeetingError(`За раз — до ${MAX_RECIPIENTS} людей`);

  const m = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { status: true, title: true, structured: true },
  });
  if (!m) throw new MeetingError("Нараду не знайдено", 404);
  const s = parseStructured(m.structured);
  if (m.status !== "READY" || !s) {
    throw new MeetingError("Підсумок ще не готовий — надіслати можна, коли обробка завершиться", 409);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: ids }, role: { in: [...SHARE_ROLE_LIST] } },
    select: { id: true },
  });
  if (users.length !== ids.length) throw new MeetingError("Надіслати можна лише торговим, водіям і складу");

  const res = await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: TYPE,
      title: clip(`Нарада: ${m.title}`, 90),
      body: teaser(s.summary),
      relatedId: meetingId,
      dedupKey: shareKey(meetingId, u.id),
    })),
    skipDuplicates: true,
  });
  return { added: res.count };
}

/**
 * Пуш усім отримувачам наради, яким його ще не слали.
 *
 * Поза робочими годинами — лише з force: керівник натиснув «Надіслати пуш» і
 * підтвердив, що пише людям увечері свідомо.
 */
export async function pushMeetingShare(
  meetingId: string,
  opts: { force?: boolean; now?: Date } = {}
): Promise<number> {
  const now = opts.now ?? new Date();
  if (!opts.force && !inPushHours(now)) return 0;
  const rows = await prisma.notification.findMany({
    where: { type: TYPE, relatedId: meetingId, pushedAt: null },
    select: { id: true, userId: true, title: true, body: true, user: { select: { role: true } } },
  });

  let sent = 0;
  for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
    const results = await Promise.all(
      rows.slice(i, i + PUSH_CHUNK).map(async (n) => {
        // Захоплення перед відправкою: подвійне натискання не штовхне двічі.
        const claimed = await prisma.notification.updateMany({
          where: { id: n.id, pushedAt: null },
          data: { pushedAt: now },
        });
        if (claimed.count !== 1) return 0;
        const base = cabinetBase(n.user.role);
        await sendPushToUser(n.userId, {
          title: n.title,
          body: n.body,
          ...(base ? { data: { screen: "/cabinet", target: `${base}/meetings/${meetingId}` } } : {}),
        });
        return 1;
      })
    );
    sent += results.reduce<number>((a, b) => a + b, 0);
  }
  return sent;
}

/** Прибрати підсумок з кабінету однієї людини або, без userId, в усіх. */
export async function unshareMeeting(meetingId: string, userId: string | null): Promise<number> {
  const res = await prisma.notification.deleteMany({
    where: { type: TYPE, relatedId: meetingId, ...(userId ? { userId } : {}) },
  });
  return res.count;
}

/* ---------- Кабінет ---------- */

export async function listSharedMeetings(userId: string, now = new Date()): Promise<SharedMeetingRow[]> {
  const shares = await prisma.notification.findMany({
    where: { userId, type: TYPE, relatedId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { relatedId: true, createdAt: true },
  });
  const sharedAt = new Map(shares.map((s) => [s.relatedId as string, s.createdAt]));
  const ids = [...sharedAt.keys()];
  if (ids.length === 0) return [];

  const [meetings, open] = await Promise.all([
    prisma.meeting.findMany({
      where: { id: { in: ids } },
      orderBy: { recordedAt: "desc" },
      select: {
        id: true,
        title: true,
        recordedAt: true,
        audioDurationMs: true,
        structured: true,
        createdBy: { select: { name: true } },
      },
    }),
    prisma.staffTask.groupBy({
      by: ["meetingId"],
      where: { meetingId: { in: ids }, assigneeId: userId, status: "ASSIGNED" },
      _count: { _all: true },
    }),
  ]);
  const openBy = new Map(open.map((g) => [g.meetingId, g._count._all]));

  return meetings.map((m) => {
    const s = parseStructured(m.structured);
    const at = sharedAt.get(m.id) ?? now;
    return {
      id: m.id,
      title: m.title,
      recordedAt: m.recordedAt.toISOString(),
      audioDurationMs: m.audioDurationMs,
      createdByName: m.createdBy.name.trim(),
      sharedAt: at.toISOString(),
      isNew: now.getTime() - at.getTime() < SHARE_NEW_MS,
      teaser: teaser(s?.summary),
      decisions: s?.decisions.length ?? 0,
      myOpenTasks: openBy.get(m.id) ?? 0,
    };
  });
}

function teamTask(t: TaskRow): TeamTask {
  return {
    id: t.id,
    title: t.title,
    done: t.status === "DONE",
    priority: t.priority,
    dueAt: t.dueAt,
    overdue: t.overdue,
    assigneeName: t.assignee?.name ?? null,
    assigneeRoleLabel: t.assignee ? roleLabel(t.assignee.role) : null,
    clientName: t.counterparty?.name ?? null,
  };
}

export async function getSharedMeeting(userId: string, meetingId: string, now = new Date()): Promise<SharedMeetingView> {
  const share = await prisma.notification.findUnique({
    where: { dedupKey: shareKey(meetingId, userId) },
    select: { id: true, userId: true, createdAt: true, isRead: true },
  });
  // Ключ містить id людини, але власника рядка звіряємо окремо: ключ — не пароль.
  if (!share || share.userId !== userId) throw new MeetingError("Цю нараду вам не надсилали", 404);

  const m = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      status: true,
      title: true,
      recordedAt: true,
      audioDurationMs: true,
      structured: true,
      createdBy: { select: { name: true } },
    },
  });
  if (!m) throw new MeetingError("Нараду видалено", 404);
  const s = parseStructured(m.structured);

  // Лише підтверджені: пропозиції моделі людям не показуємо, доки керівник їх не надіслав.
  const tasks = (await listTasks({ meetingId })).filter((t) => t.status === "ASSIGNED" || t.status === "DONE");

  const progressIds = s?.progressUpdates.map((p) => p.taskId) ?? [];
  const owners = progressIds.length
    ? await prisma.staffTask.findMany({
        where: { id: { in: progressIds } },
        select: { id: true, assignee: { select: { name: true } } },
      })
    : [];
  const ownerOf = new Map(owners.map((t) => [t.id, t.assignee?.name.trim() ?? null]));

  if (!share.isRead) {
    await prisma.notification.update({ where: { id: share.id }, data: { isRead: true } }).catch(() => {});
  }

  return {
    id: meetingId,
    title: m.title,
    recordedAt: m.recordedAt.toISOString(),
    audioDurationMs: m.audioDurationMs,
    createdByName: m.createdBy.name.trim(),
    sharedAt: share.createdAt.toISOString(),
    isNew: now.getTime() - share.createdAt.getTime() < SHARE_NEW_MS,
    updating: m.status !== "READY",
    summary: s?.summary ?? null,
    decisions: s?.decisions ?? [],
    keyPoints: s?.keyPoints ?? [],
    openQuestions: s?.openQuestions ?? [],
    progress: (s?.progressUpdates ?? []).map((p) => ({
      taskTitle: p.taskTitle,
      assigneeName: ownerOf.get(p.taskId) ?? null,
      status: p.status,
      note: p.note,
    })),
    mine: tasks.filter((t) => t.assignee?.id === userId),
    team: tasks.filter((t) => t.assignee?.id !== userId).map(teamTask),
  };
}
