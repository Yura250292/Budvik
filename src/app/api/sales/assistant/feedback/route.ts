/**
 * Оцінка відповіді помічника: 👍/👎 і «а як мало бути».
 *
 * Знімок ходу збирає сервер сам (feedback.ts) — від браузера приймаємо
 * лише id репліки й присуд. Інакше будь-хто зі штату міг би підкласти в
 * чергу розбору вигаданий текст питання й відповіді.
 *
 * Оцінити можна лише СВОЮ розмову: чужі відповіді керівника торговий не
 * бачить і не судить.
 */

import { NextResponse } from "next/server";
import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { prisma } from "@/lib/prisma";
import { dropVerdict, saveExpected, saveVerdict } from "@/lib/assistant/feedback";

export const dynamic = "force-dynamic";

/** Чи ця репліка з розмови цього користувача. */
async function ownsMessage(messageId: string, userId: string): Promise<boolean> {
  const row = await prisma.assistantMessage.findUnique({
    where: { id: messageId },
    select: { thread: { select: { userId: true } } },
  });
  return row?.thread.userId === userId;
}

export async function POST(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;

  let body: { messageId?: unknown; verdict?: unknown; expected?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Очікується JSON" }, { status: 400 });
  }

  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const verdict = body.verdict === "GOOD" || body.verdict === "BAD" ? body.verdict : null;
  if (!messageId || !verdict) {
    return NextResponse.json({ error: "Потрібні messageId і verdict" }, { status: 400 });
  }

  if (!(await ownsMessage(messageId, guard.me.userId))) {
    return NextResponse.json({ error: "Це не ваша розмова" }, { status: 403 });
  }

  const expected = typeof body.expected === "string" ? body.expected.slice(0, 2000) : null;
  const saved = await saveVerdict({ messageId, userId: guard.me.userId, verdict, expected });
  if (!saved.ok) return NextResponse.json({ error: "Відповідь не знайдено" }, { status: 404 });

  return NextResponse.json({ ok: true });
}

/** Дописати «як правильно» пізніше, коли оцінка вже стоїть. */
export async function PATCH(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;

  let body: { messageId?: unknown; expected?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Очікується JSON" }, { status: 400 });
  }

  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const expected = typeof body.expected === "string" ? body.expected.slice(0, 2000) : "";
  if (!messageId || !expected.trim()) {
    return NextResponse.json({ error: "Потрібні messageId і expected" }, { status: 400 });
  }

  if (!(await ownsMessage(messageId, guard.me.userId))) {
    return NextResponse.json({ error: "Це не ваша розмова" }, { status: 403 });
  }

  const done = await saveExpected(messageId, expected);
  if (!done) return NextResponse.json({ error: "Оцінки ще немає" }, { status: 404 });

  return NextResponse.json({ ok: true });
}

/** Передумав — знімаємо оцінку. */
export async function DELETE(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;

  const messageId = new URL(req.url).searchParams.get("messageId") ?? "";
  if (!messageId) return NextResponse.json({ error: "Потрібен messageId" }, { status: 400 });

  if (!(await ownsMessage(messageId, guard.me.userId))) {
    return NextResponse.json({ error: "Це не ваша розмова" }, { status: 403 });
  }

  await dropVerdict(messageId);
  return NextResponse.json({ ok: true });
}
