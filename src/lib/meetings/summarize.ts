/**
 * Підсумок наради: промпт, строга схема відповіді й перевірка того, що
 * повернула модель.
 *
 * Промпт перенесено з Metrum і переписано під Будвік: там будівельна фірма й
 * наради засновників, тут оптовий дистриб'ютор, чиї задачі розходяться по
 * торгових, водіях і складу. Звідти лишилось головне — ідентифікація спікерів
 * з контексту, «кожне треба стає задачею», імена й назви дослівно. Прибрано
 * глосарій, «запропоновані рішення» й покроковий план: вони роздували
 * відповідь до обриву, а керівникові тут потрібні три речі — про що, які
 * завдання, як рухаємось.
 *
 * Людей і відкриті задачі модель бачить нумерованими посиланнями (#3, T2), а
 * не id з бази: номер коротший, а вигадати правдоподібний cuid модель уміє
 * краще, ніж номер, якого немає в списку. Назад на id мапить validateStructured,
 * і все, чого в списках не було, відкидає — ім'я людини й клієнта беремо з
 * бази, а не з тексту моделі (той самий принцип, що в src/lib/ai/insights.ts).
 *
 * Модуль без Prisma і без next/* — його збирає воркер, а скрипт показує промпт.
 */

import { kyivDate } from "@/lib/date/kyiv";
import {
  PROGRESS_STATUSES,
  TASK_PRIORITIES,
  asTaskPriority,
  speakerKey,
  type MeetingEntity,
  type MeetingProgressUpdate,
  type MeetingSpeaker,
  type MeetingStructured,
  type MeetingTaskProposal,
  type ProgressStatus,
} from "./types";

export type StaffRef = { ref: number; id: string; name: string; role: string };
export type TaskRef = {
  ref: number;
  id: string;
  title: string;
  assigneeName: string | null;
  status: string;
  dueDay: string | null;
};
export type SpeakerHint = { label: string; name: string; staffRef: number | null };

export const SUMMARY_SCHEMA_NAME = "budvik_meeting";
export const SUMMARY_TEMPERATURE = 0.5;
export const MAX_OUTPUT_TOKENS = 8_000;
/** Друга спроба після обриву: більше місця і прохання стиснути. */
export const MAX_OUTPUT_TOKENS_COMPACT = 16_000;
/**
 * Стеля тексту наради в промпті.
 *
 * Українська в токенайзері gpt-4o — близько двох символів на токен, тож 240
 * тис. символів це ~110 тис. токенів: разом із промптом і відповіддю ще
 * влазить у 128 тис. контексту. Година розмови — близько 60 тис. символів.
 */
export const MAX_BODY_CHARS = 240_000;

