/**
 * Призначення схеми торговому.
 *
 * Стара схема не переписується, а закривається датою: перерахунок минулого
 * місяця має дати ті самі гроші, навіть якщо відтоді умови змінилися. Через
 * це тут завжди «закрити попереднє + створити нове», ніколи не update.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { MOTIVATION_EDIT_ROLES as EDIT_ROLES } from "@/lib/motivation/labels";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const repId = typeof body?.repId === "string" ? body.repId : "";
  const schemeId = typeof body?.schemeId === "string" && body.schemeId ? body.schemeId : null;

  if (!repId) {
    return NextResponse.json({ error: "Потрібен торговий" }, { status: 400 });
  }

  const rep = await prisma.user.findFirst({ where: { id: repId, role: "SALES" }, select: { id: true } });
  if (!rep) {
    return NextResponse.json({ error: "Торгового не знайдено" }, { status: 404 });
  }

  if (schemeId) {
    const scheme = await prisma.motivationScheme.findUnique({ where: { id: schemeId }, select: { id: true } });
    if (!scheme) {
      return NextResponse.json({ error: "Схему не знайдено" }, { status: 404 });
    }
  }

  const validFromDay = /^\d{4}-\d{2}-\d{2}$/.test(body?.validFrom ?? "")
    ? body.validFrom
    : kyivDate(new Date());
  const validFrom = kyivDayStart(validFromDay);

  await prisma.$transaction(async (tx) => {
    // Попереднє призначення діє до кінця попередньої доби — інакше в день
    // переходу спрацювали б обидва.
    await tx.motivationAssignment.updateMany({
      where: { repId, validTo: null },
      data: { validTo: new Date(validFrom.getTime() - 1) },
    });

    if (schemeId) {
      await tx.motivationAssignment.create({ data: { repId, schemeId, validFrom } });
    }
  });

  return NextResponse.json({ ok: true });
}
