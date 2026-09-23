/**
 * Регресійний набір: питання, які мають відповідатися правильно й далі.
 *
 * Навіщо він узагалі потрібен. Правило, заведене з 👎, змінює поведінку
 * помічника на ВСІХ питаннях, не лише на тому, через яке народилось.
 * «Пиши коротше» може вимкнути діаграми; «завжди називай залишок» —
 * перетворити відповідь про людей на звіт про склад. Набір ловить саме
 * це: не нову помилку, а стару перемогу, яку щойно зламали.
 *
 * ГОЛОВНЕ ПРАВИЛО НАБОРУ: очікування описують ФОРМУ, а не числа.
 *
 * Набір ганяє справжній хід по живій базі, і завтрашня дебіторка інша,
 * ніж сьогоднішня. Кейс «оборот має бути 7,7 млн» помре за добу; кейс
 * «має викликати team_overview, намалювати діаграму, не сказати
 * „перцентиль" і не мати більше трьох незвірених чисел» живе роками.
 *
 * ДВА ВИДИ КЕЙСІВ, І ВОНИ ЗАВОДЯТЬСЯ ПО-РІЗНОМУ:
 *
 *   👍 еталон (`golden`) — знімок ходу і Є очікування. Що інструменти
 *      відпрацювали, що намалювалось, скільки чисел звірилось: усе це
 *      знімається з відповіді, яку керівник похвалив, і стає нормою.
 *
 *   👎 регресія — знімок це те, як НЕ треба. Форму з нього копіювати
 *      не можна: саме вона й була неправильна. Тому з поганої відповіді
 *      береться лише питання й рубрика («а як мало бути» словами
 *      керівника), а очікування дописуються руками. Кейс без очікувань
 *      чесно позначений чернеткою й у прогін не йде.
 *
 * Кейси живуть у базі, а не у файлі: кнопка «У регресію» стоїть у
 * браузері, а писати в репозиторій із продакшену неможливо. Масив у
 * scripts/assistant-eval.mts лишається запасним і нікуди не дівається.
 */

import { prisma } from "@/lib/prisma";
import type { TraceStep } from "@/lib/assistant/feedback";

/** Блоки, які вміє малювати помічник. Джерело — blocks.ts. */
const BLOCK_KINDS = ["kpi", "chart", "tree", "file", "route"] as const;

export type EvalCaseView = {
  id: string;
  question: string;
  kind: string;
  expectTools: string[];
  forbidTools: string[];
  expectBlocks: string[];
  expectVia: string | null;
  mustContain: string[];
  mustNotContain: string[];
  maxUnverified: number | null;
  rubric: string | null;
  golden: boolean;
  status: "DRAFT" | "ACTIVE" | "OFF";
  createdAt: string;
};

function toView(r: {
  id: string;
  question: string;
  kind: string;
  expectTools: string[];
  forbidTools: string[];
  expectBlocks: string[];
  expectVia: string | null;
  mustContain: string[];
  mustNotContain: string[];
  maxUnverified: number | null;
  rubric: string | null;
  golden: boolean;
  status: "DRAFT" | "ACTIVE" | "OFF";
  createdAt: Date;
}): EvalCaseView {
  return { ...r, createdAt: r.createdAt.toISOString() };
}

/** Які блоки намалювала відповідь. */
export function blocksIn(answer: string): string[] {
  return BLOCK_KINDS.filter((b) => answer.includes(`\`\`\`budvik-${b}`));
}

/**
 * Заводить кейс із розібраної відповіді.
 *
 * Для еталона форма знімається зі знімка ходу; для регресії — ні, і це
 * не лінощі, а єдиний чесний варіант: копіювати форму поганої відповіді
 * означало б закріпити тестом саме ту помилку, через яку її позначили.
 */