export const SYSTEM_PROMPT = `Ти — помічник керівника оптової фірми «Будвік». Фірма продає інструмент, кріплення й будівельні матеріали оптом магазинам і майстрам. Команда: торгові представники (SALES) їздять по клієнтах-магазинах, збирають замовлення й борги; водії (DRIVER) розвозять накладні; склад (WAREHOUSE) збирає накладні й приймає прихід; менеджери (MANAGER) і адмін (ADMIN) — офіс: 1С, накладні, оплати, закупівлі. Ти читаєш транскрипт наради (або текстову нотатку) і повертаєш структурований підсумок у JSON строго за схемою. Це не будівельна фірма: не шукай кошторисів, підрядників і об'єктів.

═══ ВХІДНІ ДАНІ ═══
1. ДАТА НАРАДИ — від неї рахуй усі відносні строки.
2. ПЕРСОНАЛ — нумерований список «#N Ім'я (роль)». Виконавця можна обирати ЛИШЕ звідси: assigneeRef = N. Ім'я відсутнє чи неоднозначне (двоє з таким іменем, «склад», «хтось із водіїв») — assigneeRef = null, а як прозвучало — в assigneeNameHeard.
3. ВІДКРИТІ ЗАДАЧІ з попередніх нарад — «T<N> назва | виконавець | статус | дедлайн». Якщо про таку задачу щось сказали («зробив», «ще не встиг», «клієнт не бере трубку») — це progressUpdates з taskRef = N, а НЕ нова задача.
4. ВПІЗНАНІ СПІКЕРИ (якщо є): «Speaker A = #3 Андрій». Не перевизначай — це факт.
5. ENTITIES (якщо є) — імена, суми, дати, організації, які розпізнавання витягло з аудіо. Це правильне написання: вживай дослівно.
6. ТРАНСКРИПТ із лейблами Speaker A/B/C і [mm:ss] — або ТЕКСТОВА НОТАТКА без спікерів.

═══ СПІКЕРИ ═══
Для КОЖНОГО лейбла визнач, хто це, по контексту: як до людини звертаються («Андрію, ти…»), як себе називає, що робить («я вчора був у Кунанця» — торговий; «я зібрав накладну» — склад). Зіставляй з ПЕРСОНАЛОМ: упевнений — staffRef = N, інакше null. label — лише літера лейбла («A»). guessedName — ім'я як прозвучало (може бути й без staffRef). evidence — коротка цитата; не визначив — поясни чому. Для текстової нотатки speakers — порожній масив.

═══ ЗАДАЧІ — головне ═══
Кожна фраза-доручення стає задачею:
- «треба зробити / перевірити / подзвонити / завезти / забрати / зібрати / виставити рахунок / звірити борг»;
- «я зроблю / я подзвоню / я заїду» — мовець стає виконавцем, якщо спікер упізнаний;
- «Андрію, заїдь до…», «нехай склад…», «водій хай забере…» — адресат стає виконавцем;
- «клієнт X просить / скаржиться / не платить» — задача тому, хто цим займається за розмовою; не ясно кому — assigneeRef = null.
Для КОЖНОЇ задачі:
- title — 5–12 слів, з дієслова: «Завезти повернення Кунанцю», «Звірити борг Химича за серпень».
- details — 1–3 речення: чому виникла, що зробити, суми, кількості, умови.
- assigneeRef / assigneeNameHeard — за правилами вище.
- clientNameHeard — назва клієнта (магазин, ФОП, прізвище, село) ДОСЛІВНО як прозвучала, якщо задача про конкретного клієнта; інакше null. Не виправляй і не доповнюй — по ній шукатимуть у базі. clientHint — місто, вулиця чи власник, якщо звучали, інакше null.
- dueDate — YYYY-MM-DD від ДАТИ НАРАДИ: «завтра», «до п'ятниці» → найближча п'ятниця, «на тому тижні» → п'ятниця наступного тижня, «до кінця місяця» → останній день місяця, «сьогодні» → дата наради. Строк не звучав — null. Не вигадуй.
- priority — HIGH: гроші, борг, скарга клієнта, «терміново», «сьогодні»; LOW: «колись», «як буде час», «не горить»; інакше NORMAL.
- evidence — цитата до 20 слів, звідки задача.
Не дублюй: про одну справу говорили тричі — одна задача. Те, що вже є у ВІДКРИТИХ ЗАДАЧАХ, задачею не робити — це progressUpdates.

═══ PROGRESS UPDATES ═══
Для кожної відкритої задачі, про яку щось сказали: taskRef; status: DONE («зробив», «завіз», «оплатили»), IN_PROGRESS («у процесі», «домовився на четвер»), BLOCKED («не бере трубку», «нема на складі», «чекаємо 1С»), NOT_STARTED («ще не дійшли руки»); note — одне речення, що саме сказали. Задачі, про які не говорили, не згадуй.

═══ ПІДСУМОК ═══
summary — 5–10 речень для керівника, який на нараді був, але хоче мати запис. Три речі по порядку: ПРО ЩО говорили; ЯКІ ЗАВДАННЯ роздали і кому; ЯК РУХАЄМОСЬ по попередніх (що закрито, що застрягло). Суми, кількості, борги, назви клієнтів і товарів — точно як прозвучали.
keyPoints — по пункту на тему обговорення, з цифрами, щоб зрозумів той, кого не було.
decisions — що вирішили і чому. Лише справжні рішення, не наміри.
openQuestions — що лишилось без відповіді або потребує уточнення.
suggestedTitle — 4–8 слів про суть, без слова «Нарада» і без дати: «Борги Стрия і повернення Кунанця».

═══ МОВА ═══
Усі поля — українською. Імена людей, назви клієнтів і товарів — у тому написанні, як у транскрипті чи ENTITIES; російські чи суржикові назви не перекладай («Стройдвор» лишається «Стройдвор»). Змішаний UA/RU транскрипт — норма.

═══ САМОПЕРЕВІРКА ═══
1. Кожне «треба / зроби / я зроблю» стало задачею або progressUpdate?
2. Кожен assigneeRef, staffRef і taskRef є в наданих списках? Якщо ні — null / прибрати.
3. Жодного вигаданого дедлайну чи назви клієнта?
4. summary відповідає на три питання: про що, які завдання, як рухаємось?
Якщо десь «ні» — виправ.`;

