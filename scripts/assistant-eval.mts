/**
 * Порівняння моделей помічника керівника на сталому наборі питань.
 *
 * Навіщо. Власник обрав Gemini для керівника 16.09.2026 з розрахунку «краще
 * зважує». Це треба міряти, а не вірити: той самий набір питань проганяється
 * через кожну модель, і в звіті поруч — час, раунди, токени, ціна, незвірені
 * числа, чи намалювала модель плитки й діаграми і чи зробила файл, коли
 * просили.
 *
 * Хід справжній (runTurn), тож розмови пишуться в базу сайту від імені
 * керівника — і після прогону видаляються (--keep лишає). У базу 1С нічого
 * не пишеться. Файли, якщо модель їх сформувала, лягають у R2 під префікс
 * керівника й живуть 30 днів, як усі.
 *
 *   npx tsx --env-file=.env scripts/assistant-eval.mts
 *   npx tsx --env-file=.env scripts/assistant-eval.mts --models=gemini,deepseek --only=1,3 --keep
 *
 * Звіт: output/assistant-eval/<дата>/report.md і report.json.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { runTurn } from "../src/lib/assistant/loop";
import { createThread, deleteThread } from "../src/lib/assistant/threads";
import { kyivDate } from "../src/lib/date/kyiv";
import { assistantKeys, type LlmFlavor } from "../src/lib/assistant/config";
import type { TurnEvent } from "../src/lib/assistant/types";

const OWNER = process.env.ADMIN_EMAIL ?? "ufedishin@gmail.com";

/** Ціна за 1 млн токенів, $: [вхід, вихід]. Звірено 16.09.2026. */
const PRICE: Record<LlmFlavor, [number, number]> = {
  deepseek: [0.15, 0.6],
  gemini: [0.75, 3.75],
};

/**
 * Питання — ті, з якими власник справді приходить. Друге в парі — очікування,
 * яке звіт перевіряє кодом: блоки у відповіді й виклик файла.
 */
const QUESTIONS: Array<{ q: string; expect: { kpi?: boolean; chart?: boolean; tree?: boolean; file?: boolean } }> = [
  {
    q: "Проаналізуй продажі за останні 2 місяці і підкажи, що мені замовити на наступний місяць: що ходове, чого не вистачає, скільки на залишку і з якою швидкістю витрачається",
    expect: { kpi: true },
  },
  { q: "Порівняй середній чек у серпні й у вересні: він впав через менші замовлення чи через менше клієнтів?", expect: { kpi: true } },
  { q: "Чому у Кулика Дмитра у вересні впав оборот проти серпня? Покажи схемою, що від чого залежить", expect: { tree: true } },
  { q: "Покажи оборот фірми по місяцях 2026 року діаграмою і скажи, де був пік", expect: { chart: true } },
  { q: "Який звʼязок між знижкою і маржею по брендах за 90 днів?", expect: { chart: true } },
  { q: "Які бренди ростуть, а які падають за останні 60 днів проти попередніх 60?", expect: { chart: true } },
  { q: "Хто з торгових найбільше продає бренд SOMA FIX і кому з клієнтів його варто запропонувати?", expect: {} },
  { q: "Сформуй Excel: що замовити по бренду APRO на наступний місяць", expect: { file: true } },
  { q: "Дай PDF боржників із простроченим боргом", expect: { file: true } },
  { q: "Що робити з мертвим складом на 13 мільйонів — розпродаж чи роздати торговим? Дай план на місяць", expect: { kpi: true } },
];

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const models = (flag("models") ?? "gemini,deepseek").split(",").filter((m): m is LlmFlavor => m === "gemini" || m === "deepseek");
const only = flag("only")?.split(",").map(Number);
const keep = args.includes("--keep");

const owner = await prisma.user.findFirst({ where: { email: OWNER }, select: { id: true, name: true, role: true } });
if (!owner) {
  console.error(`Немає користувача ${OWNER}`);
  process.exit(1);
}
const keys = assistantKeys();

type Row = {
  n: number;
  model: LlmFlavor;
  answeredBy: string | null;
  ok: boolean;
  error?: string;
  seconds: number;
  rounds: number;
  prompt: number;
  completion: number;
  reasoning: number;
  costUsd: number;
  unverified: number;
  checked: number;
  blocks: { kpi: boolean; chart: boolean; tree: boolean; file: boolean };
  met: boolean;
  switched: string | null;
  preview: string;
};

const rows: Row[] = [];
const cases = QUESTIONS.map((c, i) => ({ ...c, n: i + 1 })).filter((c) => !only || only.includes(c.n));

