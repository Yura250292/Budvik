/** Створення схеми мотивації. Правила додаються окремо, через PUT схеми. */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MOTIVATION_EDIT_ROLES as EDIT_ROLES } from "@/lib/motivation/labels";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Потрібна назва схеми" }, { status: 400 });
  }

  const scheme = await prisma.motivationScheme.create({
    data: {
      name,
      description: typeof body?.description === "string" ? body.description.trim() || null : null,
    },
    select: { id: true, name: true },
  });

  return NextResponse.json({ scheme });
}