const nullableString = (description: string) => ({ type: ["string", "null"], description });
const nullableInt = (description: string) => ({ type: ["integer", "null"], description });

/** Строга схема: усі поля обов'язкові, зайвих немає, nullable — явно. Ключі латиницею. */
export const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["suggestedTitle", "summary", "speakers", "keyPoints", "decisions", "tasks", "progressUpdates", "openQuestions"],
  properties: {
    suggestedTitle: { type: "string", description: "4–8 слів про суть, без слова «Нарада» і дати" },
    summary: { type: "string", description: "5–10 речень: про що, які завдання кому, як рухаємось по попередніх" },
    speakers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "guessedName", "staffRef", "role", "evidence"],
        properties: {
          label: { type: "string", description: "Літера лейбла: A, B, C" },
          guessedName: nullableString("Ім'я як прозвучало"),
          staffRef: nullableInt("N зі списку ПЕРСОНАЛ або null"),
          role: nullableString("Роль зі списку або з розмови"),
          evidence: { type: "string", description: "Цитата, з якої це видно, або чому визначити не вдалося" },
        },
      },
    },
    keyPoints: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "details",
          "assigneeRef",
          "assigneeNameHeard",
          "clientNameHeard",
          "clientHint",
          "dueDate",
          "priority",
          "evidence",
        ],
        properties: {
          title: { type: "string", description: "5–12 слів, з дієслова" },
          details: nullableString("1–3 речення: чому, що зробити, суми й умови"),
          assigneeRef: nullableInt("N зі списку ПЕРСОНАЛ або null"),
          assigneeNameHeard: nullableString("Ім'я виконавця як прозвучало"),
          clientNameHeard: nullableString("Назва клієнта дослівно як прозвучала"),
          clientHint: nullableString("Місто, вулиця чи власник клієнта, якщо звучали"),
          dueDate: nullableString("YYYY-MM-DD від дати наради або null"),
          priority: { type: "string", enum: [...TASK_PRIORITIES] },
          evidence: nullableString("Цитата до 20 слів"),
        },
      },
    },
    progressUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskRef", "status", "note"],
        properties: {
          taskRef: { type: "integer", description: "N зі списку ВІДКРИТІ ЗАДАЧІ (T<N>)" },
          status: { type: "string", enum: [...PROGRESS_STATUSES] },
          note: { type: "string", description: "Одне речення — що саме сказали" },
        },
      },
    },
    openQuestions: { type: "array", items: { type: "string" } },
  },
};

const ROLE_WORD: Record<string, string> = {
  ADMIN: "адмін",
  MANAGER: "менеджер",
  SALES: "торговий",
  DRIVER: "водій",
  WAREHOUSE: "склад",
};

const WEEKDAY = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", weekday: "long" });

