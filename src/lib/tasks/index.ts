/**
 * Задачі команді: доручення від офісу торговому, водієві, складу чи менеджеру.
 *
 * Джерела два — нарада (модель пропонує, керівник підтверджує) і ручне
 * створення. Сповіщає виконавця не цей модуль, а воркер
 * (src/lib/tasks/notify.ts): роут лише міняє статус, а пуш іде в робочі
 * години й переживає будь-який перезапуск.
 *
 * Модуль без next/* — його читає й воркер (підсумок наради).
 */

import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivDayEnd } from "@/lib/date/kyiv";
import { ROLE_LABELS } from "@/lib/roles";
import {
  STAFF_ROLE_LIST,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  asTaskPriority,
  asTaskStatus,
  isTaskReady,
  type ClientCandidate,
  type StaffOption,
  type TaskRow,
  type TaskStatus,
} from "@/lib/meetings/types";

export class TaskError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const OFFICE = ["ADMIN", "MANAGER"];
const TITLE_MIN = 3;
const TITLE_MAX = 200;
const DETAILS_MAX = 2_000;
const NOTE_MAX = 1_000;
const DONE_VISIBLE_DAYS = 14;

const TASK_INCLUDE = {
  assignee: { select: { id: true, name: true, role: true } },
  counterparty: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  meeting: { select: { id: true, title: true } },
} satisfies Prisma.StaffTaskInclude;

type DbTask = Prisma.StaffTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

function candidates(raw: Prisma.JsonValue | null): ClientCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) return [];
    const o = c as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") return [];
    return [{ id: o.id, name: o.name, address: typeof o.address === "string" ? o.address : null, mine: o.mine === true }];
  });
}

export function shapeTask(t: DbTask, now = new Date()): TaskRow {
  const status = asTaskStatus(t.status);
  return {
    id: t.id,
    meetingId: t.meetingId,
    meetingTitle: t.meeting?.title ?? null,
    title: t.title,
    details: t.details,
    status,
    statusLabel: TASK_STATUS_LABELS[status],
    priority: asTaskPriority(t.priority),
    dueAt: t.dueAt?.toISOString() ?? null,
    overdue: status === "ASSIGNED" && !!t.dueAt && t.dueAt.getTime() < now.getTime(),
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name.trim(), role: t.assignee.role } : null,
    assigneeNameHeard: t.assigneeNameHeard,
    assigneeConfidence: t.assigneeConfidence,
    counterparty: t.counterparty ? { id: t.counterparty.id, name: t.counterparty.name } : null,
    clientNameHeard: t.clientNameHeard,
    clientHint: t.clientHint,
    clientCandidates: candidates(t.clientCandidates),
    clientConfidence: t.clientConfidence,
    createdBy: { id: t.createdBy.id, name: t.createdBy.name.trim() },
    sentAt: t.sentAt?.toISOString() ?? null,
    pushedAt: t.pushedAt?.toISOString() ?? null,
    doneAt: t.doneAt?.toISOString() ?? null,
    doneNote: t.doneNote,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
    progressNote: t.progressNote,
    progressAt: t.progressAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    ready: isTaskReady(t),
  };
}

/** «PROPOSED,ASSIGNED» із запиту → перелік; невідоме відкидається. */
export function parseStatusFilter(value: string | null | undefined): TaskStatus[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is TaskStatus => (TASK_STATUSES as readonly string[]).includes(s));
  return list.length ? list : undefined;
}

export async function listTasks(
  opts: { status?: TaskStatus[]; assigneeId?: string; createdById?: string; meetingId?: string; limit?: number } = {}
): Promise<TaskRow[]> {
  const rows = await prisma.staffTask.findMany({
    where: {
      ...(opts.status?.length ? { status: { in: opts.status } } : {}),
      ...(opts.assigneeId ? { assigneeId: opts.assigneeId } : {}),
      ...(opts.createdById ? { createdById: opts.createdById } : {}),
      ...(opts.meetingId ? { meetingId: opts.meetingId } : {}),
    },
    include: TASK_INCLUDE,
    orderBy: opts.meetingId
      ? [{ createdAt: "asc" }]
      : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: Math.min(opts.limit ?? 200, 500),
  });
  const now = new Date();
  return rows.map((r) => shapeTask(r, now));
}

/** Кабінет виконавця: відкриті за дедлайном і виконані за два тижні. */
export async function listMyTasks(userId: string): Promise<{ open: TaskRow[]; done: TaskRow[] }> {
  const since = new Date(Date.now() - DONE_VISIBLE_DAYS * 86_400_000);
  const [open, done] = await Promise.all([
    prisma.staffTask.findMany({
      where: { assigneeId: userId, status: "ASSIGNED" },
      include: TASK_INCLUDE,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { sentAt: "desc" }],
      take: 100,
    }),
    prisma.staffTask.findMany({
      where: { assigneeId: userId, status: "DONE", doneAt: { gte: since } },
      include: TASK_INCLUDE,
      orderBy: { doneAt: "desc" },
      take: 50,
    }),
  ]);
  const now = new Date();
  return { open: open.map((t) => shapeTask(t, now)), done: done.map((t) => shapeTask(t, now)) };
}

