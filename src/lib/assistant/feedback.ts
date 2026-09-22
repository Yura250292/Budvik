/**
 * Петля якості помічника: оцінка керівника і автосигнали в одній черзі.
 *
 * Чому знімок, а не посилання на репліку. `AssistantThread.messages`
 * видаляється каскадом, а розмови прибирають однією кнопкою — тобто
 * керівник, чистячи історію, стер би разом із нею весь свій розбір. Тому
 * питання, відповідь і слід інструментів лежать у рядку копією, а
 * `messageId` лише `SetNull`: поки розмова жива, з картки можна в неї
 * перейти.
 *
 * Знімок збирає СЕРВЕР, і ніколи не приймає його від браузера: інакше
 * будь-хто зі штату міг би підкласти в чергу вигаданий текст.
 *
 * Приємна властивість наявної схеми: TOOL-рядки зберігають повний JSON
 * результату кожного інструмента, тож числового вартового можна
 * відтворити заднім числом — навіть для відповідей, що вже лежать у базі.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { collectEntities, emptyEntities, verifyNumbers } from "@/lib/assistant/guards";
import { withoutBlocks } from "@/lib/assistant/blocks";
import { detectIntent } from "@/lib/assistant/router";
import { kindForThread } from "@/lib/assistant/scope";
import type { AssistantKind } from "@/lib/assistant/types";

/** Слід інструментів так, як його показує ToolTrace. */
export type TraceStep = { name: string; ms: number | null; ok: boolean };

export type TurnSnapshot = {
  threadId: string;
  userId: string;
  kind: AssistantKind | null;
  question: string;
  answer: string;
  toolTrace: TraceStep[];
  model: string | null;
  viaModel: boolean;
  intent: string | null;
  rounds: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number | null;
  numbersChecked: number;
  numbersUnverified: number;
  lessonIds: string[];
};

/**
 * Зібрати знімок ходу навколо однієї відповіді помічника.
 *
 * Повертає null, якщо репліки немає або це не відповідь ASSISTANT —
 * оцінювати можна лише те, що помічник сказав.
 */
export async function buildSnapshot(messageId: string): Promise<TurnSnapshot | null> {
  const message = await prisma.assistantMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      threadId: true,
      role: true,
      content: true,
      toolName: true,
      promptTokens: true,
      completionTokens: true,
      durationMs: true,
      createdAt: true,
      lessonIds: true,
      thread: { select: { userId: true, repId: true, user: { select: { role: true } } } },
    },
  });
  if (!message || message.role !== "ASSISTANT") return null;

  /**
   * Усі репліки розмови до цієї включно — один запит замість трьох.
   * Розмови короткі (стеля ходу — 4 раунди), тож брати хвіст дешевше,
   * ніж тричі ходити в базу по сусідів.
   */
  const before = await prisma.assistantMessage.findMany({
    where: { threadId: message.threadId, createdAt: { lte: message.createdAt } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      toolName: true,
      durationMs: true,
      error: true,
      promptTokens: true,
    },
  });

  const selfIndex = before.findIndex((m) => m.id === message.id);
  const turn = selfIndex >= 0 ? before.slice(0, selfIndex + 1) : before;

  /** Питання — остання репліка користувача перед відповіддю. */
  let question = "";
  for (let i = turn.length - 2; i >= 0; i -= 1) {
    if (turn[i].role === "USER") {
      question = turn[i].content;
      break;
    }
  }

  /** Інструменти цього ходу — TOOL-рядки після того питання. */
  const steps: TraceStep[] = [];
  const seen = emptyEntities();
  let rounds = 0;
  for (let i = turn.length - 1; i >= 0; i -= 1) {
    const row = turn[i];
    if (row.role === "USER") break;
    if (row.role === "ASSISTANT" && row.id !== message.id) rounds += 1;
    if (row.role !== "TOOL") continue;

    steps.unshift({ name: row.toolName ?? "?", ms: row.durationMs, ok: !row.error });
    try {
      collectEntities(JSON.parse(row.content), seen);
    } catch {
      // Результат інструмента не JSON — тоді й чисел із нього не буде.
    }
  }

  /**
   * viaModel визначається нулем у promptTokens — так само, як це робить
   * GET розмови. Кодова відповідь не витратила жодного токена.
   */
  const viaModel = message.promptTokens > 0;
  const kind = message.thread.user.role
    ? kindForThread(message.thread.user.role, message.thread.repId, message.thread.userId)
    : null;

  /**
   * Намір потрібен лише для кодових відповідей: без нього «правити роутер»
   * означає шукати його наосліп серед сорока намірів. Роутер детермінований,
   * тож намір відновлюється заднім числом без жодного поля в базі.
   */
  let intent: string | null = null;
  if (!viaModel && question) {
    const guess = detectIntent(question, { hasHistory: turn.length > 2, kind: kind ?? undefined });
    intent = guess?.kind ?? null;
  }

  const numbers = question
    ? verifyNumbers(withoutBlocks(message.content), question, seen)
    : { checked: 0, unverified: [] as number[] };

  return {
    threadId: message.threadId,
    userId: message.thread.userId,
    kind,
    question,
    answer: message.content,
    toolTrace: steps,
    model: viaModel ? message.toolName : null,
    viaModel,
    intent,
    rounds: Math.max(rounds, viaModel ? 1 : 0),
    promptTokens: message.promptTokens,
    completionTokens: message.completionTokens,
    durationMs: message.durationMs,
    numbersChecked: numbers.checked,
    numbersUnverified: numbers.unverified.length,
    lessonIds: message.lessonIds,
  };
}

