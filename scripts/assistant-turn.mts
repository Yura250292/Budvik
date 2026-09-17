/**
 * Один хід помічника в консолі — без HTTP і без інтерфейсу.
 *
 * Найкоротший шлях перевірити, що модель бере ті інструменти, що треба, і
 * що відповідь спирається на дані. Розмова створюється справжня, тож її
 * видно і в кабінеті.
 *
 *   npx tsx --env-file=.env scripts/assistant-turn.mts "Сплануй мій день"
 *   npx tsx --env-file=.env scripts/assistant-turn.mts "..." [email] [threadId]
 *   npx tsx --env-file=.env scripts/assistant-turn.mts --model=deepseek "..." admin@…
 *
 * --model=gemini|deepseek — перемикач керівника (як у кабінеті); для решти
 * видів ігнорується. Без нього керівник іде на ASSISTANT_ADMIN_MODEL.
 */

import { prisma } from "../src/lib/prisma";
import { runTurn } from "../src/lib/assistant/loop";
import { createThread } from "../src/lib/assistant/threads";
import { kyivDate } from "../src/lib/date/kyiv";
import { kindForThread } from "../src/lib/assistant/scope";
import { assistantKeys } from "../src/lib/assistant/config";
import type { TurnEvent } from "../src/lib/assistant/types";

const DEFAULT_REP = "rep-kavetskyi-viktor@budvik.local";
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const [question, email = DEFAULT_REP, existingThread] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modelFlag = flags.find((f) => f.startsWith("--model="))?.slice("--model=".length);
const modelChoice = modelFlag === "gemini" || modelFlag === "deepseek" ? modelFlag : null;

if (!question) {
  console.error('Треба питання: npx tsx --env-file=.env scripts/assistant-turn.mts "Сплануй мій день"');
  process.exit(1);
}

const keys = assistantKeys();
if (!keys.deepseek && !keys.gemini) {
  console.error("Немає ні DEEPSEEK_API_KEY, ні ASSISTANT_GEMINI_API_KEY / GEMINI_API_KEY (запускати з --env-file=.env)");
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
const kind = kindForThread(rep.role, rep.id, rep.id);
console.log(`розмова ${threadId} · ${rep.name} · вид ${kind}\n`);

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
  else if (e.event === "model") console.log(`\n[${at}] ⇄ ${e.data.note ?? e.data.model}`);
};

try {
  const out = await runTurn({
    threadId,
    ctx: {
      userId: rep.id,
      role: rep.role,
      kind,
      scope: { repId: rep.id, repName: rep.name ?? "", company: kind === "ADMIN" },
      today: kyivDate(new Date()),
    },
    selfScoped: true,
    userText: question,
    isFirstMessage: !existingThread,
    keys,
    modelChoice,
    emit,
  });

  console.log(`\n${"─".repeat(70)}\n${buffer}\n${"─".repeat(70)}`);
  console.log(
    `${out.model ?? "без моделі"} · раундів ${out.rounds} · токенів ${out.usage.total} (вхід ${out.usage.prompt}, ` +
      `вихід ${out.usage.completion}, з них міркування ${out.usage.reasoning}) · ` +
      `${((Date.now() - started) / 1000).toFixed(1)} с · відкинутих посилань ${out.strippedLinks}`
  );
} catch (e) {
  console.error("ПОМИЛКА ХОДУ:", (e as Error).message);
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
