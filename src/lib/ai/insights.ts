/**
 * АІ-інсайти над аналітикою торгових.
 *
 * Розвиток патерну з ask/route.ts: модель НЕ має доступу до бази й не пише
 * SQL. Спершу детерміновані запити (trends, clients, benchmark) рахують усе,
 * і лише готові числа йдуть у модель — вона їх пояснює й пріоритезує.
 *
 * Різниця з «помічником» у тому, хто ставить питання. Там питає керівник;
 * тут питати нема кому — модель мусить сама знайти, що варте уваги, і
 * назвати це людською мовою.
 *
 * Три речі, яких не було в ask/route.ts:
 *
 * 1. Структурований вивід через tool use, а не парсинг JSON-заголовка.
 *    splitFocus() у помічнику знімає ```json fence і терпить побитий JSON;
 *    тут формат гарантує сам API.
 *
 * 2. Валідація чисел на виході: кожне число в evidence звіряється з нашим
 *    зведенням, і інсайт із невідомою цифрою відкидається цілком. У
 *    помічнику наші числа підставляються лише в картки, а текст моделі
 *    ніхто не перевіряє.
 *
 * 3. Claude замість DeepSeek. Тут не переказ готових цифр, а порівняння,
 *    ранжування причин і вибір того, що справді важливе — на цьому різниця
 *    між моделями видна.
 */

import Anthropic from "@anthropic-ai/sdk";

/** Модель для інсайтів. Дешевша за Opus там, де все вже пораховано. */
const MODEL = "claude-sonnet-5";

/**
 * Стеля виводу. 4000 не вистачало: вісім інсайтів із доказами й діями — це
 * ~3.5 тис. токенів, і на портфелі в 150 клієнтів відповідь обривалася
 * посеред JSON. Обрив при tool_choice не помітний ззовні — API однаково
 * віддає tool_use блок, але з недописаним input, тож картка показувала
 * «нічого вартого уваги» там, де насправді був 31 клієнт, що збивається
 * з ритму.
 */
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 120_000;

export type InsightSeverity = "critical" | "warning" | "info" | "positive";
export type InsightUnit = "uah" | "pct" | "count" | "days";

export type InsightEvidence = {
  label: string;
  value: number;
  unit: InsightUnit;
};

export type Insight = {
  severity: InsightSeverity;
  title: string;
  detail: string;
  evidence: InsightEvidence[];
  action?: string;
};

/**
 * Схема відповіді. Передається моделі як інструмент — API гарантує, що
 * прийде саме така структура, без парсингу тексту.
 */
const REPORT_TOOL: Anthropic.Tool = {
  name: "report_insights",
  description:
    "Передати знайдені інсайти у структурованому вигляді. Викликати рівно один раз.",
  input_schema: {
    type: "object",
    properties: {
      insights: {
        type: "array",
        description:
          "Від 3 до 8 інсайтів, найважливіші першими. Порожній масив — якщо даних замало для висновків.",
        items: {
          type: "object",
          properties: {
            severity: {
              type: "string",
              enum: ["critical", "warning", "info", "positive"],
              description:
                "critical — втрачаємо гроші вже зараз; warning — тривожна тенденція; info — варте уваги; positive — те, що працює добре.",
            },
            title: {
              type: "string",
              description: "Суть одним рядком, до 80 символів, без крапки в кінці.",
            },
            detail: {
              type: "string",
              description: "1-3 речення: що саме сталося і чому це важливо.",
            },
            evidence: {
              type: "array",
              description:
                "Числа, які підтверджують інсайт. Брати ЛИШЕ з наданих даних, не рахувати самому.",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Назва показника українською" },
                  value: { type: "number", description: "Число рівно як у даних" },
                  unit: {
                    type: "string",
                    enum: ["uah", "pct", "count", "days"],
                    description: "uah — гривні, pct — відсотки, count — штуки, days — дні",
                  },
                },
                required: ["label", "value", "unit"],
              },
            },
            action: {
              type: "string",
              description: "Що конкретно зробити. Пропускати, якщо дія неочевидна з даних.",
            },
          },
          required: ["severity", "title", "detail", "evidence"],
        },
      },
    },
    required: ["insights"],
  },
};

