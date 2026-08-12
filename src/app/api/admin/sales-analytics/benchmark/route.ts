/**
 * Бенчмарк команди: усі торгові з перцентилями по кожній метриці.
 *
 * Доступ лише керівникам. Торговому цей зріз не показуємо свідомо: це не
 * питання секретності чисел, а того, що рейтинг колег — інструмент
 * керівника, а не привід для змагання в чаті.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { teamBenchmark } from "@/lib/analytics/benchmark";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);

  // ?reps=id1,id2 — порівнювати лише обраних. Невідомі id просто не
  // знайдуть збігів, тож окремої валідації не потрібно.
  const repsParam = searchParams.get("reps");
  const onlyReps = repsParam
    ? repsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50)
    : undefined;

  return NextResponse.json(await teamBenchmark(period, onlyReps));
}
