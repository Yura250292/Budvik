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

/**
 * Сигнали невдачі, які хід помічає сам.
 *
 * Це головне джерело черги розбору. Розраховувати на кнопки не можна:
 * керівник натисне 👎 кілька разів і забуде, а погані відповіді треба
 * бачити щодня. Усе нижче вже обчислюється в ході — лишається не викинути.
 */
export type TurnSignal =
  | "codeMiss"      // код шукав і не знайшов
  | "toolError"     // інструмент упав
  | "emptyResult"   // інструменти відпрацювали, але нічого не показали
  | "strippedLinks" // модель послалась на те, чого їй не показували
  | "unverified"    // забагато чисел поза даними
  | "fallback"      // відповідала запасна модель
  | "truncated"     // відповідь обірвано за лімітом
  | "clarifyTwice"  // уточнення двічі поспіль
  | "reask"         // те саме питання перепитали інакше
  | "turnFailed";   // хід упав із помилкою

/**
 * Які сигнали достатньо серйозні, щоб самі завели рядок у чергу.
 *
 * Решта (одне зняте посилання, сама по собі запасна модель) лише
 * дописується до рядка, якщо він уже є: інакше черга за тиждень
 * перетворюється на смітник, у якому 👎 керівника не знайти.
 */
const HARD: ReadonlySet<TurnSignal> = new Set([
  "codeMiss",
  "toolError",
  "truncated",
  "turnFailed",
  "clarifyTwice",
  "reask",
]);

/** Стеля авторядків на добу — щоб один зламаний день не залив чергу. */
const DAILY_CAP = 20;

function isHard(signals: TurnSignal[]): boolean {
  if (signals.some((s) => HARD.has(s))) return true;
  // Запасна модель сама по собі не біда, а разом із вигаданими числами — так.
  return signals.includes("fallback") && signals.includes("unverified");
}

async function autoRowsToday(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  return prisma.assistantFeedback.count({
    where: { source: "AUTO", verdict: null, createdAt: { gte: since } },
  });
}

/**
 * Записати сигнали про відповідь. Викликається з ходу через `void`:
 * лічильник не має права зламати відповідь.
 */
export async function recordSignals(messageId: string, signals: TurnSignal[]): Promise<void> {
  try {
    if (signals.length === 0) return;

    const existing = await prisma.assistantFeedback.findUnique({
      where: { messageId },
      select: { id: true, signals: true },
    });

    // Рядок уже є (керівник оцінив або сигнал прилітав раніше) — лише
    // домальовуємо те, чого там ще немає.
    if (existing) {
      const merged = Array.from(new Set([...existing.signals, ...signals]));
      if (merged.length !== existing.signals.length) {
        await prisma.assistantFeedback.update({ where: { id: existing.id }, data: { signals: merged } });
      }
      return;
    }

    if (!isHard(signals)) return;
    if ((await autoRowsToday()) >= DAILY_CAP) return;

    const snap = await buildSnapshot(messageId);
    if (!snap) return;

    await prisma.assistantFeedback.create({
      data: {
        messageId,
        threadId: snap.threadId,
        userId: snap.userId,
        kind: snap.kind,
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
        source: "AUTO",
        signals,
      },
    });
  } catch (e) {
    console.warn(`[петля якості] сигнали не записались: ${(e as Error).message}`);
  }
}

/**
 * Перепит: керівник поставив те саме питання іншими словами.
 *
 * Видно лише з НАСТУПНОГО ходу: якщо відповідь влаштувала, людина не
 * переформульовує. Сигнал ставиться на ПОПЕРЕДНЮ відповідь.
 *
 * Межі, заміряні на справжньому ланцюжку 22.09 (шість питань поспіль про
 * зимові закупівлі): з п'яти переходів поріг упізнає ОДИН — «який саме
 * зимовий товар закупити» → «що ти вважаєш зимовим товаром» (67 %).
 * Решта переходів були не повтором, а уточненням іншими словами, і
 * словесний перетин їх не бачить. Знижувати поріг марно: на 20 % у
 * вибірку починають падати сусідні питання про різне.
 *
 * Тобто це сигнал про БУКВАЛЬНИЙ перепит, а не про незакриту тему.
 * Довгу серію уточнень ловлять інші сигнали ходу (codeMiss, порожній
 * результат, числа поза даними) — і кнопка 👎.
 */

/** Основа слова: закінчення в українській змінюються, корінь — ні. */
function stems(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5);
  return new Set(words.map((w) => w.slice(0, 5)));
}

/** Скільки слів нового питання вже звучали в попередньому. */
function overlap(prev: string, next: string): number {
  const a = stems(prev);
  const b = stems(next);
  if (b.size === 0) return 0;
  let hit = 0;
  for (const s of b) if (a.has(s)) hit += 1;
  return hit / b.size;
}

/** Питання поспіль довше за це вікно — уже нова тема, а не перепит. */
const REASK_WINDOW_MS = 20 * 60 * 1000;
/** Наскільки питання мають перетинатися, щоб вважати це перепитом. */
const REASK_OVERLAP = 0.55;

export async function markReaskIfRepeat(threadId: string, question: string): Promise<void> {
  try {
    const tail = await prisma.assistantMessage.findMany({
      where: { threadId, role: { in: ["USER", "ASSISTANT"] }, content: { not: "" } },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, role: true, content: true, createdAt: true },
    });

    // Чекаємо на хвіст «…питання, відповідь»: саме ту відповідь і судимо.
    const lastAnswer = tail.find((m) => m.role === "ASSISTANT");
    const prevQuestion = tail.find((m) => m.role === "USER");
    if (!lastAnswer || !prevQuestion) return;
    if (Date.now() - lastAnswer.createdAt.getTime() > REASK_WINDOW_MS) return;

    const signals: TurnSignal[] = [];
    if (overlap(prevQuestion.content, question) >= REASK_OVERLAP) signals.push("reask");

    if (signals.length > 0) await recordSignals(lastAnswer.id, signals);
  } catch {
    // Сигнал — не відповідь; його втрата нічого не ламає.
  }
}
