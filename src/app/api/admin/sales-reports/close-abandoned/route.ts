import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Закриття покинутих поїздок.
 *
 * Бот уже робить ліниву перевірку при старті нової поїздки, і для
 * торгового, який виходить щодня, цього достатньо. Цей роут потрібен
 * для випадку, коли людина не вийшла наступного дня взагалі — інакше
 * поїздка висіла б OPEN тижнями і псувала статистику «зараз у дорозі».
 *
 * Викликається адміном вручну або зовнішнім планувальником з
 * заголовком x-cron-secret.
 */
const ABANDON_AFTER_HOURS = 16;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  const viaCron = Boolean(cronSecret && headerSecret && headerSecret === cronSecret);

  if (!viaCron) {
    const session = await getServerSession(authOptions);
    if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const cutoff = new Date(Date.now() - ABANDON_AFTER_HOURS * 60 * 60 * 1000);

  const stale = await prisma.salesTrip.findMany({
    where: { status: "OPEN", startedAt: { lt: cutoff } },
    select: { id: true, userId: true, startedAt: true },
  });

  if (!stale.length) {
    return NextResponse.json({ ok: true, closed: 0 });
  }

  await prisma.salesTrip.updateMany({
    where: { id: { in: stale.map((t) => t.id) } },
    data: { status: "ABANDONED", odometerSuspicious: true },
  });

  return NextResponse.json({ ok: true, closed: stale.length, trips: stale });
}
