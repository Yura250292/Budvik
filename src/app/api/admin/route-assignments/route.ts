/**
 * Призначення маршрутів торговим: постійний розклад по днях тижня
 * і разові заміни на конкретну дату.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const canEdit = EDIT_ROLES.includes(session.user.role);
  const { searchParams } = new URL(req.url);
  const repParam = searchParams.get("repId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const repFilter = canEdit ? (repParam && repParam !== "ALL" ? repParam : null) : session.user.id;

  const assignments = await prisma.routeAssignment.findMany({
    where: {
      ...(repFilter ? { repId: repFilter } : {}),
      // Постійні (weekday) віддаємо завжди, разові — лише в межах періоду.
      ...(from && to
        ? { OR: [{ weekday: { not: null } }, { date: { gte: kyivDayStart(from), lte: kyivDayStart(to) } }] }
        : {}),
    },
    include: { template: { select: { id: true, name: true, color: true, totalDistanceKm: true } } },
  });

  // На проді колонка вже є, але міграції тут накочують окремим кроком, не на
  // білді, — тож база без User.color лишається можливою (preview, свіжа копія).
  // Тоді вкладка має працювати на кольорах із палітри, а не падати з 500.
  // P2022 — «колонки не існує».
  const reps = await prisma.user
    .findMany({
      where: { role: "SALES", ...(repFilter ? { id: repFilter } : {}) },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    })
    .catch(async (e: unknown) => {
      if ((e as { code?: string })?.code !== "P2022") throw e;
      const rows = await prisma.user.findMany({
        where: { role: "SALES", ...(repFilter ? { id: repFilter } : {}) },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return rows.map((r) => ({ ...r, color: null as string | null }));
    });

  return NextResponse.json({
    canEdit,
    reps,
    assignments: assignments.map((a) => ({
      id: a.id,
      repId: a.repId,
      templateId: a.templateId,
      templateName: a.template.name,
      templateColor: a.template.color,
      totalDistanceKm: a.template.totalDistanceKm,
      date: a.date ? kyivDate(a.date) : null,
      weekday: a.weekday,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { repId?: string; templateId?: string; date?: string | null; weekday?: number | null }
    | null;

  if (!body?.repId || !body?.templateId) {
    return NextResponse.json({ error: "Потрібні repId і templateId" }, { status: 400 });
  }

  const hasDate = typeof body.date === "string" && body.date.length > 0;
  const hasWeekday = typeof body.weekday === "number";

  // XOR: Prisma такого констрейнта не виражає, тож перевіряємо тут.
  if (hasDate === hasWeekday) {
    return NextResponse.json(
      { error: "Вкажіть або дату (разове), або день тижня (постійне) — не обидва" },
      { status: 400 }
    );
  }
  if (hasWeekday && (body.weekday! < 1 || body.weekday! > 7)) {
    return NextResponse.json({ error: "День тижня має бути 1..7" }, { status: 400 });
  }

  const date = hasDate ? kyivDayStart(body.date!) : null;
  const weekday = hasWeekday ? body.weekday! : null;

  // Заміна наявного призначення на цю ж клітинку розкладу — звичайна дія
  // адміна, тож upsert по відповідному унікальному ключу, а не помилка 409.
  const assignment = hasDate
    ? await prisma.routeAssignment.upsert({
        where: { repId_date: { repId: body.repId, date: date! } },
        create: { repId: body.repId, templateId: body.templateId, date },
        update: { templateId: body.templateId },
      })
    : await prisma.routeAssignment.upsert({
        where: { repId_weekday: { repId: body.repId, weekday: weekday! } },
        create: { repId: body.repId, templateId: body.templateId, weekday },
        update: { templateId: body.templateId },
      });

  return NextResponse.json({ ok: true, assignment });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Потрібен id" }, { status: 400 });
  }

  await prisma.routeAssignment.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
