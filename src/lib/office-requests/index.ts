/**
 * Заявки торгового в офіс.
 *
 * «Заведіть клієнта в 1С», «змініть телефон», «дайте відстрочку» — дзвінки,
 * після яких прохання живе в пам'яті менеджера. Тут воно стає рядком зі
 * статусом. Сайт у 1С не пише (правило проєкту): заявку виконує людина в 1С,
 * а на сайті лише позначає «виконано» чи «відхилено» з відповіддю.
 *
 * Про закриття автор отримує рядок у стрічку й пуш — у робочі години й
 * якщо не вимкнув категорію. Без Telegram: станом на 13.09.2026 жоден
 * офісний обліковий запис його не прив'язав.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push/send";
import { inPushHours, shortName } from "@/lib/rep-feed/format";
import { isPushMuted, parsePushPrefs } from "@/lib/rep-feed/prefs";
import { REP_FEED_TYPES } from "@/lib/rep-feed/types";

export const REQUEST_KINDS = [
  { key: "NEW_CLIENT", label: "Завести клієнта", hint: "Назва, ЄДРПОУ, телефон, адреса доставки, контактна особа." },
  { key: "REQUISITES", label: "Змінити дані клієнта", hint: "Що саме змінити: телефон, адреса, назва, реквізити." },
  { key: "CREDIT", label: "Відстрочка чи ліміт", hint: "Сума, на скільки днів і чому клієнту можна." },
  { key: "OTHER", label: "Інше", hint: "Що потрібно від офісу." },
] as const;

export type RequestKind = (typeof REQUEST_KINDS)[number]["key"];

export const REQUEST_STATUS = { OPEN: "Відкрита", DONE: "Виконано", REJECTED: "Відхилено" } as const;
export type RequestStatus = keyof typeof REQUEST_STATUS;

export const TEXT_MIN = 5;
export const TEXT_MAX = 2000;
export const ANSWER_MAX = 1000;

export class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function kindLabel(kind: string): string {
  return REQUEST_KINDS.find((k) => k.key === kind)?.label ?? "Заявка";
}

/** Чиста перевірка вводу торгового; кидає RequestError з людським текстом. */
export function validateRequestInput(input: unknown): { kind: RequestKind; text: string; counterpartyId: string | null } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = REQUEST_KINDS.find((k) => k.key === o.kind)?.key;
  if (!kind) throw new RequestError("Оберіть, що потрібно від офісу");
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (text.length < TEXT_MIN) throw new RequestError("Опишіть заявку хоча б кількома словами");
  if (text.length > TEXT_MAX) throw new RequestError(`Задовго: до ${TEXT_MAX} символів`);
  const counterpartyId = typeof o.counterpartyId === "string" && o.counterpartyId ? o.counterpartyId : null;
  if (kind !== "NEW_CLIENT" && kind !== "OTHER" && !counterpartyId) {
    throw new RequestError("Для цієї заявки відкрийте її з картки клієнта");
  }
  return { kind, text, counterpartyId };
}

export type RequestRow = {
  id: string;
  kind: string;
  kindLabel: string;
  text: string;
  status: RequestStatus;
  statusLabel: string;
  answer: string | null;
  createdAt: string;
  doneAt: string | null;
  counterparty: { id: string; name: string } | null;
  author: { id: string; name: string };
  doneBy: { id: string; name: string } | null;
};

type DbRow = Prisma.OfficeRequestGetPayload<{ include: { author: { select: { id: true; name: true } } } }>;

async function shape(rows: DbRow[]): Promise<RequestRow[]> {
  const cpIds = [...new Set(rows.map((r) => r.counterpartyId).filter((x): x is string => !!x))];
  const doneIds = [...new Set(rows.map((r) => r.doneById).filter((x): x is string => !!x))];
  const [cps, doners] = await Promise.all([
    cpIds.length ? prisma.counterparty.findMany({ where: { id: { in: cpIds } }, select: { id: true, name: true } }) : [],
    doneIds.length ? prisma.user.findMany({ where: { id: { in: doneIds } }, select: { id: true, name: true } }) : [],
  ]);
  const cpName = new Map(cps.map((c) => [c.id, c.name]));
  const doneName = new Map(doners.map((u) => [u.id, u.name.trim()]));
  return rows.map((r) => {
    const status = (r.status in REQUEST_STATUS ? r.status : "OPEN") as RequestStatus;
    return {
      id: r.id,
      kind: r.kind,
      kindLabel: kindLabel(r.kind),
      text: r.text,
      status,
      statusLabel: REQUEST_STATUS[status],
      answer: r.answer,
      createdAt: r.createdAt.toISOString(),
      doneAt: r.doneAt?.toISOString() ?? null,
      counterparty: r.counterpartyId ? { id: r.counterpartyId, name: cpName.get(r.counterpartyId) ?? "Клієнт" } : null,
      author: { id: r.author.id, name: r.author.name.trim() },
      doneBy: r.doneById ? { id: r.doneById, name: doneName.get(r.doneById) ?? "Офіс" } : null,
    };
  });
}