export async function countOpenTasks(userId: string): Promise<number> {
  return prisma.staffTask.count({ where: { assigneeId: userId, status: "ASSIGNED" } });
}

/** Кому можна доручити — для вибору виконавця і для промпту наради. */
export async function listStaff(): Promise<StaffOption[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLE_LIST] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name.trim(), role: u.role, roleLabel: ROLE_LABELS[u.role as Role] ?? u.role }));
}

/* ---------- Правки ---------- */

type Edits = {
  title?: string;
  details?: string | null;
  assigneeId?: string | null;
  counterpartyId?: string | null;
  dueAt?: Date | null;
  priority?: string;
};

function obj(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

async function parseEdits(input: unknown): Promise<Edits> {
  const o = obj(input);
  const out: Edits = {};

  if ("title" in o) {
    const t = typeof o.title === "string" ? o.title.replace(/\s+/g, " ").trim() : "";
    if (t.length < TITLE_MIN) throw new TaskError("Назва задачі — хоча б кілька слів");
    if (t.length > TITLE_MAX) throw new TaskError(`Назва задовга: до ${TITLE_MAX} символів`);
    out.title = t;
  }
  if ("details" in o) {
    const d = typeof o.details === "string" ? o.details.trim() : "";
    if (d.length > DETAILS_MAX) throw new TaskError(`Опис задовгий: до ${DETAILS_MAX} символів`);
    out.details = d || null;
  }
  if ("assigneeId" in o) {
    if (o.assigneeId === null || o.assigneeId === "") {
      out.assigneeId = null;
    } else if (typeof o.assigneeId === "string") {
      const u = await prisma.user.findUnique({ where: { id: o.assigneeId }, select: { role: true } });
      if (!u || !(STAFF_ROLE_LIST as readonly string[]).includes(u.role)) {
        throw new TaskError("Виконавця не знайдено серед персоналу", 404);
      }
      out.assigneeId = o.assigneeId;
    }
  }
  if ("counterpartyId" in o) {
    if (o.counterpartyId === null || o.counterpartyId === "") {
      out.counterpartyId = null;
    } else if (typeof o.counterpartyId === "string") {
      const c = await prisma.counterparty.findUnique({ where: { id: o.counterpartyId }, select: { id: true } });
      if (!c) throw new TaskError("Клієнта не знайдено", 404);
      out.counterpartyId = c.id;
    }
  }
  if ("dueDate" in o) {
    if (o.dueDate === null || o.dueDate === "") {
      out.dueAt = null;
    } else if (typeof o.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate)) {
      out.dueAt = kyivDayEnd(o.dueDate);
    } else {
      throw new TaskError("Дата має бути у форматі РРРР-ММ-ДД");
    }
  }
  if ("priority" in o) out.priority = asTaskPriority(o.priority);
  return out;
}

/** Правки керівника впевнені за визначенням: він сам вибрав людину й клієнта. */
function editsData(e: Edits): Prisma.StaffTaskUncheckedUpdateManyInput {
  const d: Prisma.StaffTaskUncheckedUpdateManyInput = {};
  if (e.title !== undefined) d.title = e.title;
  if (e.details !== undefined) d.details = e.details;
  if (e.dueAt !== undefined) d.dueAt = e.dueAt;
  if (e.priority !== undefined) d.priority = e.priority;
  if (e.assigneeId !== undefined) {
    d.assigneeId = e.assigneeId;
    d.assigneeConfidence = e.assigneeId ? 1 : null;
  }
  if (e.counterpartyId !== undefined) {
    d.counterpartyId = e.counterpartyId;
    d.clientConfidence = e.counterpartyId ? 1 : null;
    if (e.counterpartyId) d.clientCandidates = Prisma.DbNull;
  }
  return d;
}

async function getRow(id: string): Promise<TaskRow> {
  const t = await prisma.staffTask.findUnique({ where: { id }, include: TASK_INCLUDE });
  if (!t) throw new TaskError("Задачу не знайдено", 404);
  return shapeTask(t);
}

async function existing(id: string) {
  const t = await prisma.staffTask.findUnique({
    where: { id },
    select: { status: true, assigneeId: true, createdById: true },
  });
  if (!t) throw new TaskError("Задачу не знайдено", 404);
  return t;
}

/** Ручна задача: одразу надіслана, виконавець обов'язковий. */
export async function createTask(actorId: string, input: unknown): Promise<TaskRow> {
  const e = await parseEdits(input);
  if (!e.title) throw new TaskError("Назва задачі — хоча б кілька слів");
  if (!e.assigneeId) throw new TaskError("Оберіть виконавця");
  const row = await prisma.staffTask.create({
    data: {
      createdById: actorId,
      title: e.title,
      details: e.details ?? null,
      assigneeId: e.assigneeId,
      assigneeConfidence: 1,
      counterpartyId: e.counterpartyId ?? null,
      clientConfidence: e.counterpartyId ? 1 : null,
      dueAt: e.dueAt ?? null,
      priority: e.priority ?? "NORMAL",
      status: "ASSIGNED",
      sentAt: new Date(),
    },
    include: TASK_INCLUDE,
  });
  return shapeTask(row);
}

