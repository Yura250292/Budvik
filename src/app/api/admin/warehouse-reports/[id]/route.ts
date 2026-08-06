import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/r2";

/** Один звіт із позиціями та фото. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const report = await prisma.warehouseReport.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, telegramUsername: true } },
      shift: { select: { id: true, openedAt: true, closedAt: true, openAddress: true } },
      matchedCounterparty: { select: { id: true, name: true, code: true } },
      items: { orderBy: { lineTotal: "desc" } },
    },
  });

  if (!report) {
    return NextResponse.json({ error: "Звіт не знайдено" }, { status: 404 });
  }

  return NextResponse.json(report);
}

/** Поставити FAILED-звіт у чергу на повторне розпізнавання. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  if (body.action !== "retry") {
    return NextResponse.json({ error: "Невідома дія" }, { status: 400 });
  }

  const report = await prisma.warehouseReport.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Звіт не знайдено" }, { status: 404 });
  }

  // Прибираємо старі позиції, щоб повторне розпізнавання не дублювало їх
  await prisma.$transaction([
    prisma.warehouseReportItem.deleteMany({ where: { reportId: id } }),
    prisma.warehouseReport.update({
      where: { id },
      data: {
        status: "PENDING",
        attempts: 0,
        errorMessage: null,
        itemsCount: 0,
        processedAt: null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

/** Видалити звіт разом із фото в R2 (лише ADMIN). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const report = await prisma.warehouseReport.findUnique({
    where: { id },
    select: { id: true, photoKey: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Звіт не знайдено" }, { status: 404 });
  }

  // Спершу БД: якщо видалення файлу впаде, звіт усе одно зникне з адмінки
  await prisma.warehouseReport.delete({ where: { id } });

  if (report.photoKey) {
    try {
      await deleteFile(report.photoKey);
    } catch (e) {
      console.error("Не вдалося видалити фото з R2:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