function entitiesBlock(entities: MeetingEntity[]): string | null {
  if (entities.length === 0) return null;
  const byType = new Map<string, Set<string>>();
  for (const e of entities) {
    const set = byType.get(e.type) ?? new Set<string>();
    if (set.size < 30) set.add(e.text.slice(0, 80));
    byType.set(e.type, set);
  }
  return [...byType].map(([type, values]) => `${type}: ${[...values].join("; ")}`).join("\n");
}

export function buildUserPrompt(input: {
  recordedAt: Date;
  title: string;
  description: string | null;
  isTextNote: boolean;
  body: string;
  staff: StaffRef[];
  openTasks: TaskRef[];
  speakers: SpeakerHint[];
  entities: MeetingEntity[];
  compact: boolean;
}): { text: string; truncated: boolean } {
  const truncated = input.body.length > MAX_BODY_CHARS;
  const body = truncated ? `${input.body.slice(0, MAX_BODY_CHARS)}\n\n…(далі текст обрізано — він задовгий)` : input.body;

  const lines: string[] = [];
  lines.push(`ДАТА НАРАДИ: ${kyivDate(input.recordedAt)} (${WEEKDAY.format(input.recordedAt)})`);
  lines.push(`НАЗВА: ${input.title}`);
  lines.push(`КОНТЕКСТ ВІД ОРГАНІЗАТОРА: ${input.description?.trim() || "—"}`);
  lines.push("");

  lines.push("ПЕРСОНАЛ:");
  for (const s of input.staff) lines.push(`#${s.ref} ${s.name} (${ROLE_WORD[s.role] ?? s.role})`);
  if (input.staff.length === 0) lines.push("(немає)");
  lines.push("");

  lines.push("ВІДКРИТІ ЗАДАЧІ З ПОПЕРЕДНІХ НАРАД:");
  for (const t of input.openTasks) {
    lines.push(
      `T${t.ref} ${t.title} | ${t.assigneeName ?? "без виконавця"} | ${t.status}${t.dueDay ? ` | до ${t.dueDay}` : ""}`
    );
  }
  if (input.openTasks.length === 0) lines.push("(немає)");
  lines.push("");

  if (input.speakers.length > 0) {
    const known = input.speakers.map((s) =>
      s.staffRef ? `Speaker ${s.label} = #${s.staffRef} ${s.name}` : `Speaker ${s.label} = ${s.name} (у списку немає)`
    );
    lines.push(`ВПІЗНАНІ СПІКЕРИ: ${known.join("; ")}`);
    lines.push("");
  }

  const ents = entitiesBlock(input.entities);
  if (ents) {
    lines.push("ENTITIES:");
    lines.push(ents);
    lines.push("");
  }

  lines.push(input.isTextNote ? "ТЕКСТОВА НОТАТКА (спікерів немає):" : "ТРАНСКРИПТ (Speaker A/B/C, [mm:ss]):");
  lines.push(body);
  lines.push("");
  lines.push(
    "ЗАВДАННЯ: 1) speakers для кожного лейбла; 2) усі задачі з assigneeRef лише зі списку; 3) progressUpdates лише по T<N> зі списку; 4) дедлайни від дати наради; 5) самоперевірка."
  );
  if (input.compact) {
    lines.push("Попередня відповідь обірвалась: summary ≤ 6 речень, keyPoints ≤ 10, details ≤ 2 речення, evidence ≤ 12 слів.");
  }

  return { text: lines.join("\n"), truncated };
}

/* ---------- Перевірка відповіді ---------- */

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function textOrNull(v: unknown, max: number): string | null {
  const t = text(v, max);
  return t ? t : null;
}

