/**
 * Розмови з помічником: список своїх і створення нової.
 *
 * Розмова створюється при ПЕРШОМУ питанні, а не при відкритті екрана —
 * інакше в списку накопичувалися б порожні рядки щоразу, коли хтось
 * заглянув і передумав.
 */

import { NextResponse } from "next/server";
import { requireRoles, FIELD_ROLES, OFFICE_ROLES } from "@/lib/app/identity";
import { prisma } from "@/lib/prisma";
import { createThread, listThreads } from "@/lib/assistant/threads";
import { resolveRepForThread } from "@/lib/assistant/scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  const isOffice = (OFFICE_ROLES as readonly string[]).includes(guard.me.role);

  // Список торгових їде разом зі списком розмов, а не окремим роутом:
  // керівнику він потрібен рівно тут і рівно один раз, а зайвий похід на
  // сервер із телефона коштує дорожче за кілька полів у відповіді.
  const reps = isOffice
    ? await prisma.user.findMany({
        where: { role: "SALES" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  return NextResponse.json(
    { threads: await listThreads(guard.me.userId), reps, isOffice },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  let body: { repId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Порожнє тіло — звичайний випадок для торгового.
  }

  const { repId, error } = await resolveRepForThread(guard.me, body.repId);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const thread = await createThread(guard.me.userId, repId);
  return NextResponse.json({ id: thread.id, repId: thread.repId }, { status: 201 });
}
