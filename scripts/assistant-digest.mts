/**
 * Ранкове зведення керівникові — прогін без розсилки.
 *
 * Показує, що саме пішло б у Telegram сьогодні, і не пише нічого ні в
 * базу, ні в чат: --send доводиться вказувати руками.
 *
 *   npx tsx --env-file=.env scripts/assistant-digest.mts
 *   npx tsx --env-file=.env scripts/assistant-digest.mts --send
 */

import { prisma } from "../src/lib/prisma";
import {
  buildDigest,
  digestChatId,
  digestHasNews,
  renderMarkdown,
  renderTelegram,
  sendDailyDigest,
} from "../src/lib/assistant/digest";

const send = process.argv.includes("--send");

if (send) {
  const digest = await sendDailyDigest({ force: true });
  console.log(digest ? `надіслано в ${digestChatId() ?? "нікуди"}` : "не надіслано (немає чату або нема про що)");
} else {
  const facts = await buildDigest();

  // Показуємо ОБИДВА вигляди: у Telegram таблиці моноширинні, у кабінеті —
  // справжні, і зламатися може будь-який із двох окремо.
  console.log("──────── як побачить Telegram ────────\n");
  console.log(
    renderTelegram(facts)
      .replace(/<\/?b>/g, "*")
      .replace(/<\/?pre>/g, "")
  );
  console.log("\n──────── як побачить кабінет ────────\n");
  console.log(renderMarkdown(facts));
  console.log(`\n— лист ${digestHasNews(facts) ? "пішов би" : "НЕ пішов би (нема про що)"}`);
  console.log(`— чат: ${digestChatId() ?? "DIGEST_CHAT_ID не заведено"}`);
}

await prisma.$disconnect();
