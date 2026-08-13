/**
 * Коментарі про клієнта: що торговий знає, чого немає в цифрах.
 *
 * Доступ ширший, ніж у решти карти: писати може й SALES, бо саме він
 * привозить це знання з маршруту. Читати — теж, інакше коментар нікому
 * не допоможе перед візитом.
 *
 * Редагувати й видаляти може лише автор або керівництво: чужий коментар
 * — це чиясь пам'ять про домовленість, і мовчки переписувати її не можна.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * DRIVER тут нарівні з SALES: водій стоїть біля дверей і бачить те, чого
 * не бачить ніхто («заїзд з двору», «після 15:00 зачинено», «вивіска
 * інша»). Стрічка спільна — торговий і водій пишуть в одну.
 */
const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES", "DRIVER"];

/** Хто може правити й видаляти чужі коментарі. */
const MANAGEMENT_ROLES = ["ADMIN", "MANAGER"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!STAFF_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { counterpartyId } = await params;
  const comments = await prisma.clientComment.findMany({
    where: { counterpartyId },
    select: {
      id: true,
      text: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    comments: comments.map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt.toISOString(),
      author: c.author,
      // Явний перелік, а не «не SALES»: із появою DRIVER заперечення тихо
      // роздало б водієві право правити чужі коментарі.
      canEdit:
        c.author.id === session.user.id || MANAGEMENT_ROLES.includes(session.user.role),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!STAFF_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { counterpartyId } = await params;
  const body = await req.json().catch(() => null);
  const text = String(body?.text ?? "").trim();

  if (!text) {
    return NextResponse.json({ error: "Порожній коментар" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "Коментар задовгий (макс. 2000 символів)" }, { status: 400 });
  }

  const client = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  }

  const created = await prisma.clientComment.create({
    data: { counterpartyId, authorId: session.user.id, text },
    select: {
      id: true,
      text: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(
    { ...created, createdAt: created.createdAt.toISOString(), canEdit: true },
    { status: 201 }
  );
}
