/**
 * Пуш про нове повідомлення в чаті.
 *
 * Лише пуш у застосунок — рішення власника (09.09.2026). Модуль без імпортів
 * next/*: його кличе роут через afterResponse, але так само його міг би
 * викликати воркер.
 */

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push/send";
import { GROUP_LABEL, OFFICE, STAFF, chatPathFor, dmKey, isGroupRole, parseKey, type GroupRole } from "./audience";
import { whereForKey } from "./queries";

/**
 * Захист від шторму: якщо попереднє повідомлення в розмові молодше за це
 * вікно і людина його ще не читала — у неї вже висить пуш, другий не шлемо.
 */
const BURST_MS = 60_000;

function firstLine(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/[*_`>|]/g, "").trim())
    .find((l) => l.length > 0) ?? "";
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

export async function notifyStaffMessage(messageId: string): Promise<void> {
  const msg = await prisma.staffMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      authorId: true,
      text: true,
      quote: true,
      kind: true,
      toAll: true,
      toRoles: true,
      toUserId: true,
      createdAt: true,
      author: { select: { name: true } },
      _count: { select: { photos: true } },
    },
  });
  if (!msg) return;

  const groups = msg.toRoles.filter(isGroupRole);

  const recipients = msg.toUserId
    ? await prisma.user.findMany({ where: { id: msg.toUserId }, select: { id: true, role: true } })
    : msg.toAll
      ? await prisma.user.findMany({
          where: { role: { in: [...STAFF] as Role[] }, id: { not: msg.authorId } },
          select: { id: true, role: true },
        })
      : await prisma.user.findMany({
          where: { role: { in: [...groups, ...OFFICE] as Role[] }, id: { not: msg.authorId } },
          select: { id: true, role: true },
        });
  if (recipients.length === 0) return;

  /** Розмова, яку відкриє тап: у поля — своя група, в офісу — перша з обраних. */
  const keyFor = (role: string): string => {
    if (msg.toUserId) return dmKey(msg.authorId, msg.toUserId);
    if (msg.toAll) return "all";
    const own = groups.find((g) => g === role);
    return `role-${own ?? groups[0]}`;
  };

  const byKey = new Map<string, { id: string; role: string }[]>();
  for (const r of recipients) {
    const key = keyFor(r.role);
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }

  const skip = new Set<string>();
  for (const [key, people] of byKey) {
    const k = parseKey(key);
    if (!k) continue;
    const prev = await prisma.staffMessage.findFirst({
      where: { AND: [whereForKey(k), { createdAt: { lt: msg.createdAt } }] },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, authorId: true },
    });
    if (!prev || msg.createdAt.getTime() - prev.createdAt.getTime() > BURST_MS) continue;
    const reads = await prisma.staffChatRead.findMany({
      where: { conversation: key, userId: { in: people.map((p) => p.id) } },
      select: { userId: true, readAt: true },
    });
    const readAt = new Map(reads.map((r) => [r.userId, r.readAt.getTime()]));
    for (const p of people) {
      // Попереднє писав він сам — непрочитаного в нього немає, пуш потрібен.
      if (prev.authorId === p.id) continue;
      if ((readAt.get(p.id) ?? 0) < prev.createdAt.getTime()) skip.add(p.id);
    }
  }

  const suffix = msg.toUserId
    ? ""
    : msg.toAll
      ? " → Усі"
      : ` → ${groups.map((g) => GROUP_LABEL[g as GroupRole]).join(", ")}`;
  const title = `${msg.author.name}${suffix}`;
  const photos = msg._count.photos;
  const body = msg.text
    ? clip(msg.text, 140) + (photos > 0 ? " 📷" : "")
    : photos > 0
      ? `📷 Фото${photos > 1 ? ` ×${photos}` : ""}`
      : msg.quote
        ? clip(`Відповідь помічника: ${firstLine(msg.quote)}`, 140)
        : "Нове повідомлення";

  await Promise.all(
    recipients
      .filter((r) => !skip.has(r.id))
      .map((r) =>
        sendPushToUser(r.id, {
          title,
          body,
          data: { screen: "/cabinet", target: chatPathFor(r.role, keyFor(r.role)) },
        }).catch((e) => console.error("[chat-notify]", e))
      )
  );
}