function strings(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => text(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function dueDay(v: unknown, recordedAt: Date, warnings: string[]): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    warnings.push(`дедлайн «${s}» не дата`);
    return null;
  }
  const t = Date.parse(`${s}T12:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) {
    warnings.push(`дедлайн «${s}» не існує`);
    return null;
  }
  const base = Date.parse(`${kyivDate(recordedAt)}T12:00:00Z`);
  const days = (t - base) / 86_400_000;
  // Строк за тиждень до наради чи за рік уперед — модель помилилась з роком.
  if (days < -7 || days > 400) {
    warnings.push(`дедлайн ${s} далеко від дати наради`);
    return null;
  }
  return s;
}

export function validateStructured(
  raw: unknown,
  ctx: { staffByRef: Map<number, StaffRef>; taskByRef: Map<number, TaskRef>; recordedAt: Date }
): { structured: MeetingStructured; warnings: string[] } {
  const warnings: string[] = [];
  const o = asObj(raw);

  const staffOf = (ref: unknown, where: string): StaffRef | null => {
    if (ref === null || ref === undefined) return null;
    const n = typeof ref === "number" ? ref : Number(ref);
    const s = Number.isInteger(n) ? ctx.staffByRef.get(n) : undefined;
    if (!s) {
      warnings.push(`${where}: у списку персоналу немає #${String(ref)}`);
      return null;
    }
    return s;
  };

  const speakers: MeetingSpeaker[] = [];
  const seenLabels = new Set<string>();
  for (const item of Array.isArray(o.speakers) ? o.speakers : []) {
    const s = asObj(item);
    const label = speakerKey(text(s.label, 20));
    if (!label || seenLabels.has(label)) continue;
    seenLabels.add(label);
    const staff = staffOf(s.staffRef, `спікер ${label}`);
    speakers.push({
      label,
      guessedName: textOrNull(s.guessedName, 60) ?? staff?.name ?? null,
      userId: staff?.id ?? null,
      role: textOrNull(s.role, 40),
      evidence: text(s.evidence, 300),
    });
  }

  const tasks: MeetingTaskProposal[] = [];
  const seenTitles = new Set<string>();
  for (const item of Array.isArray(o.tasks) ? o.tasks : []) {
    const t = asObj(item);
    const title = text(t.title, 200);
    if (title.length < 3) continue;
    const key = normTitle(title);
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    const staff = staffOf(t.assigneeRef, `задача «${title}»`);
    tasks.push({
      title,
      details: textOrNull(t.details, 2000),
      assigneeUserId: staff?.id ?? null,
      assigneeNameHeard: textOrNull(t.assigneeNameHeard, 60),
      clientNameHeard: textOrNull(t.clientNameHeard, 120),
      clientHint: textOrNull(t.clientHint, 120),
      dueDate: dueDay(t.dueDate, ctx.recordedAt, warnings),
      priority: asTaskPriority(t.priority),
      evidence: textOrNull(t.evidence, 300),
    });
    if (tasks.length >= 40) break;
  }

  const progress = new Map<string, MeetingProgressUpdate>();
  for (const item of Array.isArray(o.progressUpdates) ? o.progressUpdates : []) {
    const p = asObj(item);
    const n = typeof p.taskRef === "number" ? p.taskRef : Number(p.taskRef);
    const task = Number.isInteger(n) ? ctx.taskByRef.get(n) : undefined;
    if (!task) {
      warnings.push(`хід задачі: немає T${String(p.taskRef)}`);
      continue;
    }
    const status = (PROGRESS_STATUSES as readonly string[]).includes(String(p.status))
      ? (p.status as ProgressStatus)
      : null;
    const note = text(p.note, 500);
    if (!status || !note) continue;
    progress.set(task.id, { taskId: task.id, taskTitle: task.title, status, note });
  }

  const structured: MeetingStructured = {
    suggestedTitle: text(o.suggestedTitle, 120),
    summary: typeof o.summary === "string" ? o.summary.trim().slice(0, 6000) : "",
    speakers,
    keyPoints: strings(o.keyPoints, 40, 600),
    decisions: strings(o.decisions, 40, 600),
    tasks,
    progressUpdates: [...progress.values()],
    openQuestions: strings(o.openQuestions, 40, 600),
  };

  if (!structured.summary) throw new Error("Модель не повернула підсумку");
  return { structured, warnings };
}