export async function listRequests(opts: { authorId?: string; status?: string | null } = {}): Promise<RequestRow[]> {
  const status = opts.status && opts.status in REQUEST_STATUS ? opts.status : undefined;
  const rows = await prisma.officeRequest.findMany({
    where: { ...(opts.authorId ? { authorId: opts.authorId } : {}), ...(status ? { status } : {}) },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return shape(rows);
}

export async function createRequest(authorId: string, input: unknown): Promise<RequestRow> {
  const v = validateRequestInput(input);
  if (v.counterpartyId) {
    const cp = await prisma.counterparty.findUnique({ where: { id: v.counterpartyId }, select: { id: true } });
    if (!cp) throw new RequestError("Клієнта не знайдено", 404);
  }
  const row = await prisma.officeRequest.create({
    data: { authorId, kind: v.kind, text: v.text, counterpartyId: v.counterpartyId },
    include: { author: { select: { id: true, name: true } } },
  });
  return (await shape([row]))[0];
}

/**
 * Закрити заявку. Повертає рядок і функцію сповіщення автора — роут кличе її
 * після відповіді (afterResponse), щоб офіс не чекав на Expo.
 */
export async function resolveRequest(
  doneById: string,
  id: string,
  input: unknown
): Promise<{ row: RequestRow; notify: () => Promise<void> }> {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const status = o.status === "DONE" || o.status === "REJECTED" ? o.status : null;
  if (!status) throw new RequestError("Статус має бути «виконано» або «відхилено»");
  const answer = typeof o.answer === "string" ? o.answer.trim().slice(0, ANSWER_MAX) || null : null;
  if (status === "REJECTED" && !answer) throw new RequestError("Напишіть, чому відхилено — торговий побачить це");

  const existing = await prisma.officeRequest.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw new RequestError("Заявку не знайдено", 404);
  if (existing.status !== "OPEN") throw new RequestError("Заявку вже закрито", 409);

  const row = await prisma.officeRequest.update({
    where: { id },
    data: { status, answer, doneById, doneAt: new Date() },
    include: { author: { select: { id: true, name: true } } },
  });
  const shaped = (await shape([row]))[0];
  return { row: shaped, notify: () => notifyAuthor(shaped) };
}

async function notifyAuthor(r: RequestRow): Promise<void> {
  try {
    const author = await prisma.user.findUnique({
      where: { id: r.author.id },
      select: { role: true, notificationPrefs: true },
    });
    if (!author) return;

    const title = `${r.status === "DONE" ? "Офіс виконав" : "Офіс відхилив"}: ${r.kindLabel.toLowerCase()}`;
    const body = [r.counterparty ? shortName(r.counterparty.name, 36) : null, r.answer ?? shortName(r.text, 80)]
      .filter(Boolean)
      .join(" · ");

    let notificationId: string | null = null;
    try {
      const n = await prisma.notification.create({
        data: {
          userId: r.author.id,
          type: REP_FEED_TYPES.REQUEST_DONE,
          title,
          body,
          relatedId: r.id,
          dedupKey: `${REP_FEED_TYPES.REQUEST_DONE}:${r.id}:${r.status}`,
        },
        select: { id: true },
      });
      notificationId = n.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
      throw e;
    }

    const muted = isPushMuted(parsePushPrefs(author.notificationPrefs), REP_FEED_TYPES.REQUEST_DONE);
    if (author.role !== "SALES" || muted || !inPushHours(new Date())) return;

    await sendPushToUser(r.author.id, { title, body, data: { screen: "/cabinet", target: "/sales/requests" } });
    await prisma.notification.update({ where: { id: notificationId }, data: { pushedAt: new Date() } });
  } catch (e) {
    console.error("[office-requests] не вдалося сповістити автора:", e);
  }
}
