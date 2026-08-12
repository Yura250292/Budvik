/**
 * Правка й видалення окремого коментаря про клієнта.
 *
 * Автор править свій; керівництво — будь-який. Торговий чужий коментар не
 * чіпає: це чиясь пам'ять про домовленість із клієнтом.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

async function loadEditable(id: string, userId: string, role: string) {
  const comment = await prisma.clientComment.findUnique({
    where: { id },
    select: { id: true, authorId: true },
  });
  if (!comment) return { error: "Коментар не знайдено", status: 404 as const };
  if (comment.authorId !== userId && !FULL_ACCESS_ROLES.includes(role)) {
    return { error: "Можна змінювати лише власний коментар", status: 403 as const };
  }
  return { comment };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const { id } = await params;
  const guard = await loadEditable(id, session.user.id, session.user.role);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = await req.json().catch(() => null);
  const text = String(body?.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Порожній коментар" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "Коментар задовгий (макс. 2000 символів)" }, { status: 400 });
  }

  const updated = await prisma.clientComment.update({
    where: { id },
    data: { text },
    select: {
      id: true,
      text: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    canEdit: true,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const { id } = await params;
  const guard = await loadEditable(id, session.user.id, session.user.role);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  await prisma.clientComment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
