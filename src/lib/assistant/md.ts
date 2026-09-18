/* ── Оформлення відповіді ─────────────────────────────────────────────────
 *
 * Спільний набір на всі види помічника. Винесено з answers.ts, коли
 * з'явився помічник керівника: два файли з відповідями мусять оформлювати
 * однаково, інакше в одній розмові зустрінуться дві різні таблиці й два
 * різні світлофори.
 *
 * Одне оформлення на всі відповіді: заголовок зі знаком, таблиця там, де
 * числа порівнюються, світлофор замість слів «добре / погано» і рядок
 * підказок унизу. Це не прикраса: відповідь читають із телефона однією
 * рукою, і однакова форма означає, що потрібне число завжди в тому самому
 * місці.
 *
 * ЧОГО НЕ РОБИМО ТАБЛИЦЕЮ — списків клієнтів. Пункт, який починається з
 * посилання на картку, кабінет малює як тапабельний рядок із шевроном
 * (див. AssistantMarkdown). Усередині таблиці цей рядок зникає, і замість
 * «натиснув і поїхав» виходить «прочитав і шукай руками».
 */

import { block, type ChartSpec, type KpiSpec } from "@/lib/assistant/blocks";

/**
 * Збірка відповіді з рядків.
 *
 * Порожній рядок у маркдауні — це роздільник абзаців, тож викидати його
 * не можна (інакше таблиця злипнеться із заголовком). А два поспіль уже
 * зайві, і саме вони з'являються там, де секція не заповнилася.
 */
export function md(lines: Array<string | null | undefined>): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line == null) continue;
    if (line === "" && out[out.length - 1] === "") continue;
    out.push(line);
  }
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** Клітинка таблиці: вертикальна риска в назві зламала б розмітку. */
export const cell = (value: string | number) => String(value).replace(/\|/g, "/");

/** Таблиця GFM. Заголовки короткі: ширина екрана — 360 точок. */
export function table(headers: string[], rows: Array<Array<string | number>>): string[] {
  if (rows.length === 0) return [];
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ];
}

/**
 * Довгу назву в таблиці ріжемо: інакше рядок їде за край екрана.
 *
 * Обрізати ГОТОВЕ ПОСИЛАННЯ цим не можна — розмітка зламається на півдорозі
 * («[Ім'я](/admin/sales-reps/cmnj…»). Скорочувати треба назву, а вже потім
 * загортати її в посилання.
 *
 * Пробіли по краях знімаємо тут: у 1С трапляються імена з хвостовим
 * пробілом, і в таблиці це видно як «Олександр  |».
 */
export const short = (name: string, max = 38) => {
  const value = name.trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};

/** Світлофор: зелений — добре, жовтий — середньо, червоний — погано. */
export const light = (state: "good" | "mid" | "bad") =>
  state === "good" ? "🟢" : state === "mid" ? "🟡" : "🔴";

/** Знак платника — той самий скрізь, де показуємо вердикт. */
export const payerIcon = (verdict: string | null | undefined) =>
  !verdict
    ? "⚪"
    : /надійн/i.test(verdict)
      ? "🟢"
      : /помірн/i.test(verdict)
        ? "🟡"
        : /ризиков/i.test(verdict)
          ? "🟠"
          : "🔴";

/** Стрілка динаміки. */
export const arrow = (value: number | null): string =>
  value == null ? "" : value > 0 ? "📈" : value < 0 ? "📉" : "➖";

/**
 * Уточнення завжди лишає двері відчиненими.
 *
 * Кнопки покривають типові випадки, але не всі: період буває «з 3 по 17»,
 * бренд — написаний по-своєму, а питання — узагалі про інше. Рядок нижче
 * прямо каже, що можна відповісти словами, інакше людина вважає, що вибір
 * обмежений трьома кнопками.
 */
export const OWN_ANSWER_HINT = "_Тапніть варіант або напишіть свій — я зрозумію._";

/**
 * Позначка уточнення на початку репліки.
 *
 * За нею цикл ходу впізнає, що попередня відповідь була питанням, і НЕ дає
 * коду перехопити відповідь людини: «знижку 5 % для Кунанця» після уточнення
 * про знижку код прочитав би як «звіт про знижки за місяць» і відповів би не
 * на те. Той самий знак ставить і модель (див. промпт керівника).
 */
export const CLARIFY_MARK = "## 🙋";

