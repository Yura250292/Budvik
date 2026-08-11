/**
 * Один збережений звіт: відкрити або видалити.
 *
 * GET віддає повний вміст разом із facts — на відміну від списку, де їх
 * навмисно немає: зведення важке, а в переліку показується лише лічильник
 * інсайтів.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Insight } from "@/lib/ai/insights";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

function guard(role: string | undefined) {
  if (!role) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = guard(session?.user?.role);
  if (denied) return denied;

  const { id } = await params;
  const row = await prisma.savedAiReport.findUnique({
    where: { id },
    include: {
      rep: { select: { id: true, name: true } },
      savedBy: { select: { name: true } },
    },
  });
  if (!row) {
    return NextResponse.json({ error: "Звіт не знайдено" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    kind: row.kind,
    repId: row.repId,
    repName: row.rep?.name ?? null,
    fromDay: row.fromDay,
    toDay: row.toDay,
    title: row.title,
    note: row.note,
    insights: (row.insights as unknown as Insight[]) ?? [],
    facts: row.facts,
    model: row.model,
    tokens: row.tokens,
    savedBy: row.savedBy?.name ?? "—",
    createdAt: row.createdAt.toISOString(),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = guard(session?.user?.role);
  if (denied) return denied;

  const { id } = await params;
  // deleteMany, а не delete: видалення вже видаленого звіту (подвійний клік,
  // відкрита в двох вкладках сторінка) не має падати 500-ю.
  const { count } = await prisma.savedAiReport.deleteMany({ where: { id } });

  return NextResponse.json({ deleted: count });
}