export async function caseFromFeedback(feedbackId: string, golden: boolean): Promise<EvalCaseView | null> {
  const fb = await prisma.assistantFeedback.findUnique({ where: { id: feedbackId } });
  if (!fb || !fb.question.trim()) return null;

  const trace = (fb.toolTrace as unknown as TraceStep[]) ?? [];
  const tools = [...new Set(trace.filter((t) => t.ok).map((t) => t.name))];

  const row = await prisma.assistantEvalCase.create({
    data: {
      question: fb.question,
      kind: fb.kind ?? "ADMIN",
      // Форма — лише з еталона. З поганої відповіді беремо саме питання.
      expectTools: golden ? tools : [],
      expectBlocks: golden ? blocksIn(fb.answer) : [],
      expectVia: golden ? (fb.viaModel ? "MODEL" : "CODE") : null,
      /*
       * Стеля незвірених чисел. У еталона беремо факт, але не нижче двох:
       * зафіксувати «рівно нуль» означало б завалювати набір щоразу, коли
       * модель назве зайву дату або відсоток, порахований нею самою.
       */
      maxUnverified: golden ? Math.max(fb.numbersUnverified, 2) : null,
      rubric: fb.expected,
      golden,
      feedbackId: fb.id,
      /*
       * Регресійний кейс без очікувань у прогін не йде: він поки лише
       * питання. Керівник дописує, що саме має статись, — і вмикає.
       */
      status: golden ? "ACTIVE" : "DRAFT",
    },
  });
  return toView(row);
}

export async function listEvalCases(): Promise<EvalCaseView[]> {
  const rows = await prisma.assistantEvalCase.findMany({
    orderBy: [{ golden: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map(toView);
}

export async function updateEvalCase(
  id: string,
  patch: Partial<{
    question: string;
    expectTools: string[];
    forbidTools: string[];
    expectBlocks: string[];
    expectVia: string | null;
    mustContain: string[];
    mustNotContain: string[];
    maxUnverified: number | null;
    rubric: string | null;
    status: "DRAFT" | "ACTIVE" | "OFF";
    golden: boolean;
  }>
): Promise<EvalCaseView> {
  const row = await prisma.assistantEvalCase.update({ where: { id }, data: patch });
  return toView(row);
}

export async function deleteEvalCase(id: string): Promise<void> {
  await prisma.assistantEvalCase.delete({ where: { id } });
}

/**
 * Кейси для прогону.
 *
 * Лише ACTIVE: чернетки — це питання без очікувань, і вважати їх
 * проваленими було б неправдою.
 */
export async function activeCases(kind = "ADMIN"): Promise<EvalCaseView[]> {
  const rows = await prisma.assistantEvalCase.findMany({
    where: { status: "ACTIVE", kind },
    orderBy: [{ golden: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

export type CaseResult = {
  id: string;
  question: string;
  golden: boolean;
  passed: boolean;
  /** Що саме не збіглося — словами, а не кодами. */
  failures: string[];
};

/**
 * Звіряє один прогін із очікуваннями кейса.
 *
 * Чистa функція без бази й без мережі: усе, що їй треба, прогін уже
 * віддав. Завдяки цьому її можна ганяти і зі скрипта, і з воркера, і в
 * тесті — без ключів до моделей.
 */
export function judgeCase(
  c: EvalCaseView,
  run: { text: string; tools: string[]; viaModel: boolean; unverified: number }
): CaseResult {
  const failures: string[] = [];

  for (const t of c.expectTools) {
    if (!run.tools.includes(t)) failures.push(`не викликав ${t}`);
  }
  for (const t of c.forbidTools) {
    if (run.tools.includes(t)) failures.push(`викликав заборонений ${t}`);
  }
  for (const b of c.expectBlocks) {
    if (!run.text.includes(`\`\`\`budvik-${b}`)) failures.push(`не намалював ${b}`);
  }
  if (c.expectVia === "MODEL" && !run.viaModel) failures.push("відповів код, а мала модель");
  if (c.expectVia === "CODE" && run.viaModel) failures.push("пішов до моделі, а мав відповісти код");

  const lower = run.text.toLowerCase();
  for (const s of c.mustContain) {
    if (!lower.includes(s.toLowerCase())) failures.push(`немає «${s}»`);
  }
  for (const s of c.mustNotContain) {
    if (lower.includes(s.toLowerCase())) failures.push(`сказав «${s}»`);
  }
  if (c.maxUnverified != null && run.unverified > c.maxUnverified) {
    failures.push(`чисел поза даними ${run.unverified}, дозволено ${c.maxUnverified}`);
  }

  return { id: c.id, question: c.question, golden: c.golden, passed: failures.length === 0, failures };
}