/**
 * Записати оцінку керівника.
 *
 * `upsert` по `messageId`, а не `create`: друге натискання переписує
 * присуд, а автосигнал, що прийшов раніше, лише доповнюється — не
 * плодимо два рядки про ту саму відповідь.
 *
 * Знімок оновлюється лише тоді, коли його ще немає (рядок міг завести
 * автосигнал із порожнім знімком, який добере воркер).
 */
export async function saveVerdict(input: {
  messageId: string;
  userId: string;
  verdict: "GOOD" | "BAD";
  expected?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const snap = await buildSnapshot(input.messageId);
  if (!snap) return { ok: false, reason: "not_found" };

  const expected = input.expected?.trim() || null;

  await prisma.assistantFeedback.upsert({
    where: { messageId: input.messageId },
    create: {
      messageId: input.messageId,
      threadId: snap.threadId,
      userId: input.userId,
      kind: snap.kind,
      verdict: input.verdict,
      expected,
      question: snap.question,
      answer: snap.answer,
      toolTrace: snap.toolTrace as unknown as Prisma.InputJsonValue,
      model: snap.model,
      viaModel: snap.viaModel,
      intent: snap.intent,
      rounds: snap.rounds,
      promptTokens: snap.promptTokens,
      completionTokens: snap.completionTokens,
      durationMs: snap.durationMs,
      numbersChecked: snap.numbersChecked,
      numbersUnverified: snap.numbersUnverified,
      lessonIds: snap.lessonIds,
      source: "OWNER",
    },
    update: {
      verdict: input.verdict,
      /** Порожній коментар не стирає вже написаний. */
      ...(expected ? { expected } : {}),
      source: "OWNER",
    },
  });

  return { ok: true };
}

/** Дописати «як правильно» до вже поставленої оцінки. */
export async function saveExpected(messageId: string, expected: string): Promise<boolean> {
  const text = expected.trim();
  if (!text) return false;
  const done = await prisma.assistantFeedback
    .updateMany({ where: { messageId }, data: { expected: text } })
    .catch(() => ({ count: 0 }));
  return done.count > 0;
}

/** Передумав: рядок оцінки прибираємо цілком — слід нікому не потрібен. */
export async function dropVerdict(messageId: string): Promise<void> {
  await prisma.assistantFeedback.deleteMany({ where: { messageId, source: "OWNER" } }).catch(() => {});
}
