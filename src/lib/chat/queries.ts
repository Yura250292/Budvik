/**
 * Чат персоналу: читання, запис, непрочитане.
 *
 * Уся бізнес-логіка тут, а не в роутах: роути лише впізнають людину й
 * розбирають JSON, щоб та сама логіка була доступна перевірочним скриптам
 * без піднятого сервера.
 */

import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  GROUPS,
  STAFF,
  type Audience,
  type ConversationKey,
  type GroupRole,
  type Me,
  canRead,
  canWriteAudience,
  dmKey,
  formatKey,
  groupsFor,
  hasJournal,
  isGroupRole,
  isOffice,
  isStaff,
  keysOf,
  parseKey,
} from "./audience";

export class ChatError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export const MAX_TEXT = 4000;
export const MAX_PHOTOS = 4;
/** Скільки повідомлень віддаємо за раз — і скільки читаємо для зведення. */
export const PAGE = 50;
const SUMMARY_WINDOW = 300;

export type Person = { id: string; name: string; role: string; avatarUrl: string | null; color: string | null };

export type ChatPhoto = { id: string; url: string; width: number; height: number };

export type ChatMessage = {
  id: string;
  kind: "TEXT" | "ASSISTANT";
  text: string;
  quote: string | null;
  toAll: boolean;
  toRoles: string[];
  toUserId: string | null;
  sourceSection: string | null;
  createdAt: string;
  author: Person;
  photos: ChatPhoto[];
  /** У яких розмовах це повідомлення живе (без журналу). */
  keys: string[];
};

export type ConversationSummary = {
  key: string;
  type: ConversationKey["type"];
  label: string;
  /** Для особистої — з ким. */
  userId?: string;
  unread: number;
  last: {
    id: string;
    text: string;
    authorName: string;
    kind: "TEXT" | "ASSISTANT";
    hasPhotos: boolean;
    createdAt: string;
  } | null;
};

