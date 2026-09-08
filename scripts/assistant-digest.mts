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
import { buildDigest, renderDigest, sendDailyDigest, digestChatId } from "../src/lib/assistant/digest";

const send = process.argv.includes("--send");

if (send) {
  const digest = await sendDailyDigest({ force: true });
  console.log(digest ? `надіслано в ${digestChatId() ?? "нікуди"}` : "не надіслано (немає чату або нема про що)");
} else {
  const digest = await buildDigest();
  console.log(renderDigest(digest).replace(/<\/?b>/g, "*"));
  console.log(`\n— рядків ${digest.lines.length}, лист ${digest.empty ? "НЕ пішов би" : "пішов би"}`);
  console.log(`— чат: ${digestChatId() ?? "DIGEST_CHAT_ID не заведено"}`);
}

await prisma.$disconnect();
