/**
 * Кандидати для SALES_ALERT_CHAT_ID: хто з керівників уже прив'язаний до бота.
 * Лише читання.
 *
 * Запуск: node --env-file=.env scripts/find-alert-chat.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const linked = await prisma.user.findMany({
  where: { telegramId: { not: null }, role: { in: ["ADMIN", "MANAGER"] } },
  select: { name: true, email: true, role: true, telegramId: true, telegramUsername: true },
  orderBy: { role: "asc" },
});

console.log(`Керівники з прив'язаним Telegram: ${linked.length}`);
for (const u of linked) {
  const uname = u.telegramUsername ? `@${u.telegramUsername}` : "—";
  console.log(`  ${u.role.padEnd(8)} ${u.name.padEnd(24)} ${uname.padEnd(18)} chat_id=${u.telegramId}  ${u.email}`);
}

if (!linked.length) {
  console.log("\nНемає жодного ADMIN/MANAGER із telegramId.");
  console.log("Це означає, що керівник ще не проходив прив'язку в боті.");
}

await prisma.$disconnect();