export const MESSAGE_SELECT = {
  id: true,
  kind: true,
  text: true,
  quote: true,
  toAll: true,
  toRoles: true,
  toUserId: true,
  sourceSection: true,
  createdAt: true,
  authorId: true,
  author: { select: { id: true, name: true, role: true, avatarUrl: true, color: true } },
  photos: {
    select: { id: true, url: true, width: true, height: true },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.StaffMessageSelect;

type Row = Prisma.StaffMessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

export function serialize(m: Row): ChatMessage {
  return {
    id: m.id,
    kind: m.kind,
    text: m.text,
    quote: m.quote,
    toAll: m.toAll,
    toRoles: m.toRoles,
    toUserId: m.toUserId,
    sourceSection: m.sourceSection,
    createdAt: m.createdAt.toISOString(),
    author: m.author,
    photos: m.photos,
    keys: keysOf(m),
  };
}

/** Що людині видно взагалі — для зведення по всіх розмовах одразу. */
export function visibleWhere(me: Me): Prisma.StaffMessageWhereInput {
  if (hasJournal(me.role)) return {};
  if (isOffice(me.role)) {
    return { OR: [{ toAll: true }, { toRoles: { isEmpty: false } }, { toUserId: me.userId }, { authorId: me.userId }] };
  }
  return {
    OR: [
      { toAll: true },
      ...(isGroupRole(me.role) ? [{ toRoles: { has: me.role as Role } }] : []),
      { toUserId: me.userId },
      { authorId: me.userId },
    ],
  };
}

export function whereForKey(k: ConversationKey): Prisma.StaffMessageWhereInput {
  switch (k.type) {
    case "all":
      return { toAll: true };
    case "role":
      return { toRoles: { has: k.role } };
    case "dm":
      return {
        OR: [
          { authorId: k.a, toUserId: k.b },
          { authorId: k.b, toUserId: k.a },
        ],
      };
    case "journal":
      return {};
  }
}

export async function listPeople(): Promise<Person[]> {
  return prisma.user.findMany({
    where: { role: { in: [...STAFF] as Role[] } },
    select: { id: true, name: true, role: true, avatarUrl: true, color: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}

function labelForKey(k: ConversationKey, me: Me, people: Map<string, Person>): string {
  switch (k.type) {
    case "all":
      return "Усі";
    case "journal":
      return "Журнал";
    case "role":
      return GROUPS.find((g) => g.role === k.role)?.label ?? k.role;
    case "dm": {
      const other = k.a === me.userId ? k.b : k.a;
      if (k.a !== me.userId && k.b !== me.userId) {
        // Чужа особиста в журналі адміністратора: обидва імені.
        return `${people.get(k.a)?.name ?? "Співробітник"} ↔ ${people.get(k.b)?.name ?? "Співробітник"}`;
      }
      return people.get(other)?.name ?? "Співробітник";
    }
  }
}

/**
 * Список розмов із непрочитаним — рівно чотири запити, без N+1.
 *
 * Останні 300 видимих повідомлень розкладаються по розмовах у памʼяті: у
 * компанії десяток людей, і 300 — це тиждень-два переписки. Групова розмова
 * без повідомлень у цьому вікні просто не має превʼю.
 */
export async function summarize(me: Me): Promise<{
  conversations: ConversationSummary[];
  totalUnread: number;
  people: Person[];
}> {
  const [reads, recent, partners, people] = await Promise.all([
    prisma.staffChatRead.findMany({ where: { userId: me.userId }, select: { conversation: true, readAt: true } }),
    prisma.staffMessage.findMany({
      where: visibleWhere(me),
      orderBy: { createdAt: "desc" },
      take: SUMMARY_WINDOW,
      select: {
        id: true,
        kind: true,
        text: true,
        toAll: true,
        toRoles: true,
        toUserId: true,
        authorId: true,
        createdAt: true,
        author: { select: { name: true } },
        _count: { select: { photos: true } },
      },
    }),
    prisma.staffMessage.findMany({
      where: { OR: [{ toUserId: me.userId }, { authorId: me.userId, toUserId: { not: null } }] },
      distinct: ["authorId", "toUserId"],
      select: { authorId: true, toUserId: true },
    }),
    listPeople(),
  ]);

  const readAt = new Map(reads.map((r) => [r.conversation, r.readAt.getTime()]));
  const peopleById = new Map(people.map((p) => [p.id, p]));

  type Bucket = { last: ConversationSummary["last"]; unread: number; lastAt: number };
  const buckets = new Map<string, Bucket>();
  const unreadIds = new Set<string>();
  const journal = hasJournal(me.role);

  for (const m of recent) {
    const keys = keysOf(m).filter((key) => {
      const k = parseKey(key);
      return k ? canRead(me, k) : false;
    });
    if (journal) keys.push("journal");
    for (const key of keys) {
      const b = buckets.get(key) ?? { last: null, unread: 0, lastAt: 0 };
      if (!b.last) {
        b.last = {
          id: m.id,
          text: m.text,
          authorName: m.author.name,
          kind: m.kind,
          hasPhotos: m._count.photos > 0,
          createdAt: m.createdAt.toISOString(),
        };
        b.lastAt = m.createdAt.getTime();
      }
      const unread = m.authorId !== me.userId && m.createdAt.getTime() > (readAt.get(key) ?? 0);
      if (unread) {
        b.unread += 1;
        if (key !== "journal") unreadIds.add(m.id);
      }
      buckets.set(key, b);
    }
  }

  const conversations: ConversationSummary[] = [];
  for (const key of groupsFor(me.role)) {
    const k = parseKey(key)!;
    const b = buckets.get(key);
    conversations.push({ key, type: k.type, label: labelForKey(k, me, peopleById), unread: b?.unread ?? 0, last: b?.last ?? null });
  }

  const partnerIds = new Set<string>();
  for (const p of partners) {
    const other = p.authorId === me.userId ? p.toUserId : p.authorId;
    if (other && other !== me.userId) partnerIds.add(other);
  }
  const dms = [...partnerIds].map((other) => {
    const key = dmKey(me.userId, other);
    const b = buckets.get(key);
    const person = peopleById.get(other);
    return {
      summary: {
        key,
        type: "dm" as const,
        label: person?.name ?? "Співробітник",
        userId: other,
        unread: b?.unread ?? 0,
        last: b?.last ?? null,
      },
      lastAt: b?.lastAt ?? 0,
    };
  });
  dms.sort((x, y) => y.lastAt - x.lastAt);
  conversations.push(...dms.map((d) => d.summary));

  if (journal) {
    const b = buckets.get("journal");
    conversations.push({ key: "journal", type: "journal", label: "Журнал", unread: b?.unread ?? 0, last: b?.last ?? null });
  }

  return { conversations, totalUnread: unreadIds.size, people };
}

export async function listMessages(
  me: Me,
  key: string,
  opts: { before?: Date | null; limit?: number } = {}
): Promise<{ conversation: { key: string; type: ConversationKey["type"]; label: string; canWrite: boolean; userId?: string }; messages: ChatMessage[]; hasMore: boolean }> {
  const k = parseKey(key);
  if (!k) throw new ChatError(404, "Розмову не знайдено");
  if (!canRead(me, k)) throw new ChatError(403, "Немає доступу до цієї розмови");

  const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), 200);
  const rows = await prisma.staffMessage.findMany({
    where: { AND: [whereForKey(k), ...(opts.before ? [{ createdAt: { lt: opts.before } }] : [])] },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: MESSAGE_SELECT,
  });
  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).reverse().map(serialize);

  const people = new Map((await listPeople()).map((p) => [p.id, p]));

  /** Співрозмовник — лише у СВОЇЙ особистій: у журналі адмін дивиться чужу. */
  let partner: string | undefined;
  let canWrite = false;
  if (k.type === "dm") {
    const mine = k.a === me.userId || k.b === me.userId;
    if (mine) partner = k.a === me.userId ? k.b : k.a;
    canWrite = mine;
  } else if (k.type !== "journal") {
    canWrite = canWriteAudience(me, {
      toAll: k.type === "all",
      toRoles: k.type === "role" ? [k.role] : [],
      toUserId: null,
    });
  }

  return {
    conversation: {
      key: formatKey(k),
      type: k.type,
      label: labelForKey(k, me, people),
      canWrite,
      ...(partner ? { userId: partner } : {}),
    },
    messages,
    hasMore,
  };
}

export type CreateInput = {
  text?: unknown;
  toAll?: unknown;
  toRoles?: unknown;
  toUserId?: unknown;
  sourceAssistantMessageId?: unknown;
  sourceSection?: unknown;
  photos?: unknown;
};

const SECTIONS = ["sales", "driver", "warehouse", "admin"] as const;
const PHOTO_KEY = (userId: string) => new RegExp(`^chat/\\d{4}/\\d{2}/${userId}-[a-z0-9]+\\.(jpg|png|webp)$`);

/** Рядки-кнопки помічника («> 💬 …») у чаті не працюють — зрізаємо. */
export function stripChips(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !/^>\s*💬/.test(line))
    .join("\n")
    .trim();
}

export function normalizeAudience(input: CreateInput): Audience {
  const toAll = input.toAll === true;
  const rolesRaw = Array.isArray(input.toRoles) ? input.toRoles : [];
  const toRoles = toAll ? [] : [...new Set(rolesRaw.filter((r): r is GroupRole => typeof r === "string" && isGroupRole(r)))];
  const toUserId = typeof input.toUserId === "string" && input.toUserId ? input.toUserId : null;
  return { toAll, toRoles, toUserId };
}

export async function createMessage(me: Me, input: CreateInput): Promise<{ message: ChatMessage; conversation: string }> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length > MAX_TEXT) throw new ChatError(400, "Задовге повідомлення");

  const audience = normalizeAudience(input);
  if (!audience.toAll && audience.toRoles.length === 0 && !audience.toUserId) {
    throw new ChatError(400, "Оберіть, кому написати");
  }
  if (audience.toUserId && (audience.toAll || (Array.isArray(input.toRoles) && input.toRoles.length > 0))) {
    throw new ChatError(400, "Або групи, або одна людина");
  }
  if (audience.toUserId === me.userId) throw new ChatError(400, "Не можна писати самому собі");
  if (!canWriteAudience(me, audience)) throw new ChatError(403, "Немає доступу");

  if (audience.toUserId) {
    const to = await prisma.user.findUnique({ where: { id: audience.toUserId }, select: { role: true } });
    if (!to || !isStaff(to.role)) throw new ChatError(404, "Такого користувача немає");
  }

  let quote: string | null = null;
  let sourceId: string | null = null;
  let sourceSection: string | null = null;
  if (typeof input.sourceAssistantMessageId === "string" && input.sourceAssistantMessageId) {
    // Текст беремо з бази, а не з тіла запиту: інакше «відповідь помічника»
    // можна було б вигадати.
    const source = await prisma.assistantMessage.findUnique({
      where: { id: input.sourceAssistantMessageId },
      select: { role: true, content: true, thread: { select: { userId: true } } },
    });
    if (!source || source.role !== "ASSISTANT" || source.thread.userId !== me.userId) {
      throw new ChatError(404, "Відповідь помічника не знайдено");
    }
    quote = stripChips(source.content);
    sourceId = input.sourceAssistantMessageId;
    sourceSection = SECTIONS.includes(input.sourceSection as (typeof SECTIONS)[number])
      ? (input.sourceSection as string)
      : null;
  }

  const photosRaw = Array.isArray(input.photos) ? input.photos : [];
  if (photosRaw.length > MAX_PHOTOS) throw new ChatError(400, `Не більше ${MAX_PHOTOS} фото`);
  const keyRe = PHOTO_KEY(me.userId);
  const base = process.env.R2_PUBLIC_URL ?? "";
  const photos = photosRaw.map((p, i) => {
    const key = typeof p?.key === "string" ? p.key : "";
    if (!keyRe.test(key)) throw new ChatError(400, "Фото не належить цьому повідомленню");
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
    return { key, url: `${base}/${key}`, width: num(p.width), height: num(p.height), bytes: num(p.bytes), position: i };
  });

  if (!text && !quote && photos.length === 0) throw new ChatError(400, "Порожнє повідомлення");

  const row = await prisma.staffMessage.create({
    data: {
      authorId: me.userId,
      kind: quote ? "ASSISTANT" : "TEXT",
      text,
      quote,
      toAll: audience.toAll,
      toRoles: audience.toRoles,
      toUserId: audience.toUserId,
      sourceAssistantMessageId: sourceId,
      sourceSection,
      ...(photos.length > 0 ? { photos: { createMany: { data: photos } } } : {}),
    },
    select: MESSAGE_SELECT,
  });

  const message = serialize(row);
  return { message, conversation: message.keys[0] ?? "all" };
}

/**
 * Дочитано до `upTo` — мітки найновішого повідомлення, яке людина бачила.
 *
 * Не now(): повідомлення, що прийшло між завантаженням і відміткою, інакше
 * вважалося б прочитаним. GREATEST — щоб запізніла відмітка не відкотила
 * свіжішу.
 */
export async function markRead(me: Me, key: string, upTo: Date): Promise<Date> {
  const k = parseKey(key);
  if (!k) throw new ChatError(404, "Розмову не знайдено");
  if (!canRead(me, k)) throw new ChatError(403, "Немає доступу до цієї розмови");
  const conversation = formatKey(k);
  const rows = await prisma.$queryRaw<{ readAt: Date }[]>`
    INSERT INTO "StaffChatRead" ("userId", "conversation", "readAt")
    VALUES (${me.userId}, ${conversation}, ${upTo})
    ON CONFLICT ("userId", "conversation")
    DO UPDATE SET "readAt" = GREATEST("StaffChatRead"."readAt", EXCLUDED."readAt")
    RETURNING "readAt"
  `;
  return rows[0]?.readAt ?? upTo;
}

export async function unreadTotal(me: Me): Promise<number> {
  return (await summarize(me)).totalUnread;
}
