import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFile } from "@/lib/r2";

/**
 * Приватна віддача фото накладної.
 *
 * Фото накладних чутливіші за фото товарів, тому вони не лежать у публічному
 * доступі R2 — читаємо об'єкт через S3 API і віддаємо лише авторизованому
 * ADMIN/MANAGER.
 */
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
    select: { photoKey: true, photoMimeType: true },
  });

  if (!report?.photoKey) {
    return NextResponse.json({ error: "Фото не знайдено" }, { status: 404 });
  }

  const file = await getFile(report.photoKey);
  if (!file) {
    return NextResponse.json({ error: "Фото не знайдено у сховищі" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "Content-Type": report.photoMimeType || file.contentType,
      // Приватний кеш: фото не змінюється, але й не має осідати в CDN
      "Cache-Control": "private, max-age=3600",
    },
  });
}
