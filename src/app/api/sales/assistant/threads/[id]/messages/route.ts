/**
 * Питання до помічника — і потік відповіді.
 *
 * Перший SSE в цьому репозиторії. Звичайний JSON тут не годиться: хід із
 * інструментами триває 20–40 секунд, і без потоку користувач стільки
 * дивиться в порожній екран, не знаючи, чи взагалі щось відбувається.
 *
 * Порядок перевірок навмисний: усе дешеве спершу, модель — в останню
 * чергу. Найгірше, що може статися, — списати токени й упертися в
 * зайнятий діалог.
 *
 * Заголовки. `no-transform` і `X-Accel-Buffering: no` просять проксі не
 * накопичувати потік: зі стисненням увімкненим (next.config: compress)
 * відповідь інакше приїжджає одним шматком у кінці, і сенс потоку
 * зникає.
 */

import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/shop/rate-limit";
import { DAILY_TURN_CAP, USER_TEXT_MAX } from "@/lib/assistant/config";
import { runTurn } from "@/lib/assistant/loop";
import { acquireBusy, getThreadForUser, releaseBusy } from "@/lib/assistant/threads";
import { kindForRole, scopeOf } from "@/lib/assistant/scope";
import { encodeEvent, keepAlive } from "@/lib/assistant/sse";
import { DeepSeekError } from "@/lib/assistant/deepseek";
import { kyivDate } from "@/lib/date/kyiv";
import type { TurnEvent } from "@/lib/assistant/types";

export const dynamic = "force-dynamic";
/** Хід обмежений 100 секундами (TURN_DEADLINE_MS) — тут запас на збереження. */
export const maxDuration = 120;

const OFFICE = new Set(["ADMIN", "MANAGER"]);

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  const { id: threadId } = await params;
  const thread = await getThreadForUser(threadId, guard.me.userId);
  if (!thread) return json({ error: "Розмову не знайдено" }, 404);

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return json(
      { error: "Помічник не налаштований: немає ключа до моделі. Повідомте керівника." },
      503
    );
  }

  let body: { text?: unknown; counterpartyId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Некоректний запит" }, 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "Порожнє питання" }, 400);
  if (text.length > USER_TEXT_MAX) {
    return json({ error: `Питання задовге (максимум ${USER_TEXT_MAX} символів)` }, 400);
  }

  const limit = await rateLimit(`assistant:turns:${guard.me.userId}`, DAILY_TURN_CAP, 86_400);
  if (!limit.allowed) {
    return json(
      { error: "Ліміт запитів на сьогодні вичерпано. Помічник знову доступний завтра." },
      429
    );
  }

  // Клієнт із картки: підказка контексту, а не фільтр даних.
  let clientHint: { id: string; name: string } | null = null;
  if (typeof body.counterpartyId === "string" && body.counterpartyId) {
    const cp = await prisma.counterparty.findUnique({
      where: { id: body.counterpartyId },
      select: { id: true, name: true },
    });
    if (cp) clientHint = cp;
  }

  const existing = await prisma.assistantMessage.count({
    where: { threadId, role: "USER" },
  });

  if (!(await acquireBusy(threadId))) {
    return json({ error: "Попередня відповідь ще формується" }, 409);
  }

  const scope = await scopeOf(thread.repId);
  const ctx = {
    userId: guard.me.userId,
    role: guard.me.role,
    kind: kindForRole(guard.me.role),
    scope,
    today: kyivDate(new Date()),
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: TurnEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          closed = true;
        }
      };

      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(keepAlive());
        } catch {
          closed = true;
        }
      }, 15_000);

      runTurn({
        threadId,
        ctx,
        selfScoped: !OFFICE.has(guard.me.role) || thread.repId === guard.me.userId,
        userText: text,
        clientHint,
        isFirstMessage: existing === 0,
        apiKey,
        signal: req.signal,
        emit: send,
      })
        .then((out) => {
          send({ event: "done", data: out });
        })
        .catch((e: unknown) => {
          const message =
            e instanceof DeepSeekError
              ? e.message
              : `Не вдалося отримати відповідь: ${(e as Error).message}`;
          console.error("[assistant] хід не вдався", e);
          send({ event: "error", data: { message } });
        })
        .finally(async () => {
          clearInterval(ping);
          await releaseBusy(threadId);
          closed = true;
          try {
            controller.close();
          } catch {
            // Клієнт міг піти раніше — це не помилка.
          }
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
