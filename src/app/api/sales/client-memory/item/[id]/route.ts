/**
 * Правка й видалення одного запису пам'яті.
 *
 * Окремим сегментом item/, бо сусідній [counterpartyId] уже займає
 * динамічне місце на цьому рівні — та сама причина, через яку коментарі
 * мають /client-comments/comment/[id].
 *
 * Видалення м'яке: запис зникає зі списку, але лишається в базі. Питання
 * «хто це стер» виникає рівно тоді, коли відповіді вже немає.
 */

import { NextResponse } from "next/server";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { prisma } from "@/lib/prisma";
import { archiveMemory, MemoryError, updateMemory } from "@/lib/assistant/memory";

export const dynamic = "force-dynamic";

const MANAGEMENT_ROLES = ["ADMIN", "MANAGER"];

/** Автор або керівництво. null — запису немає. */
async function canEdit(id: string, userId: string, role: string): Promise<boolean | null> {
  const row = await prisma.clientMemory.findUnique({
    where: { id },
    select: { authorId: true, archivedAt: true },
  });
  if (!row || row.archivedAt) return null;
  return row.authorId === userId || MANAGEMENT_ROLES.includes(role);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const allowed = await canEdit(id, guard.me.userId, guard.me.role);
  if (allowed === null) return NextResponse.json({ error: "Запис не знайдено" }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: "Це чужий запис" }, { status: 403 });

  let body: { kind?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний запит" }, { status: 400 });
  }

  try {
    const fact = await updateMemory(id, body);
    return NextResponse.json({ ...fact, canEdit: true });
  } catch (e) {
    if (e instanceof MemoryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const allowed = await canEdit(id, guard.me.userId, guard.me.role);
  if (allowed === null) return NextResponse.json({ error: "Запис не знайдено" }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: "Це чужий запис" }, { status: 403 });

  await archiveMemory(id);
  return NextResponse.json({ ok: true });
}