const COMMON_RULES = `ПРАВИЛА:
1. Використовуй ЛИШЕ надані числа. Не рахуй нових і не оцінюй «приблизно».
   Кожне число в evidence має дослівно бути в даних.
2. Не вигадуй причин, яких не видно з цифр. «Оборот впав на 34%» — факт;
   «бо торговий втратив мотивацію» — домисел, так писати не можна.
3. Пиши українською, діловим тоном, без вступів на кшталт «Звичайно!».
4. Сортуй за важливістю: найдорожча проблема першою.
5. Якщо все спокійно — так і скажи, не вигадуй проблем заради кількості.

ЧОГО В ДАНИХ НЕМАЄ (не згадуй і не роби висновків про це):
- Маржа, прибуток, рентабельність: 1С не передає собівартість.
- Візити й маршрути: дані бота ще не накопичилися. Частота роботи з
  клієнтом визначається за документами, а не за візитами.
- Плани продажів: сітка ще не заповнена.
- Динаміка боргу: щоденні зрізи почалися нещодавно, порівнювати нема з чим.
- Безготівкові оплати: в обмін потрапляє лише каса (ПКО).`;

const REP_PROMPT = `Ти аналітик відділу продажів будівельної компанії Budvik.

Тобі дають готові цифри по ОДНОМУ торговому представнику: динаміку обороту
за тижнями й місяцями, порівняння останніх 4 тижнів із попередніми 4,
портфель клієнтів за станами і дебіторку.

Твоя робота — знайти те, на що керівнику варто звернути увагу в розмові з
цим торговим: де почав втрачати темп, яких клієнтів розпрацював, кого
втрачає, що робить добре.

Стани клієнтів означають:
- NEW — перше замовлення в межах періоду;
- ACTIVE — беруть у своєму звичному ритмі;
- SLIPPING — мовчать помітно довше, ніж зазвичай для цього клієнта;
- DORMANT — 60+ днів без замовлення;
- LOST — 90+ днів без замовлення, при тому що раніше брали регулярно.

${COMMON_RULES}`;

const TEAM_PROMPT = `Ти аналітик відділу продажів будівельної компанії Budvik.

Тобі дають готові цифри по ВСІЙ команді торгових: показники кожного,
перцентилі по команді, медіани й матрицю «бренд × торговий».

Перцентиль — місце людини серед колег за цією метрикою: 100 означає
найкращий у команді, 0 — найгірший. Для простроченої дебіторки й втрачених
клієнтів шкала перевернута: високий перцентиль означає, що показник добрий
(тобто борг малий).

Твоя робота — дати керівникові повну картину: хто витягує команду, хто
провисає і в чому саме, кого куди підтягувати. Порожня клітинка в матриці
брендів — торговий не продав жодної одиниці бренду, який возять інші.

Важливо: не роби висновків з абсолютних чисел без огляду на перцентиль.
Оборот 900 тис. може бути і найкращим, і найгіршим у команді.

${COMMON_RULES}`;

export type InsightKind = "rep" | "team";

export type GenerateResult = {
  insights: Insight[];
  model: string;
  tokens: number;
  /** Скільки інсайтів відкинула валідація чисел */
  rejected: number;
};

/** Числа з зведення, з якими звіряються evidence. */
function collectNumbers(value: unknown, out: Set<number>, depth = 0): void {
  if (depth > 12) return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectNumbers(item, out, depth + 1);
  }
}

/**
 * Чи є таке число в зведенні.
 *
 * Порівняння з допуском, а не точне: у зведення числа йдуть округленими до
 * читабельного вигляду, і модель цілком законно пише «3 404 559» там, де в
 * JSON лежить 3404559.42. Допуск відносний, бо абсолютна похибка в 1 грн
 * і в 1% — це різні речі на сумі 3 млн і на сумі 12.
 */
function isKnownNumber(value: number, known: Set<number>): boolean {
  if (!Number.isFinite(value)) return false;
  if (known.has(value)) return true;

  const rounded = Math.round(value);
  for (const candidate of known) {
    if (Math.round(candidate) === rounded) return true;
    const scale = Math.max(Math.abs(candidate), Math.abs(value), 1);
    if (Math.abs(candidate - value) / scale < 0.01) return true;
  }
  return false;
}

/**
 * Відкидає інсайти з числами, яких немає в зведенні.
 *
 * Це головний запобіжник проти вигаданих цифр. У ask/route.ts числа
 * підставлялися лише в картки, а текст моделі не перевірявся — тут інсайт
 * із чужим числом не виживає цілком, разом із текстом.
 *
 * Нуль пропускаємо завжди: «жодного нового клієнта» — це відсутність
 * числа, а не число, і вимагати його присутності у зведенні безглуздо.
 */
