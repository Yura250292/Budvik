/**
 * Наради по живій базі: черга, промпт моделі, доставка задач — і, свідомо, справжній тік.
 *
 *   npx tsx --env-file=.env scripts/meetings-process.mts                   # dry: черга й стан обробника
 *   npx tsx --env-file=.env scripts/meetings-process.mts --id <meetingId>  # dry: стан у AssemblyAI і зібраний промпт
 *   npx tsx --env-file=.env scripts/meetings-process.mts --prompt --id <id> # dry: надрукувати промпт цілком
 *   npx tsx --env-file=.env scripts/meetings-process.mts --tasks           # dry: кому піде рядок і пуш про задачі
 *   npx tsx --env-file=.env scripts/meetings-process.mts --staff           # список персоналу для промпту
 *   npx tsx --env-file=.env scripts/meetings-process.mts --boost           # словник для розпізнавання
 *   npx tsx --env-file=.env scripts/meetings-process.mts --run [--id <id>] # справжній тік
 *
 * Без --run нічого не пишеться і нічого не оплачується. Локальний .env дивиться
 * в бойову базу, тож --run — лише свідомо: це той самий тік, що робить воркер,
 * він платить AssemblyAI й OpenAI і шле пуші.
 */
import { prisma } from "../src/lib/prisma";
import { workerState } from "../src/lib/meetings";
import { getTranscript } from "../src/lib/meetings/assemblyai";
import { meetingsMissingEnv, preparePrompt, processMeetings } from "../src/lib/meetings/process";
import { collectWordBoost } from "../src/lib/meetings/vocabulary";
import { listStaff } from "../src/lib/tasks";
import { deliverTaskNotifications } from "../src/lib/tasks/notify";

const has = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const id = arg("id") ?? undefined;
const run = has("run");

const missing = meetingsMissingEnv();
console.log(`ключі: ${missing.length ? `бракує ${missing.join(", ")}` : "усі на місці"}`);
const worker = await workerState();
console.log(
  `обробник: ${worker.lastTickAt ? `останній тік ${worker.lastTickAt}${worker.stale ? " — ЗАВМЕР" : ""}` : "ще не тікав"}${
    worker.missing.length ? `, на воркері бракує ${worker.missing.join(", ")}` : ""
  }\n`
);

if (has("staff")) {
  for (const s of await listStaff()) console.log(`  ${s.roleLabel.padEnd(11)} ${s.name}`);
} else if (has("boost")) {
  const terms = await collectWordBoost();
  console.log(`${terms.length} слів:\n${terms.join(", ")}`);
} else if (has("tasks")) {
  const log = await deliverTaskNotifications({ dry: true });
  console.log(log.length ? log.join("\n") : "нікого повідомляти");
} else if (run) {
  const log = await processMeetings({ onlyId: id });
  for (const l of log) console.log(`${l.title}: ${l.from} → ${l.to}${l.note ? ` — ${l.note}` : ""}`);
  if (log.length === 0) console.log("нічого не зроблено");
  const delivered = await deliverTaskNotifications();
  if (delivered.length) console.log(delivered.join("\n"));
} else if (id) {
  const m = await prisma.meeting.findUnique({
    where: { id },
    select: { title: true, status: true, assemblyTranscriptId: true, processingError: true, transcribeAttempts: true, summarizeAttempts: true },
  });
  if (!m) throw new Error(`нараду ${id} не знайдено`);
  console.log(`${m.title}: ${m.status}, спроб розпізнавання ${m.transcribeAttempts}, підсумку ${m.summarizeAttempts}`);
  if (m.processingError) console.log(`помилка: ${m.processingError}`);
  if (m.assemblyTranscriptId && process.env.ASSEMBLYAI_API_KEY) {
    const t = await getTranscript(m.assemblyTranscriptId);
    console.log(`AssemblyAI: ${t.status}${t.error ? ` — ${t.error}` : ""}, реплік ${t.utterances.length}`);
  }
  try {
    const p = await preparePrompt(id);
    console.log(
      `\nпромпт: ${p.text.length} символів${p.truncated ? " (текст обрізано)" : ""}, персонал ${p.staff.length}, відкриті задачі ${p.tasks.length}${
        p.compact ? ", стислий режим" : ""
      }`
    );
    if (has("prompt")) console.log(`\n${p.text}`);
  } catch (e) {
    console.log(`промпт не зібрано: ${e instanceof Error ? e.message : e}`);
  }
} else {
  const log = await processMeetings({ dry: true });
  for (const l of log) console.log(`${l.id}  ${l.title}: ${l.from} → ${l.to}${l.note ? ` — ${l.note}` : ""}`);
  if (log.length === 0) console.log("черга порожня");
}

await prisma.$disconnect();
