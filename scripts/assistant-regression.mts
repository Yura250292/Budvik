/**
 * Регресійний набір помічника: чи не зламалось те, що вже працювало.
 *
 * Навіщо окремо від assistant-eval.mts. Той порівнює МОДЕЛІ на сталому
 * списку питань і відповідає на питання «хто краще». Цей перевіряє
 * ПОВЕДІНКУ на кейсах, які завів керівник із черги розбору, і відповідає
 * на питання «чи не зіпсувало щось нове те, що вже було добре».
 *
 * Коли ганяти — перед тим, як увімкнути нове правило. Правило міняє
 * відповіді на ВСІХ питаннях, не лише на тому, через яке народилось, і
 * еталони (👍) існують рівно для того, щоб це помітити.
 *
 *   npx tsx --env-file=.env scripts/assistant-regression.mts
 *   npx tsx --env-file=.env scripts/assistant-regression.mts --golden   (лише еталони)
 *   npx tsx --env-file=.env scripts/assistant-regression.mts --keep     (лишити розмови)
 *
 * Хід справжній: розмови пишуться в базу сайту від імені керівника й
 * після прогону видаляються. У базу 1С не пишеться нічого.
 *
 * У CI це не виноситься свідомо: потрібна бойова база (кейси про живих
 * торгових і живі бренди), прогін коштує грошей і по 40 секунд на кейс,
 * а результат залежить від даних дня — кейс про конкретного торгового
 * впаде, коли той піде у відпустку.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { runTurn } from "../src/lib/assistant/loop";
import { createThread, deleteThread } from "../src/lib/assistant/threads";
import { kyivDate } from "../src/lib/date/kyiv";
import { assistantKeys } from "../src/lib/assistant/config";
import { activeCases, judgeCase, type CaseResult } from "../src/lib/assistant/eval-cases";
import type { TurnEvent } from "../src/lib/assistant/types";

const OWNER = process.env.ADMIN_EMAIL ?? "ufedishin@gmail.com";

const args = process.argv.slice(2);
const goldenOnly = args.includes("--golden");
const keep = args.includes("--keep");

async function main() {
  const owner = await prisma.user.findFirst({
    where: { email: OWNER },
    select: { id: true, name: true, role: true },
  });
  if (!owner) {
    console.error(`Немає користувача ${OWNER}`);
    process.exit(1);
  }

  const all = await activeCases("ADMIN");
  const cases = goldenOnly ? all.filter((c) => c.golden) : all;
  if (cases.length === 0) {
    console.log("Набір порожній. Заведіть кейси кнопкою «У регресію» на екрані розбору.");
    return;
  }

  console.log(`Кейсів: ${cases.length} (еталонів ${cases.filter((c) => c.golden).length})\n`);
  const keys = assistantKeys();
  const results: Array<CaseResult & { seconds: number; error?: string }> = [];

  for (const [i, c] of cases.entries()) {
    const thread = await createThread(owner.id, owner.id);
    let text = "";
    const tools: string[] = [];
    const started = Date.now();

    const emit = (e: TurnEvent) => {
      if (e.event === "drop") text = "";
      else if (e.event === "delta") text += e.data.text;
      else if (e.event === "tool_start") tools.push(e.data.name);
    };

    try {
      const out = await runTurn({
        threadId: thread.id,
        ctx: {
          userId: owner.id,
          role: owner.role,
          kind: "ADMIN",
          scope: { repId: owner.id, repName: owner.name ?? "", company: true },
          today: kyivDate(new Date()),
        },
        selfScoped: true,
        userText: c.question,
        isFirstMessage: true,
        keys,
        emit,
      });

      const numbers = (out as { numbers?: { checked: number; unverified: number[] } }).numbers;
      const verdict = judgeCase(c, {
        text,
        tools,
        // promptTokens = 0 означає, що відповідь склав код без моделі.
        viaModel: out.usage.prompt > 0,
        unverified: numbers?.unverified.length ?? 0,
      });
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      results.push({ ...verdict, seconds });

      const mark = verdict.passed ? "✅" : "❌";
      const tag = c.golden ? " [еталон]" : "";
      console.log(`${mark} ${i + 1}/${cases.length}${tag} ${c.question.slice(0, 70)} · ${seconds} с`);
      if (!verdict.passed) console.log(`   ${verdict.failures.join("; ")}`);
    } catch (e) {
      const msg = (e as Error).message;
      results.push({
        id: c.id,
        question: c.question,
        golden: c.golden,
        passed: false,
        failures: [`хід упав: ${msg}`],
        seconds: Math.round((Date.now() - started) / 100) / 10,
        error: msg,
      });
      console.log(`❌ ${i + 1}/${cases.length} ${c.question.slice(0, 70)} · хід упав: ${msg}`);
    } finally {
      if (!keep) await deleteThread(thread.id).catch(() => {});
    }
  }

  const failed = results.filter((r) => !r.passed);
  const goldenFailed = failed.filter((r) => r.golden);

  console.log(`\nПройшло ${results.length - failed.length} з ${results.length}`);
  if (goldenFailed.length > 0) {
    // Головний сигнал прогону: зламався не новий кейс, а те, що працювало.
    console.log(`⚠️  Провалено ЕТАЛОНІВ: ${goldenFailed.length} — правило зіпсувало те, що вже було добре.`);
  }

  const dir = `output/assistant-regression/${kyivDate(new Date())}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/report.json`, JSON.stringify(results, null, 2));

  const md = [
    `# Регресія помічника · ${kyivDate(new Date())}`,
    "",
    `Пройшло **${results.length - failed.length} з ${results.length}**` +
      (goldenFailed.length > 0 ? `, з них провалено еталонів: **${goldenFailed.length}**` : ""),
    "",
    "| | Питання | Час | Що не збіглося |",
    "|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.passed ? "✅" : "❌"}${r.golden ? " 👍" : ""} | ${r.question.replace(/\|/g, "/")} | ${r.seconds} с | ${
          r.failures.join("; ") || "—"
        } |`
    ),
  ].join("\n");
  writeFileSync(`${dir}/report.md`, md);
  console.log(`Звіт: ${dir}/report.md`);

  if (goldenFailed.length > 0) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
