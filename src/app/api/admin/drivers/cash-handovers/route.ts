/**
 * Інкасація очима офісу: хто скільки заявив і що ще не прийнято.
 *
 * Разом зі здачею віддаємо, скільки водій зібрав за відмітками того дня
 * (expectedAmount, зафіксований у мить здачі) — касир бачить розбіжність
 * одразу, без переходу в звіт по візитах.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = session.user.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  // Водій сюди теж ходить — але бачить лише себе (той самий підхід, що в
  // /api/admin/drivers/payroll: один роут, скоуп із сесії).
  if (!isFullAccess && role !== "DRIVER") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);
  const driverFilter = searchParams.get("driverId");
  const restrictToDriver = isFullAccess ? driverFilter : session.user.id;
  const onlyPending = searchParams.get("pending") === "1";

  const rows = await prisma.cashHandover.findMany({
    where: {
      day: { gte: kyivDayStart(period.fromDay), lte: kyivDayStart(period.toDay) },
      ...(restrictToDriver ? { driverId: restrictToDriver } : {}),
      ...(onlyPending ? { confirmedAt: null } : {}),
    },
    orderBy: [{ day: "desc" }, { handedAt: "desc" }],
    select: {
      id: true,
      day: true,
      amount: true,
      expectedAmount: true,
      comment: true,
      handedAt: true,
      confirmedAt: true,
      confirmedAmount: true,
      driver: { select: { id: true, name: true } },
      confirmedBy: { select: { id: true, name: true } },
    },
  });

  const handovers = rows.map((row) => ({
    id: row.id,
    // kyivDate, а не toISOString: київська доба починається о 21:00 UTC
    // попереднього дня, і зріз ISO показував би вчорашню дату.
    day: kyivDate(row.day),
    driverId: row.driver.id,
    driverName: row.driver.name,
    amount: row.amount,
    expectedAmount: row.expectedAmount,
    /// Заявлено мінус зібрано: додатне — здав більше, ніж відмітив.
    delta:
      typeof row.expectedAmount === "number"
        ? Math.round((row.amount - row.expectedAmount) * 100) / 100
        : null,
    comment: row.comment,
    handedAt: row.handedAt,
    confirmedAt: row.confirmedAt,
    confirmedAmount: row.confirmedAmount,
    confirmedByName: row.confirmedBy?.name ?? null,
  }));

  const totals = handovers.reduce(
    (acc, h) => {
      acc.declared += h.amount;
      if (h.confirmedAt) acc.confirmed += h.confirmedAmount ?? h.amount;
      else acc.pending += h.amount;
      return acc;
    },
    { declared: 0, confirmed: 0, pending: 0 }
  );

  return NextResponse.json({
    canEdit: isFullAccess,
    period: { from: period.fromDay, to: period.toDay },
    handovers,
    totals: {
      declared: Math.round(totals.declared * 100) / 100,
      confirmed: Math.round(totals.confirmed * 100) / 100,
      pending: Math.round(totals.pending * 100) / 100,
    },
  });
}
