/**
 * Особисті нотатки віджета дашборду.
 *
 * Строго свої: userId завжди береться з сесії, ніколи з тіла запиту —
 * інакше будь-хто міг би читати й правити чужі нотатки, підставивши id.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "MANAGER", "SALES"];
const MAX_LEN = 500;
/** Стільки нотаток тримаємо на людину: віджет — не таск-трекер. */
const MAX_NOTES = 50;

async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Не авторизовано" }, { status: 401 }) };
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: NextResponse.json({ error: "Немає доступу" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

/** Невиконані згори, всередині групи — свіжі першими. */
const ORDER = [{ done: "asc" as const }, { createdAt: "desc" as const }];

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const notes = await prisma.userDashboardNote.findMany({
    where: { userId: auth.userId },
    orderBy: ORDER,
    take: MAX_NOTES,
  });

  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const text = String((body as { text?: unknown })?.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Порожня нотатка" }, { status: 400 });

  const count = await prisma.userDashboardNote.count({ where: { userId: auth.userId } });
  if (count >= MAX_NOTES) {
    return NextResponse.json({ error: `Максимум ${MAX_NOTES} нотаток` }, { status: 400 });
  }

  const note = await prisma.userDashboardNote.create({
    data: { userId: auth.userId!, text: text.slice(0, MAX_LEN) },
  });

  return NextResponse.json({ note });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const c = body as { id?: unknown; text?: unknown; done?: unknown };
  const id = typeof c.id === "string" ? c.id : null;
  if (!id) return NextResponse.json({ error: "Не вказано id" }, { status: 400 });

  const data: { text?: string; done?: boolean } = {};
  if (typeof c.text === "string") {
    const text = c.text.trim();
    if (!text) return NextResponse.json({ error: "Порожня нотатка" }, { status: 400 });
    data.text = text.slice(0, MAX_LEN);
  }
  if (typeof c.done === "boolean") data.done = c.done;
  if (!Object.keys(data).length) return NextResponse.json({ error: "Нічого змінювати" }, { status: 400 });

  // updateMany з userId у where: чужу нотатку запит просто не знайде.
  const res = await prisma.userDashboardNote.updateMany({
    where: { id, userId: auth.userId },
    data,
  });
  if (res.count === 0) return NextResponse.json({ error: "Нотатку не знайдено" }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не вказано id" }, { status: 400 });

  const res = await prisma.userDashboardNote.deleteMany({ where: { id, userId: auth.userId } });
  if (res.count === 0) return NextResponse.json({ error: "Нотатку не знайдено" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