for (const c of cases) {
  for (const model of models) {
    const thread = await createThread(owner.id, owner.id);
    let text = "";
    let switched: string | null = null;
    const started = Date.now();
    const emit = (e: TurnEvent) => {
      if (e.event === "drop") text = "";
      else if (e.event === "delta") text += e.data.text;
      else if (e.event === "model" && e.data.note) switched = e.data.note;
    };
    try {
      const out = await runTurn({
        threadId: thread.id,
        ctx: { userId: owner.id, role: owner.role, kind: "ADMIN", scope: { repId: owner.id, repName: owner.name ?? "", company: true }, today: kyivDate(new Date()) },
        selfScoped: true,
        userText: c.q,
        isFirstMessage: true,
        keys,
        modelChoice: model,
        emit,
      });
      const answeredBy = out.model ?? null;
      const flavor: LlmFlavor = answeredBy?.startsWith("gemini") ? "gemini" : "deepseek";
      const [pin, pout] = PRICE[flavor];
      const blocks = {
        kpi: text.includes("```budvik-kpi"),
        chart: text.includes("```budvik-chart"),
        tree: text.includes("```budvik-tree"),
        file: text.includes("```budvik-file"),
      };
      const met = (Object.keys(c.expect) as Array<keyof typeof blocks>).every((k) => !c.expect[k] || blocks[k]);
      const numbers = (out as { numbers?: { checked: number; unverified: number[] } }).numbers;
      rows.push({
        n: c.n,
        model,
        answeredBy,
        ok: true,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        rounds: out.rounds,
        prompt: out.usage.prompt,
        completion: out.usage.completion,
        reasoning: out.usage.reasoning,
        costUsd: Math.round(((out.usage.prompt * pin + out.usage.completion * pout) / 1e6) * 10000) / 10000,
        unverified: numbers?.unverified.length ?? 0,
        checked: numbers?.checked ?? 0,
        blocks,
        met,
        switched,
        preview: text.replace(/```[\s\S]*?```/g, "[блок]").replace(/\s+/g, " ").slice(0, 280),
      });
    } catch (e) {
      rows.push({
        n: c.n, model, answeredBy: null, ok: false, error: (e as Error).message, seconds: Math.round((Date.now() - started) / 100) / 10,
        rounds: 0, prompt: 0, completion: 0, reasoning: 0, costUsd: 0, unverified: 0, checked: 0,
        blocks: { kpi: false, chart: false, tree: false, file: false }, met: false, switched, preview: "",
      });
    }
    const r = rows[rows.length - 1];
    console.log(
      `#${c.n} ${model.padEnd(8)} → ${r.ok ? r.answeredBy : "ПОМИЛКА"} · ${r.seconds} с · раундів ${r.rounds} · $${r.costUsd} · незвірених ${r.unverified}/${r.checked} · очікування ${r.met ? "так" : "НІ"}${r.switched ? ` · ${r.switched}` : ""}${r.error ? ` · ${r.error}` : ""}`
    );
    if (!keep) await deleteThread(thread.id).catch(() => {});
  }
}

const day = kyivDate(new Date());
const dir = `output/assistant-eval/${day}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/report.json`, JSON.stringify({ day, models, rows }, null, 2));

const summary = models.map((m) => {
  const list = rows.filter((r) => r.model === m);
  const done = list.filter((r) => r.ok);
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  return {
    m,
    ok: `${done.length}/${list.length}`,
    by: [...new Set(done.map((r) => r.answeredBy))].join(", "),
    median: median(done.map((r) => r.seconds)),
    cost: Math.round(done.reduce((s, r) => s + r.costUsd, 0) * 1000) / 1000,
    met: `${done.filter((r) => r.met).length}/${list.length}`,
    unverified: done.reduce((s, r) => s + r.unverified, 0),
  };
});

const md = [
  `# Порівняння моделей помічника керівника · ${day}`,
  "",
  "| Модель | Відповіли | Хто насправді | Медіана, с | Ціна прогону, $ | Очікування виконано | Незвірених чисел |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...summary.map((s) => `| ${s.m} | ${s.ok} | ${s.by || "—"} | ${s.median} | ${s.cost} | ${s.met} | ${s.unverified} |`),
  "",
  "## По питаннях",
  "",
  "| # | Модель | Відповіла | с | Раунди | $ | Плитки / діаграма / схема / файл | Очікування |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map(
    (r) =>
      `| ${r.n} | ${r.model} | ${r.ok ? r.answeredBy : `помилка: ${r.error}`} | ${r.seconds} | ${r.rounds} | ${r.costUsd} | ${[r.blocks.kpi, r.blocks.chart, r.blocks.tree, r.blocks.file].map((b) => (b ? "✓" : "·")).join(" ")} | ${r.met ? "✓" : "✗"} |`
  ),
  "",
  "## Питання",
  "",
  ...cases.map((c) => `${c.n}. ${c.q}`),
  "",
  "Якщо у стовпці «Хто насправді» у Gemini стоїть DeepSeek — спрацювала запасна модель (квота або перевантаження), і порівняння для цього питання не чисте.",
];
writeFileSync(`${dir}/report.md`, md.join("\n"));
console.log(`\nЗвіт: ${dir}/report.md`);
console.log("Nothing was written to 1C.");
await prisma.$disconnect();
process.exit(0);