/**
 * Підтвердити пропозицію з наради (з правками чи без).
 *
 * Автором стає той, хто підтвердив: саме він вирішив доручити, і саме йому
 * виконавець відзвітує «зроблено».
 */
export async function confirmTask(actorId: string, id: string, input: unknown): Promise<TaskRow> {
  const e = await parseEdits(input);
  const t = await existing(id);
  if (t.status !== "PROPOSED") throw new TaskError("Задачу вже надіслано або скасовано", 409);
  const assigneeId = e.assigneeId !== undefined ? e.assigneeId : t.assigneeId;
  if (!assigneeId) throw new TaskError("Оберіть виконавця");

  const res = await prisma.staffTask.updateMany({
    where: { id, status: "PROPOSED" },
    data: { ...editsData(e), assigneeId, status: "ASSIGNED", sentAt: new Date(), pushedAt: null, createdById: actorId },
  });
  if (res.count !== 1) throw new TaskError("Задачу вже надіслано або скасовано", 409);
  return getRow(id);
}

/** Правка до чи після надсилання. Новий виконавець отримає задачу як нову. */
export async function updateTask(id: string, input: unknown): Promise<TaskRow> {
  const e = await parseEdits(input);
  const t = await existing(id);
  if (t.status !== "PROPOSED" && t.status !== "ASSIGNED") throw new TaskError("Закриту задачу не правлять", 409);

  const data = editsData(e);
  if (t.status === "ASSIGNED" && e.assigneeId !== undefined) {
    if (!e.assigneeId) throw new TaskError("У надісланої задачі має бути виконавець");
    if (e.assigneeId !== t.assigneeId) {
      data.sentAt = new Date();
      data.pushedAt = null;
    }
  }
  const res = await prisma.staffTask.updateMany({ where: { id, status: t.status }, data });
  if (res.count !== 1) throw new TaskError("Задачу щойно змінили — оновіть сторінку", 409);
  return getRow(id);
}

export async function cancelTask(id: string): Promise<TaskRow> {
  const res = await prisma.staffTask.updateMany({
    where: { id, status: { in: ["PROPOSED", "ASSIGNED"] } },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (res.count !== 1) {
    await existing(id);
    throw new TaskError("Задачу вже закрито", 409);
  }
  return getRow(id);
}

/**
 * Позначити виконаною. Виконавець — свою; офіс — будь-яку.
 *
 * Якщо закриває сам автор, повідомляти нікого: він і так знає.
 */
export async function completeTask(actor: { userId: string; role: string }, id: string, note: unknown): Promise<TaskRow> {
  const t = await existing(id);
  if (t.assigneeId !== actor.userId && !OFFICE.includes(actor.role)) throw new TaskError("Це не ваша задача", 403);
  if (t.status !== "ASSIGNED") throw new TaskError(t.status === "DONE" ? "Задачу вже виконано" : "Задачу ще не надіслано", 409);
  const doneNote = typeof note === "string" ? note.trim().slice(0, NOTE_MAX) || null : null;
  const now = new Date();

  const res = await prisma.staffTask.updateMany({
    where: { id, status: "ASSIGNED" },
    data: { status: "DONE", doneAt: now, doneNote, doneNotifiedAt: actor.userId === t.createdById ? now : null },
  });
  if (res.count !== 1) throw new TaskError("Задачу щойно змінили — оновіть сторінку", 409);
  return getRow(id);
}

export async function reopenTask(id: string): Promise<TaskRow> {
  const res = await prisma.staffTask.updateMany({
    where: { id, status: "DONE" },
    data: { status: "ASSIGNED", doneAt: null, doneNote: null, doneNotifiedAt: null },
  });
  if (res.count !== 1) {
    await existing(id);
    throw new TaskError("Відкрити знову можна лише виконану задачу", 409);
  }
  return getRow(id);
}

/**
 * «Надіслати всі готові» з наради.
 *
 * Лише ті, де виконавця назвали на нараді, а клієнт (якщо звучав) прив'язаний
 * однозначно. Решта чекає, поки керівник подивиться сам.
 */
export async function confirmReady(actorId: string, meetingId: string): Promise<{ sent: number; left: number }> {
  const proposed = await prisma.staffTask.findMany({
    where: { meetingId, status: "PROPOSED" },
    select: { id: true, status: true, assigneeId: true, assigneeConfidence: true, clientNameHeard: true, counterpartyId: true },
  });
  const ready = proposed.filter(isTaskReady).map((t) => t.id);
  let sent = 0;
  if (ready.length > 0) {
    const res = await prisma.staffTask.updateMany({
      where: { id: { in: ready }, status: "PROPOSED" },
      data: { status: "ASSIGNED", sentAt: new Date(), pushedAt: null, createdById: actorId },
    });
    sent = res.count;
  }
  return { sent, left: proposed.length - sent };
}
