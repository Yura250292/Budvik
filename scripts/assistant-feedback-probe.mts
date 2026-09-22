/**
 * Проба петлі якості: чи збирається знімок ходу з того, що вже в базі.
 *
 * Типово READ ONLY — лише читає відповіді помічника й друкує знімок.
 * Запис (--write) дозволений ТІЛЬКИ на локальній базі: перевіряти upsert
 * на проді немає потреби, а сплутати бази — справа однієї змінної.
 *
 *   npx tsx --env-file=.env scripts/assistant-feedback-probe.mts
 *   DATABASE_URL=postgresql://admin@127.0.0.1:5432/<база> npx tsx scripts/assistant-feedback-probe.mts --write
 */

import { prisma } from "../src/lib/prisma";
import { buildSnapshot, saveVerdict } from "../src/lib/assistant/feedback";

const write = process.argv.includes("--write");
const url = process.env.DATABASE_URL ?? "";
const local = url.includes("127.0.0.1") || url.includes("localhost");

if (write && !local) {
  console.error("--write лише на локальній базі. Зараз DATABASE_URL дивиться не туди.");
  process.exit(1);
}

const answers = await prisma.assistantMessage.findMany({
  where: { role: "ASSISTANT", content: { not: "" } },
  orderBy: { createdAt: "desc" },
  take: 3,
  select: { id: true },
});
console.log(`відповідей знайдено: ${answers.length}\n`);

for (const a of answers) {
  const snap = await buildSnapshot(a.id);
  if (!snap) {
    console.log(`${a.id}: знімок не зібрався`);
    continue;
  }
  console.log(`── ${a.id}`);
  console.log(`питання:   ${snap.question.slice(0, 90).replace(/\n/g, " ") || "(не знайдено)"}`);
  console.log(`відповідь: ${snap.answer.slice(0, 90).replace(/\n/g, " ")}`);
  console.log(`модель ${snap.model ?? "—"} · через модель: ${snap.viaModel} · намір: ${snap.intent ?? "—"}`);
  console.log(`інструменти: ${snap.toolTrace.map((t) => `${t.name}${t.ok ? "" : " ✗"}`).join(", ") || "—"}`);
  console.log(`раундів ${snap.rounds} · токени ${snap.promptTokens}/${snap.completionTokens}`);
  console.log(`числа: звірено ${snap.numbersChecked}, поза даними ${snap.numbersUnverified}`);
  console.log(`вид: ${snap.kind ?? "—"}\n`);
}

if (write && answers[0]) {
  const id = answers[0].id;
  const snap = await buildSnapshot(id);
  const saved = await saveVerdict({
    messageId: id,
    userId: snap!.userId,
    verdict: "BAD",
    expected: "Перевірка запису: текст правила",
  });
  console.log(`запис оцінки: ${JSON.stringify(saved)}`);

  // Друге натискання має ПЕРЕПИСАТИ присуд, а не завести другий рядок,
  // і не стерти вже написане «як мало бути».
  await saveVerdict({ messageId: id, userId: snap!.userId, verdict: "GOOD" });
  const row = await prisma.assistantFeedback.findUnique({ where: { messageId: id } });
  const total = await prisma.assistantFeedback.count();
  console.log(`після повторної оцінки: рядків ${total}, присуд ${row?.verdict}, пояснення збережено: ${Boolean(row?.expected)}`);
  console.log(`знімок у рядку: питання «${row?.question.slice(0, 60)}…», інструментів ${(row?.toolTrace as unknown[])?.length ?? 0}`);
}

await prisma.$disconnect();