function validate(insights: Insight[], facts: unknown): { kept: Insight[]; rejected: number } {
  const known = new Set<number>();
  collectNumbers(facts, known);

  const kept: Insight[] = [];
  let rejected = 0;

  for (const insight of insights) {
    const evidence = Array.isArray(insight.evidence) ? insight.evidence : [];
    const bad = evidence.find((e) => e.value !== 0 && !isKnownNumber(e.value, known));

    if (bad) {
      console.warn(
        `insights: відкинуто «${insight.title}» — числа ${bad.value} (${bad.label}) немає в даних`
      );
      rejected += 1;
      continue;
    }
    kept.push({ ...insight, evidence });
  }

  return { kept, rejected };
}

/**
 * Дістає масив інсайтів із того, що реально прийшло в полі `insights`.
 *
 * Зазвичай там масив. Але приблизно в одному випадку з трьох модель
 * загортає всю відповідь у рядок і кладе його в те саме поле — тобто
 * `insights` дорівнює `'{"insights":[...]}'`. Схема інструмента це
 * пропускає, бо рядок теж валідне значення до перевірки типу.
 *
 * Спершу код просто питав `Array.isArray` — і така відповідь мовчки
 * ставала порожнім списком. На картці це виглядало як «нічого вартого
 * уваги» у торгового, в якого 31 клієнт збивався з ритму: найгірший
 * можливий спосіб помилитися, бо керівник вірить, що все спокійно.
 *
 * Повертає null, якщо дістати масив не вдалося — викликач кидає помилку,
 * і користувач бачить, що аналіз не вдався, замість вигаданого спокою.
 */
function extractInsights(raw: unknown): Insight[] | null {
  if (Array.isArray(raw)) return raw as Insight[];

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as Insight[];
      // Подвійне загортання: рядок містить увесь об'єкт відповіді.
      const inner = (parsed as { insights?: unknown })?.insights;
      if (Array.isArray(inner)) return inner as Insight[];
    } catch {
      // Не JSON — нижче повернемо null.
    }
  }

  // Об'єкт замість масиву: {insights: [...]} у полі insights.
  if (raw && typeof raw === "object") {
    const inner = (raw as { insights?: unknown }).insights;
    if (Array.isArray(inner)) return inner as Insight[];
  }

  return null;
}

/** Чи налаштований ключ. Роут віддає 503 із зрозумілим текстом, а не падає. */
export function insightsConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Генерує інсайти з готового зведення.
 *
 * `facts` — те саме, що потім покажеться на картці: модель не має доступу
 * ні до чого іншого, і всі числа в evidence звіряються саме з ним.
 */
export async function generateInsights(input: {
  kind: InsightKind;
  facts: unknown;
  scopeNote: string;
}): Promise<GenerateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Бракує ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: input.kind === "rep" ? REP_PROMPT : TEAM_PROMPT,
    tools: [REPORT_TOOL],
    // Змушуємо викликати інструмент: без цього модель іноді відповідає
    // текстом, і структурованого виводу немає.
    tool_choice: { type: "tool", name: "report_insights" },
    messages: [
      {
        role: "user",
        content: `${input.scopeNote}\n\nДАНІ:\n${JSON.stringify(input.facts, null, 1)}`,
      },
    ],
  });

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Модель не повернула структурованої відповіді");
  }

  // Обрив по max_tokens треба ловити ДО читання input. При tool_choice API
  // однаково віддає tool_use блок, але з недописаним JSON — insights у
  // ньому просто немає, і без цієї перевірки збій мовчки перетворювався б
  // на «нічого вартого уваги».
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "Модель не вклалася в ліміт відповіді — інсайти обірвалися на півслові. Спробуйте ще раз або звузьте період."
    );
  }

  const list = extractInsights((block.input as { insights?: unknown }).insights);
  if (!list) {
    throw new Error(
      `Модель повернула відповідь без списку інсайтів (stop_reason: ${message.stop_reason ?? "невідомо"})`
    );
  }

  const { kept, rejected } = validate(list, input.facts);

  return {
    insights: kept,
    model: MODEL,
    tokens: message.usage.input_tokens + message.usage.output_tokens,
    rejected,
  };
}
