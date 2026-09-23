/**
 * Правила, які підкладаються помічникові в кожен наступний хід.
 *
 * Це і є все «навчання», яке тут можливе. Gemini і DeepSeek — чужі закриті
 * моделі, донавчити їх не можна ні на власних розмовах, ні на оцінках
 * керівника. Зате можна щоразу нагадувати те, що він уже виправляв: 👎 з
 * поясненням «а як мало бути» стає одним реченням, і це речення їде в
 * кожному ході, поки його не вимкнуть.
 *
 * Три межі, без яких механізм зіпсував би сам себе:
 *
 *   1. Правила живуть у ЗМІННІЙ частині ходу (buildTurnContext), не в
 *      системному промпті. Той лишається байт-у-байт тим самим між
 *      запитами, і провайдер зараховує його як кешований префікс; правила
 *      міняються щотижня і вбили б кеш на всіх чотирьох видах помічника.
 *      Плюс увага: останній блок перед питанням — найсильніша позиція.
 *
 *   2. Стеля 12 правил на хід. Коли правил стане п'ятдесят, стеля не
 *      зміниться — просто тридцять вісім у хід не потраплять, і це буде
 *      видно стовпчиком «спрацювало N разів». Це і є механізм прибирання:
 *      правило, яке за місяць не підклалося жодного разу, або нікому не
 *      потрібне, або має надто вузькі тригери.
 *
 *   3. Обов'язковий рядок у кінці блоку. Без нього правило «пиши коротше,
 *      без застережень» одного дня зіштовхнеться з правилом про джерело
 *      правди — і модель обере правило, а не інструкцію.
 *
 * Чернетки в хід не йдуть ніколи: жодне правило не вмикається саме,
 * керівник затверджує кожне.
 */

import { prisma } from "@/lib/prisma";
import type { AssistantKind } from "@/lib/assistant/types";

/**
 * Скільки правил може потрапити в один хід.
 *
 * Дванадцять по 200 знаків — це ≈450 токенів, близько 1,5% ходу. Головне
 * тут не ціна, а суперечності: п'ятдесят правил, зібраних за пів року,
 * гарантовано міститимуть пару взаємно виключних, і фізична стеля не дає
 * їм зустрітися в одному запиті.
 */
const LESSON_LIMIT = 12;

/**
 * Стеля знаків на одне правило й на весь блок.
 *
 * Правило довше за речення — це вже інструкція, і їй місце в промпті, який
 * кешується, а не в змінній частині, яку провайдер рахує щоразу наново.
 * Довгі правила ріжемо при відборі, а не мовчки обрізаємо: обрізане на
 * півслові правило гірше за відсутнє.
 */
const LESSON_MAX_LEN = 200;
const LESSONS_BUDGET = 1800;

export type PickedLessons = {
  /** Готовий текстовий блок для контексту ходу; null — правил немає. */
  block: string | null;
  /** Які саме правила поїхали — щоб потім знати підозрюваних. */
  ids: string[];
};

const EMPTY: PickedLessons = { block: null, ids: [] };

type LessonRow = {
  id: string;
  text: string;
  triggers: string[];
};

/**
 * Чи згадує питання хоч один тригер правила.
 *
 * Звичайний `includes` по нижньому регістру, без морфології — і це
 * навмисно. Тригер задається основою («генератор», «дебіторк»), тож
 * відмінки й число ловляться самі: «генераторів», «генератори»,
 * «дебіторка», «дебіторці». Заводити нормалізацію слів заради цього
 * означало б завести другу правду про мову поруч із router.ts, який
 * упізнає питання рівно так само.
 */
function matches(triggers: string[], question: string): boolean {
  return triggers.some((t) => {
    const needle = t.trim().toLowerCase();
    return needle.length > 0 && question.includes(needle);
  });
}