export const isClarification = (markdown: string) => markdown.trimStart().startsWith(CLARIFY_MARK);

/**
 * Питання-уточнення з кнопками: заголовок, питання, варіанти, підказка.
 *
 * Одна форма на всі уточнення (однофамільці, бренд, день, період), щоб
 * людина впізнавала їх з першого погляду.
 */
export function clarify(input: { title: string; question?: string; options: string[]; note?: string }): string {
  return md([
    `${CLARIFY_MARK} ${input.title}`,
    "",
    input.question ?? null,
    input.note ?? null,
    "",
    followUps(...input.options),
    OWN_ANSWER_HINT,
  ]);
}

/** Рядок підказок під відповіддю: у кабінеті це тапабельні кнопки. */
export function followUps(...questions: Array<string | null>): string {
  const list = questions.filter((q): q is string => Boolean(q));
  return list.length ? `> 💬 ${list.join(" · ")}` : "";
}

/**
 * Смужка виконання з десяти квадратів.
 *
 * Кольором тут працює сам символ: у маркдауні кольору немає, а квадрат є
 * скрізь — і в застосунку, і в браузері. Порогів три, щоб «майже план» і
 * «провал» не виглядали однаково.
 */
export function bar(percentValue: number | null): string {
  if (percentValue == null) return "";
  const filled = Math.max(0, Math.min(10, Math.round(percentValue / 10)));
  const block = percentValue >= 100 ? "🟩" : percentValue >= 90 ? "🟨" : "🟥";
  return block.repeat(filled) + "⬜".repeat(10 - filled);
}

/**
 * Плитки й діаграма — ті самі блоки, що пише модель (див. blocks.ts).
 *
 * Кодові відповіді мусять виглядати так само, як відповіді моделі: в одній
 * розмові зустрічаються обидві, і різна подача однакових чисел збиває.
 */
export function kpi(items: KpiSpec["items"]): string {
  const list = items.filter((i) => i.value !== "");
  return list.length ? block("kpi", { items: list.slice(0, 4) }) : "";
}

export function chart(spec: Partial<ChartSpec> & Pick<ChartSpec, "type" | "title" | "unit">): string {
  if (spec.type === "scatter" ? (spec.points?.length ?? 0) < 2 : (spec.categories?.length ?? 0) < 2) return "";
  return block("chart", spec);
}

const MONTHS_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

/** «2026-04» → «кві 26»: підпис стовпчика має вміститися в 40 точок. */
export function monthShort(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  return `${MONTHS_SHORT[Number(m[2]) - 1] ?? m[2]} ${m[1].slice(2)}`;
}

/** Сума для плитки: «7,7 млн ₴», «846 тис ₴», «12 300 ₴». */
export function moneyShort(value: number): string {
  const a = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(1).replace(".", ",")} млн ₴`;
  if (a >= 100_000) return `${sign}${Math.round(a / 1000)} тис ₴`;
  return `${sign}${Math.round(a).toLocaleString("uk-UA")} ₴`;
}

/** Медаль за місце. Далі третього — просто число, інакше медалі знецінюються. */
export const MEDALS = ["🥇", "🥈", "🥉"];

/** Скільки клієнтів у плані дня. Більше в голові за один виїзд не тримають. */
export const PLAN_LIMIT = 10;
/** Для скількох перших клієнтів плану добираємо гачок. */
export const PLAN_HOOKS = 6;

/**
 * Код шукав і не знайшов.
 *
 * Це не відповідь, а промах: «такого товару немає» на питання про оборот
 * торгового — найгірше, що може статися, бо людина бачить упевнену
 * відповідь не на своє питання й перестає питати. Тому промах не
 * показуємо, а віддаємо хід моделі разом із тим, що вже перевірено.
 */
export type DirectMiss = { searched: string; among: string };

export type DirectAnswer = {
  markdown: string;
  /** Що саме подивилися — той самий слід, що й у ходу через модель. */
  tools: Array<{ name: string; label: string; ms: number }>;
  /** Є — відповідь не показуємо, питання йде моделі з підказкою. */
  miss?: DirectMiss;
};

type Timed = { label: string; name: string };

export async function timed<T>(meta: Timed, job: () => Promise<T>, into: DirectAnswer["tools"]): Promise<T> {
  const started = Date.now();
  const value = await job();
  into.push({ ...meta, ms: Date.now() - started });
  return value;
}
