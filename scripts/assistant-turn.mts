/**
 * Один хід помічника в консолі — без HTTP і без інтерфейсу.
 *
 * Найкоротший шлях перевірити, що модель бере ті інструменти, що треба, і
 * що відповідь спирається на дані. Розмова створюється справжня, тож її
 * видно і в кабінеті.
 *
 *   npx tsx --env-file=.env scripts/assistant-turn.mts "Сплануй мій день"
 *   npx tsx --env-file=.env scripts/assistant-turn.mts "..." [email] [threadId]
 */

import { prisma } from "../src/lib/prisma";
import { runTurn } from "../src/lib/assistant/loop";
import { createThread } from "../src/lib/assistant/threads";
import { kyivDate } from "../src/lib/date/kyiv";
import type { TurnEvent } from "../src/lib/assistant/types";

const DEFAULT_REP = "rep-kavetskyi-viktor@budvik.local";
const [question, email = DEFAULT_REP, existingThread] = process.argv.slice(2);

if (!question) {
  console.error('Треба питання: npx tsx --env-file=.env scripts/assistant-turn.mts "Сплануй мій день"');
  process.exit(1);
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("Немає DEEPSEEK_API_KEY (запускати з --env-file=.env)");
  process.exit(1);
}

const rep = await prisma.user.findFirst({
  where: { email },
  select: { id: true, name: true, role: true },
});
if (!rep) {
  console.error(`Користувача ${email} немає`);
  process.exit(1);
}

const threadId = existingThread ?? (await createThread(rep.id, rep.id)).id;
console.log(`розмова ${threadId} · ${rep.name}\n`);

const started = Date.now();
let buffer = "";

const emit = (e: TurnEvent) => {
  const at = `${((Date.now() - started) / 1000).toFixed(1)}с`;
  if (e.event === "tool_start") console.log(`\n[${at}] ► ${e.data.label} (${e.data.name})`);
  else if (e.event === "tool_done")
    console.log(`[${at}] ✓ ${e.data.name} ${e.data.ok ? "" : "— ПОМИЛКА "}${e.data.ms} мс`);
  else if (e.event === "drop") buffer = "";
  else if (e.event === "delta") buffer += e.data.text;
  else if (e.event === "error") console.log(`\n[${at}] ✗ ${e.data.message}`);
};

try {
  const out = await runTurn({
    threadId,
    ctx: {
      userId: rep.id,
      role: rep.role,
      kind: rep.role === "DRIVER" ? ("DRIVER" as const) : ("SALES" as const),
      scope: { repId: rep.id, repName: rep.name },
      today: kyivDate(new Date()),
    },
    selfScoped: true,
    userText: question,
    isFirstMessage: !existingThread,
    apiKey,
    emit,
  });

  console.log(`\n${"─".repeat(70)}\n${buffer}\n${"─".repeat(70)}`);
  console.log(
    `раундів ${out.rounds} · токенів ${out.usage.total} (вхід ${out.usage.prompt}) · ` +
      `${((Date.now() - started) / 1000).toFixed(1)} с · відкинутих посилань ${out.strippedLinks}`
  );
} catch (e) {
  console.error("ПОМИЛКА ХОДУ:", (e as Error).message);
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