/**
 * Відбирає правила для цього ходу.
 *
 * Беремо рівно два різновиди: загальні (без тригерів) — вони діють завжди,
 * і ті, чий тригер є в питанні. Нерелевантними стелю НЕ добиваємо, і це
 * виправлення після проби: правило «у питаннях про закупівлю називай
 * залишок» доїхало в питання «хто сьогодні на маршруті» просто тому, що
 * лишалось місце. Так тригери втрачають будь-який сенс, а модель отримує
 * вказівку говорити про склад там, де її питають про людей.
 *
 * Тобто стеля — це межа, а не квота, яку треба вибрати.
 *
 * Викликати ЛИШЕ коли хід іде моделі. Кодові відповіді (tryDirectAnswer)
 * правил не бачать узагалі, тож для них це був би марний запит у базу —
 * і, що гірше, марна надія керівника, який завів правило для питання, на
 * яке відповідає роутер. Саме тому екран розбору не дає заводити правило
 * на кодову відповідь.
 */
export async function pickLessons(kind: AssistantKind, question: string): Promise<PickedLessons> {
  try {
    const rows = await prisma.assistantLesson.findMany({
      where: {
        status: "ACTIVE",
        archivedAt: null,
        // null у kind означає «всім видам»; свій вид — поверх загальних.
        OR: [{ kind: null }, { kind }],
      },
      select: { id: true, text: true, triggers: true },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      // Беремо із запасом: тригерні відсіюються вже в пам'яті, і вузька
      // вибірка могла б відрізати саме те правило, що підходить питанню.
      take: 200,
    });
    if (rows.length === 0) return EMPTY;

    const q = question.toLowerCase();
    const general: LessonRow[] = [];
    const triggered: LessonRow[] = [];

    for (const r of rows) {
      if (r.text.length > LESSON_MAX_LEN) continue;
      if (r.triggers.length === 0) general.push(r);
      else if (matches(r.triggers, q)) triggered.push(r);
      // Тригер є, але не збігся — правило не про це питання. Кінець.
    }

    const picked: LessonRow[] = [];
    let budget = LESSONS_BUDGET;
    for (const r of [...general, ...triggered]) {
      if (picked.length >= LESSON_LIMIT) break;
      if (r.text.length > budget) continue;
      picked.push(r);
      budget -= r.text.length;
    }
    if (picked.length === 0) return EMPTY;

    const block = [
      "ВИПРАВЛЕННЯ КЕРІВНИКА — він уже вказував на це раніше:",
      ...picked.map((r, i) => `${i + 1}. ${r.text}`),
      // Без цього рядка правило «пиши коротше, без застережень» одного дня
      // переможе заборону називати числа поза даними.
      "Вони уточнюють інструкцію вище, але не скасовують її заборон: джерело чисел — лише дані інструментів.",
    ].join("\n");

    return { block, ids: picked.map((r) => r.id) };
  } catch (e) {
    // Правила — покращення, а не умова роботи. Впала база чи міграція ще
    // не накотилась — хід іде без них, як ішов до цієї фічі.
    console.warn(`[помічник] правила не завантажились: ${(e as Error).message}`);
    return EMPTY;
  }
}

/**
 * Відмічає, що правила справді поїхали в хід.
 *
 * Лічильник потрібен не для статистики, а щоб побачити мертві правила:
 * «спрацювало 0 разів за місяць» означає надто вузькі тригери або
 * непотрібне правило. Запис у гарячому шляху — тільки через `void` і з
 * власним catch, за зразком recordNumberCheck: лічильник не має права
 * зламати відповідь.
 */
export async function markLessonsUsed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await prisma.assistantLesson.updateMany({
      where: { id: { in: ids } },
      data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  } catch (e) {
    console.warn(`[помічник] лічильник правил не оновився: ${(e as Error).message}`);
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Керування правилами — для екрана розбору й сторінки правил.
 * ──────────────────────────────────────────────────────────────────── */

export type LessonView = {
  id: string;
  text: string;
  kind: string | null;
  triggers: string[];
  status: "DRAFT" | "ACTIVE" | "OFF";
  priority: number;
  usedCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  feedbackId: string | null;
};

/**
 * Слова, за якими правило впізнає «своє» питання.
 *
 * Пропозиція, а не вирок: керівник бачить їх у формі й правує. Беремо
 * основи довгих слів — шість літер вистачає, щоб «генератори» і
 * «генераторів» лягли на «генера», і замало, щоб зачепити сусіднє слово.
 * Службові слова викидаємо списком: без нього тригером стало б «скільки»,
 * і правило підкладалося б у кожне друге питання.
 */
const STOP_WORDS = new Set([
  "скільки", "який", "яка", "яке", "які", "чому", "коли", "де", "хто", "що",
  "покажи", "дай", "зроби", "треба", "можна", "будь", "ласка", "мені", "нам",
  "після", "перед", "через", "тому", "тільки", "також", "щоб", "цей", "цього",
  "цьому", "цим", "там", "тут", "більше", "менше", "краще", "гірше",
]);

const TRIGGER_STEM = 6;
const TRIGGER_MAX = 4;

export function suggestTriggers(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= TRIGGER_STEM && !STOP_WORDS.has(w));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const stem = w.slice(0, TRIGGER_STEM);
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(stem);
    if (out.length >= TRIGGER_MAX) break;
  }
  return out;
}

