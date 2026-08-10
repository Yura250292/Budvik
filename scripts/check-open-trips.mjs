/**
 * Чи є зараз відкриті поїздки — щоб не чіпати бота посеред робочого дня.
 * Лише читання.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const open = await prisma.salesTrip.findMany({
  where: { status: "OPEN" },
  select: {
    id: true,
    startedAt: true,
    liveMessageId: true,
    liveStoppedAt: true,
    user: { select: { name: true } },
  },
  orderBy: { startedAt: "desc" },
});

console.log(`Відкритих поїздок: ${open.length}`);
for (const t of open) {
  const live = t.liveMessageId && !t.liveStoppedAt ? "трансляція активна" : "без трансляції";
  console.log(`  ${t.user.name} — з ${t.startedAt.toISOString()} (${live})`);
}

const points = await prisma.salesTrackPoint.count();
console.log(`\nВсього точок треку в базі: ${points}`);

await prisma.$disconnect();
