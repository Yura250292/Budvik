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

/**
 * Ручне коригування накладної (лише ADMIN).
 *
 * Позиції замінюємо цілком, а не патчимо по одній: OCR і так їх переписує
 * при кожному retry, тож окремі id позицій нічого не означають, а diff
 * ускладнив би клієнт без користі. Статус ставимо DONE — після ручної
 * правки накладна вважається перевіреною людиною.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  const report = await prisma.warehouseReport.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Звіт не знайдено" }, { status: 404 });
  }

  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };
  const num = (v: unknown): number => {
    // Приймаємо і "12,5" — адмін друкує кому, як у накладній
    const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  if (body.docType != null && !["purchase", "sales"].includes(body.docType)) {
    return NextResponse.json({ error: "Невідомий тип документа" }, { status: 400 });
  }

  let docDate: Date | null = null;
  if (str(body.docDate)) {
    const d = new Date(body.docDate);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Некоректна дата документа" }, { status: 400 });
    }
    docDate = d;
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .filter((i: Record<string, unknown>) => str(i?.name))
    .map((i: Record<string, unknown>) => {
      const quantity = num(i.quantity);
      const price = num(i.price);
      return {
        name: str(i.name) as string,
        sku: str(i.sku),
        unit: str(i.unit),
        quantity,
        price,
        // lineTotal рахуємо на сервері: інакше клієнт міг би прислати суму,
        // яка не збігається з кількістю × ціною, і зведення поповзли б
        lineTotal: Math.round(quantity * price * 100) / 100,
      };
    });

  // totalAmount: якщо адмін лишив поле порожнім — беремо суму позицій,
  // щоб KPI не показували нуль по щойно відредагованій накладній
  const itemsSum = items.reduce((s: number, i: { lineTotal: number }) => s + i.lineTotal, 0);
  const totalAmount =
    body.totalAmount === "" || body.totalAmount == null
      ? Math.round(itemsSum * 100) / 100
      : num(body.totalAmount);

  await prisma.$transaction([
    prisma.warehouseReportItem.deleteMany({ where: { reportId: id } }),
    ...(items.length
      ? [
          prisma.warehouseReportItem.createMany({
            data: items.map((i: Record<string, unknown>) => ({ ...i, reportId: id })),
          }),
        ]
      : []),
    prisma.warehouseReport.update({
      where: { id },
      data: {
        docType: str(body.docType),
        docNumber: str(body.docNumber),
        docDate,
        counterpartyName: str(body.counterpartyName),
        counterpartyCode: str(body.counterpartyCode),
        notes: str(body.notes),
        totalAmount,
        itemsCount: items.length,
        status: "DONE",
        errorMessage: null,
        processedAt: new Date(),
      },
    }),
  ]);

  const updated = await prisma.warehouseReport.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, telegramUsername: true } },
      shift: { select: { id: true, openedAt: true, closedAt: true, openAddress: true } },
      matchedCounterparty: { select: { id: true, name: true, code: true } },
      items: { orderBy: { lineTotal: "desc" } },
    },
  });

  return NextResponse.json(updated);
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
