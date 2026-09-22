/**
 * Позначка «менеджер вніс це замовлення в 1С».
 *
 * Ставить людина: у 1С ми не пишемо нічого (docs/1c-read-only.md) і дізнатися
 * самі не можемо. Сенс позначки один — щоб замовлення не внесли двічі, коли
 * над ним працюють по черзі кілька людей.
 *
 * Повторний виклик знімає позначку: натиснути помилково легко, а виправити
 * інакше було б ніяк.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    select: { enteredIn1CAt: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.order.update({
    where: { id },
    data: { enteredIn1CAt: order.enteredIn1CAt ? null : new Date() },
    select: { enteredIn1CAt: true },
  });

  return NextResponse.json({ enteredIn1CAt: updated.enteredIn1CAt });
}
