/**
 * Стан трансляції у відкритих поїздках — діагностика «чому немає треку».
 * Лише читання.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const trips = await prisma.salesTrip.findMany({
  where: { status: "OPEN" },
  select: {
    id: true,
    startedAt: true,
    liveMessageId: true,
    liveChatId: true,
    liveStartedAt: true,
    liveExpiresAt: true,
    liveLastPointAt: true,
    liveStoppedAt: true,
    user: { select: { name: true } },
    _count: { select: { trackPoints: true } },
  },
  orderBy: { startedAt: "desc" },
});

for (const t of trips) {
  console.log(`\n=== ${t.user.name} ===`);
  console.log(`  Старт поїздки:    ${t.startedAt.toISOString()}`);
  console.log(`  liveMessageId:    ${t.liveMessageId ?? "— (трансляцію жодного разу не вмикали)"}`);
  console.log(`  liveStartedAt:    ${t.liveStartedAt?.toISOString() ?? "—"}`);
  console.log(`  liveExpiresAt:    ${t.liveExpiresAt?.toISOString() ?? "—"}`);
  console.log(`  liveLastPointAt:  ${t.liveLastPointAt?.toISOString() ?? "—"}`);
  console.log(`  liveStoppedAt:    ${t.liveStoppedAt?.toISOString() ?? "—"}`);
  console.log(`  Точок треку:      ${t._count.trackPoints}`);

  if (t.liveMessageId && t.liveStartedAt && t.liveExpiresAt) {
    const sec = Math.round((t.liveExpiresAt - t.liveStartedAt) / 1000);
    console.log(`  → обрана тривалість: ${sec} с (${Math.round(sec / 60)} хв)`);
  }
}

if (!trips.length) console.log("Відкритих поїздок немає.");

await prisma.$disconnect();
