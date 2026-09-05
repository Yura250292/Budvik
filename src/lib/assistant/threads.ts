/**
 * Розмови й повідомлення: збереження, історія для моделі, замок.
 *
 * Історія обрізається двічі — по кількості реплік і по символах. Причина
 * не в грошах: DeepSeek дешевий. Причина в тому, що довга історія витісняє
 * з уваги моделі результати інструментів, і вона починає відповідати «як
 * минулого разу» замість того, щоб подивитись у свіжі дані.
 *
 * Службові TOOL-повідомлення в історію НЕ йдуть. Вони важать більше за
 * все інше разом, а їхня цінність зникає, щойно модель сформулювала
 * відповідь: потрібні числа вже в тексті. Лишається тільки список id — за
 * ним перевіряються посилання.
 */

import { prisma } from "@/lib/prisma";
import type { AssistantRole, Prisma } from "@prisma/client";
import { HISTORY_MAX_CHARS, HISTORY_MAX_MESSAGES } from "@/lib/assistant/config";
import type { ChatMessage, ToolCall } from "@/lib/assistant/types";
import { emptyEntities, type SeenEntities } from "@/lib/assistant/guards";

/** Скільки часу тримається замок на розмову, поки формується відповідь. */
const BUSY_MS = 130_000;

/**
 * Обрізана репліка помічника в історії.
 *
 * ОСТАННЯ відповідь лишається майже цілою: саме до неї звертаються «а
 * чому в мене там прострочка», «як догнати сусіда» — і без таблиці перед
 * очима модель починає перепитувати. Давніші стискаємо сильно: числа з
 * них вона однаково піде брати заново, а місце вони з'їдають у КОЖНОМУ
 * раунді ходу.
 */
const HISTORY_LAST_ASSISTANT_MAX = 2_400;
const HISTORY_ASSISTANT_MAX = 600;

export async function createThread(userId: string, repId: string) {
  return prisma.assistantThread.create({
    data: { userId, repId },
    select: { id: true, repId: true, createdAt: true },
  });
}

export async function listThreads(userId: string, limit = 30) {
  const rows = await prisma.assistantThread.findMany({
    where: { userId },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      repId: true,
      lastMessageAt: true,
      createdAt: true,
      rep: { select: { name: true } },
    },
  });

  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    repId: t.repId,
    repName: t.rep.name,
    lastMessageAt: (t.lastMessageAt ?? t.createdAt).toISOString(),
  }));
}

export async function getThreadForUser(threadId: string, userId: string) {
  const thread = await prisma.assistantThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      userId: true,
      repId: true,
      title: true,
      rep: { select: { id: true, name: true } },
    },
  });
  if (!thread || thread.userId !== userId) return null;
  return thread;
}

export async function deleteThread(threadId: string) {
  await prisma.assistantThread.delete({ where: { id: threadId } });
}

/**
 * Замок на розмову.
 *
 * Два ходи в одній розмові одночасно зіпсували б порядок повідомлень:
 * інструменти першого дописалися б усередину другого, і модель побачила б
 * відповідь на питання, якого не ставили. updateMany з умовою — атомарний
 * захват: другий запит отримає 0 оновлених рядків.
 */
export async function acquireBusy(threadId: string): Promise<boolean> {
  const now = new Date();
  const { count } = await prisma.assistantThread.updateMany({
    where: {
      id: threadId,
      OR: [{ busyUntil: null }, { busyUntil: { lt: now } }],
    },
    data: { busyUntil: new Date(now.getTime() + BUSY_MS) },
  });
  return count > 0;
}

export async function releaseBusy(threadId: string) {
  await prisma.assistantThread
    .update({ where: { id: threadId }, data: { busyUntil: null } })
    .catch(() => {});
}

export async function appendMessage(input: {
  threadId: string;
  role: AssistantRole;
  content: string;
  toolCalls?: ToolCall[] | null;
  toolCallId?: string | null;
  toolName?: string | null;
  entityIds?: string[];
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number | null;
  error?: string | null;
}) {
  return prisma.assistantMessage.create({
    data: {
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      toolCalls: (input.toolCalls ?? undefined) as Prisma.InputJsonValue | undefined,
      toolCallId: input.toolCallId ?? null,
      toolName: input.toolName ?? null,
      entityIds: input.entityIds ?? [],
      promptTokens: input.promptTokens ?? 0,
      completionTokens: input.completionTokens ?? 0,
      durationMs: input.durationMs ?? null,
      error: input.error ?? null,
    },
    select: { id: true, createdAt: true },
  });
}

/** Підпис розмови — перше питання; ставимо один раз. */
export async function touchThread(threadId: string, firstQuestion: string | null) {
  const data: Prisma.AssistantThreadUpdateInput = { lastMessageAt: new Date() };
  if (firstQuestion) {
    data.title = firstQuestion.length > 80 ? `${firstQuestion.slice(0, 79)}…` : firstQuestion;
  }
  await prisma.assistantThread.update({ where: { id: threadId }, data });
}

export async function addUsage(threadId: string, tokens: number) {
  if (tokens <= 0) return;
  await prisma.assistantThread
    .update({ where: { id: threadId }, data: { totalTokens: { increment: tokens } } })
    .catch(() => {});
}

/** Історія для моделі: лише питання й відповіді, свіжі — цілими. */
export async function loadHistoryForModel(threadId: string): Promise<ChatMessage[]> {
  const rows = await prisma.assistantMessage.findMany({
    where: { threadId, role: { in: ["USER", "ASSISTANT"] }, error: null },
    orderBy: { createdAt: "desc" },
    take: HISTORY_MAX_MESSAGES,
    select: { role: true, content: true },
  });

  const picked: ChatMessage[] = [];
  let chars = 0;
  let assistantSeen = 0;
  for (const row of rows) {
    if (!row.content.trim()) continue;
    // rows ідуть від найсвіжішої, тож перша репліка помічника — остання в розмові.
    const limit =
      row.role === "ASSISTANT"
        ? assistantSeen++ === 0
          ? HISTORY_LAST_ASSISTANT_MAX
          : HISTORY_ASSISTANT_MAX
        : Infinity;
    /**
     * Службовий блок маршруту в історію не йде.
     *
     * Це півтори тисячі символів координат, які моделі ні про що не
     * кажуть: точки вона однаково не читає, а місце в контексті вони
     * з'їдають при КОЖНОМУ наступному запиті. Людині ж лишається сам
     * список — його малює кабінет.
     */
    const body = row.content.replace(
      /```budvik-route[\s\S]*?```/g,
      "(маршрут показано списком у кабінеті)"
    );
    const content = body.length > limit ? `${body.slice(0, limit)}…` : body;
    if (chars + content.length > HISTORY_MAX_CHARS) break;
    chars += content.length;
    picked.push(
      row.role === "USER"
        ? { role: "user", content }
        : { role: "assistant", content }
    );
  }
  return picked.reverse();
}

/**
 * Що модель уже бачила в цій розмові — для перевірки посилань.
 *
 * Зберігаємо плоский список id, а не самі результати: перевірка звучить
 * «чи показували ми колись цього клієнта», і для неї цього досить.
 */
export async function loadSeenEntities(threadId: string): Promise<SeenEntities> {
  const rows = await prisma.assistantMessage.findMany({
    where: { threadId, role: "TOOL" },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { entityIds: true },
  });

  const seen = emptyEntities();
  for (const row of rows) {
    for (const id of row.entityIds) {
      seen.clients.add(id);
      if (!seen.products.has(id)) seen.products.set(id, null);
    }
  }
  return seen;
}