function toView(r: {
  id: string;
  text: string;
  kind: string | null;
  triggers: string[];
  status: "DRAFT" | "ACTIVE" | "OFF";
  priority: number;
  usedCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  feedbackId: string | null;
}): LessonView {
  return {
    id: r.id,
    text: r.text,
    kind: r.kind,
    triggers: r.triggers,
    status: r.status,
    priority: r.priority,
    usedCount: r.usedCount,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    feedbackId: r.feedbackId,
  };
}

/** Усі правила, крім архівних: діючі згори, далі чернетки й вимкнені. */
export async function listLessons(): Promise<LessonView[]> {
  const rows = await prisma.assistantLesson.findMany({
    where: { archivedAt: null },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map(toView);
}

/**
 * Правила зі спільними тригерами — показати при збереженні.
 *
 * Не заборона, а попередження: два правила про дебіторку цілком можуть
 * доповнювати одне одного. Але саме так ловиться пара, що суперечить
 * сама собі, — доки вона ще не потрапила в один хід.
 */
export async function lessonsSharingTriggers(triggers: string[], exceptId?: string): Promise<LessonView[]> {
  if (triggers.length === 0) return [];
  const rows = await prisma.assistantLesson.findMany({
    where: {
      archivedAt: null,
      status: { not: "OFF" },
      triggers: { hasSome: triggers },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    take: 10,
  });
  return rows.map(toView);
}

/**
 * Заводить правило.
 *
 * Завжди чернеткою: жодне правило не вмикається саме — ні з 👎, ні з
 * форми. Керівник читає текст ще раз і вмикає окремим рухом, бо правило
 * діятиме на кожну наступну відповідь.
 */
export async function createLesson(input: {
  text: string;
  kind?: string | null;
  triggers?: string[];
  authorId?: string | null;
  feedbackId?: string | null;
  priority?: number;
}): Promise<LessonView> {
  const text = input.text.trim().slice(0, LESSON_MAX_LEN);
  const row = await prisma.assistantLesson.create({
    data: {
      text,
      kind: input.kind ?? null,
      triggers: (input.triggers ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
      authorId: input.authorId ?? null,
      feedbackId: input.feedbackId ?? null,
      priority: input.priority ?? 0,
      status: "DRAFT",
    },
  });
  return toView(row);
}

export async function updateLesson(
  id: string,
  patch: { text?: string; status?: "DRAFT" | "ACTIVE" | "OFF"; triggers?: string[]; priority?: number; kind?: string | null }
): Promise<LessonView> {
  const row = await prisma.assistantLesson.update({
    where: { id },
    data: {
      ...(patch.text !== undefined ? { text: patch.text.trim().slice(0, LESSON_MAX_LEN) } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.triggers !== undefined
        ? { triggers: patch.triggers.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8) }
        : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    },
  });
  return toView(row);
}

/** М'яке вимкнення, як у пам'яті клієнта: рядок лишається, зі списку зникає. */
export async function archiveLesson(id: string): Promise<void> {
  await prisma.assistantLesson.update({
    where: { id },
    data: { archivedAt: new Date(), status: "OFF" },
  });
}

/** Стеля знаків на правило — щоб форма показувала ту саму межу, що й відбір. */
export const LESSON_TEXT_MAX = LESSON_MAX_LEN;
