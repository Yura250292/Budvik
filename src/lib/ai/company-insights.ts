/**
 * АІ-аналіз фірми: чотири секції поверх готових фактів.
 *
 * Розвиток insights.ts на весь бізнес, із тими самими правилами: модель не
 * бачить бази, всі числа рахують детерміновані модулі, кожне число з
 * evidence звіряється з фактами (спільна validate()).
 *
 * Одне доповнення, якого не було в інсайтах по торговому. Тут модель не
 * просто пояснює цифри — вона складає ІМЕННІ списки: кому дзвонити, що
 * просувати, на кого з водіїв дивитися. Щоб жоден клієнт не був вигаданим,
 * сутності передаються ТІЛЬКИ ідентифікаторами з фактів, і після відповіді
 * кожен id звіряється з набором, витягнутим із того самого блобу. Назви й
 * цифри інтерфейс бере з фактів, а не з тексту моделі: модель вирішує, кого
 * поставити першим і як це пояснити, але не те, як людину звати.
 *
 * ВАЖЛИВО про правила: COMMON_RULES з insights.ts сюди НЕ копіюється. Там
 * є блок «маржі немає, 1С не передає собівартість» — він застарів
 * (собівартість тепер приходить, див. SalesDocumentItem.purchasePrice), і
 * саме на маржі стоїть половина цього аналізу. Кожна секція має власний
 * чесний перелік обмежень.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  collectNumbers,
  isKnownNumber,
  type Insight,
  type InsightEvidence,
} from "@/lib/ai/insights";

const MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 300_000;

/**
 * Стелі виводу по секціях.
 *
 * «Торгові» найдорожчі: 11 блоків із сильними/слабкими сторонами і чеклістом
 * дій на кожного — це вчетверо більше за звіт по одному торговому, звідки й
 * 16 тис. проти 8. Обрив по max_tokens ловиться нижче явно: при tool_choice
 * API однаково віддає tool_use, але з недописаним JSON, і без перевірки збій
 * виглядав би як «все спокійно».
 */
const MAX_TOKENS: Record<CompanySection, number> = {
  reps: 16_000,
  products: 8_000,
  logistics: 8_000,
  strategy: 6_000,
};

export type CompanySection = "reps" | "products" | "logistics" | "strategy";

export type ActionKind =
  | "COLLECT_DEBT"
  | "CHURN_RISK"
  | "REACTIVATE"
  | "DEVELOP"
  | "OFFER_BONUS";

/**
 * Ключі payload — латиницею.
 *
 * Anthropic вимагає, щоб імена властивостей у схемі інструмента збігалися з
 * `^[a-zA-Z0-9_.-]{1,64}$`: кирилиця в ключах повертає 400 ще до генерації.
 * Тому структура англомовна, а вся українська мова живе в описах полів і в
 * значеннях. Факти при цьому лишаються з українськими ключами — їх модель
 * тільки читає, і там обмеження не діє.
 */
export type RepBlock = {
  repId: string;
  strengths: string[];
  weaknesses: string[];
  insights: Insight[];
  actions: Array<{
    clientId: string;
    kind: ActionKind;
    priority: number;
    comment: string;
    evidence?: InsightEvidence[];
  }>;
};

export type RepsPayload = { team: Insight[]; reps: RepBlock[] };

export type ProductsPayload = {
  insights: Insight[];
  promote: Array<{ id: string; kind: "brand" | "product"; why: string }>;
  illiquid: Array<{
    id: string;
    action: "DISCOUNT" | "RETURN_TO_SUPPLIER" | "STOP_REORDER" | "WATCH";
    /** Глибина знижки для акції, % — лише при action = DISCOUNT */
    discountPct?: number;
    comment: string;
  }>;
};

export type LogisticsPayload = {
  overall: Insight[];
  drivers: Array<{ driverId: string; insights: Insight[]; watch: string[] }>;
};

export type StrategyPayload = {
  summary: string;
  priorities: Array<{
    title: string;
    detail: string;
    area: "reps" | "products" | "logistics" | "finance";
    evidence?: InsightEvidence[];
  }>;
  people: Array<{ personId: string; role: "rep" | "driver"; focus: string }>;
};

export type CompanyPayload =
  | RepsPayload
  | ProductsPayload
  | LogisticsPayload
  | StrategyPayload;

// ─────────────────────────── Схеми інструментів ───────────────────────────

const EVIDENCE_SCHEMA = {
  type: "array",
  description:
    "Числа, які підтверджують висновок. Брати ЛИШЕ з наданих даних, не рахувати самому і не сумувати.",
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
} as const;

function insightSchema(description: string, sources?: string[]) {
  return {
    type: "object",
    description,
    properties: {
      severity: {
        type: "string",
        enum: ["critical", "warning", "watch", "info", "positive"],
        description:
          "critical — втрачаємо гроші вже зараз; warning — негативна тенденція, підтверджена цифрами; watch — поки в межах норми, тримати на оці; info — варте уваги без оцінки; positive — те, що працює добре.",
      },
      title: { type: "string", description: "Суть одним рядком, до 80 символів, без крапки." },
      detail: { type: "string", description: "1–3 речення: що сталося і чому це важливо." },
      period: {
        type: "string",
        description:
          "Який період описано. Дати копіювати ДОСЛІВНО з даних. Якщо цифра «станом на зараз» — так і написати.",
      },
      ...(sources
        ? {
            source: {
              type: "string",
              enum: sources,
              description: "Блок даних, з якого взяті числа.",
            },
          }
        : {}),
      evidence: EVIDENCE_SCHEMA,
      action: { type: "string", description: "Що конкретно зробити." },
    },
    required: ["severity", "title", "detail", "period", "evidence"],
  };
}

const TOOLS: Record<CompanySection, Anthropic.Tool> = {
  reps: {
    name: "report_company_reps",
    description: "Передати аналіз роботи торгових. Викликати рівно один раз.",
    input_schema: {
      type: "object",
      properties: {
        team: {
          type: "array",
          description: "2–4 висновки про команду загалом, найважливіші першими.",
          items: insightSchema("Висновок про команду"),
        },
        reps: {
          type: "array",
          description:
            "Блок на КОЖНОГО торгового з даних. Не пропускати нікого і не додавати відсутніх.",
          items: {
            type: "object",
            properties: {
              repId: {
                type: "string",
                description: "Ідентифікатор торгового, скопійований ДОСЛІВНО з поля repId у даних.",
              },
              strengths: {
                type: "array",
                description:
                  "Сильні сторони, до 3. Кожна — короткий рядок українською з опертям на цифру.",
                items: { type: "string" },
              },
              weaknesses: {
                type: "array",
                description:
                  "Слабкі сторони, до 3, українською. Якщо їх немає — порожній масив.",
                items: { type: "string" },
              },
              insights: {
                type: "array",
                description: "До 3 висновків саме про цю людину.",
                items: insightSchema("Висновок про торгового"),
              },
              actions: {
                type: "array",
                description:
                  "До 8 клієнтів із наданого списку кандидатів, упорядкованих за важливістю. Це РАНЖУВАННЯ готового списку: клієнтів, яких немає в кандидатах, додавати НЕ МОЖНА.",
                items: {
                  type: "object",
                  properties: {
                    clientId: {
                      type: "string",
                      description:
                        "Ідентифікатор клієнта, скопійований ДОСЛІВНО з поля clientId кандидата.",
                    },
                    kind: {
                      type: "string",
                      enum: [
                        "COLLECT_DEBT",
                        "CHURN_RISK",
                        "REACTIVATE",
                        "DEVELOP",
                        "OFFER_BONUS",
                      ],
                      description: "Той самий тип, що в кандидата.",
                    },
                    priority: {
                      type: "number",
                      description: "1 — сьогодні, 2 — цього тижня, 3 — коли буде час.",
                    },
                    comment: {
                      type: "string",
                      description:
                        "Українською: що сказати клієнту або з чого почати розмову. Одне-два речення, конкретно.",
                    },
                    evidence: EVIDENCE_SCHEMA,
                  },
                  required: ["clientId", "kind", "priority", "comment"],
                },
              },
            },
            required: ["repId", "strengths", "weaknesses", "insights", "actions"],
          },
        },
      },
      required: ["team", "reps"],
    },
  },

  products: {
    name: "report_company_products",
    description: "Передати аналіз товарів і складу. Викликати рівно один раз.",
    input_schema: {
      type: "object",
      properties: {
        insights: {
          type: "array",
          description: "3–7 висновків про рентабельність, асортимент і склад.",
          items: insightSchema("Висновок про товари", [
            "brands",
            "abc",
            "turnover",
            "lowstock",
          ]),
        },
        promote: {
          type: "array",
          description:
            "До 8 брендів або товарів, які варто продавати активніше. id копіювати ДОСЛІВНО з даних.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "id бренду або товару з даних" },
              kind: { type: "string", enum: ["brand", "product"] },
              why: {
                type: "string",
                description: "Одне речення українською з опертям на цифру з даних.",
              },
            },
            required: ["id", "kind", "why"],
          },
        },
        illiquid: {
          type: "array",
          description:
            "До 10 позицій зі списку найгірших, із рішенням по кожній. Це гроші, заморожені на складі — головне питання тут «як їх витягти», а не «як це назвати».",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "id товару або бренду з даних" },
              action: {
                type: "string",
                enum: ["DISCOUNT", "RETURN_TO_SUPPLIER", "STOP_REORDER", "WATCH"],
                description:
                  "DISCOUNT — акція, розпродати зі знижкою (основний вибір для того, що лежить довго); RETURN_TO_SUPPLIER — повернути постачальнику, якщо позиція не продавалася ЖОДНОГО разу; STOP_REORDER — не дозамовляти, залишок розійдеться сам; WATCH — поки спостерігати.",
              },
              discountPct: {
                type: "number",
                description:
                  "Глибина знижки у відсотках для акції: 10, 25 або 40 — рівно ті, для яких у даних пораховано повернення. Заповнювати лише при action = DISCOUNT.",
              },
              comment: {
                type: "string",
                description:
                  "Українською, одне-два речення: чому саме така дія і скільки грошей вона поверне. Суму брати з блоку «повернемо_зі_знижкою» відповідної позиції.",
              },
            },
            required: ["id", "action", "comment"],
          },
        },
      },
      required: ["insights", "promote", "illiquid"],
    },
  },

  logistics: {
    name: "report_company_logistics",
    description: "Передати аналіз роботи водіїв і маршрутних листів. Викликати рівно один раз.",
    input_schema: {
      type: "object",
      properties: {
        overall: {
          type: "array",
          description: "2–5 висновків про логістику загалом.",
          items: insightSchema("Висновок про логістику"),
        },
        drivers: {
          type: "array",
          description: "Блок на кожного водія з даних.",
          items: {
            type: "object",
            properties: {
              driverId: {
                type: "string",
                description: "Ідентифікатор водія, скопійований ДОСЛІВНО з поля driverId.",
              },
              insights: {
                type: "array",
                description: "До 3 висновків про цього водія.",
                items: insightSchema("Висновок про водія"),
              },
              watch: {
                type: "array",
                description: "До 3 коротких пунктів українською «на що подивитися».",
                items: { type: "string" },
              },
            },
            required: ["driverId", "insights", "watch"],
          },
        },
      },
      required: ["overall", "drivers"],
    },
  },

  strategy: {
    name: "report_company_strategy",
    description: "Передати стратегічний підсумок по фірмі. Викликати рівно один раз.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "5–8 речень українською для власника: у якому стані фірма за цей період і що визначає найближчі рішення.",
        },
        priorities: {
          type: "array",
          description: "3–6 пріоритетів, найважливіший першим.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Коротко українською, до 60 символів." },
              detail: {
                type: "string",
                description: "2–4 речення українською: що робити і який ефект.",
              },
              area: {
                type: "string",
                enum: ["reps", "products", "logistics", "finance"],
              },
              evidence: EVIDENCE_SCHEMA,
            },
            required: ["title", "detail", "area"],
          },
        },
        people: {
          type: "array",
          description:
            "Фокус по кожній людині з блоку «люди». personId копіювати ДОСЛІВНО з даних.",
          items: {
            type: "object",
            properties: {
              personId: { type: "string", description: "personId з даних" },
              role: { type: "string", enum: ["rep", "driver"] },
              focus: {
                type: "string",
                description:
                  "Одне-два речення українською: над чим працювати з цією людиною найближчий місяць.",
              },
            },
            required: ["personId", "role", "focus"],
          },
        },
      },
      required: ["summary", "priorities", "people"],
    },
  },
};

// ──────────────────────────────── Промпти ────────────────────────────────

const BASE_RULES = `ПРАВИЛА:
1. Використовуй ЛИШЕ надані числа. Не рахуй нових, не сумуй, не оцінюй
   «приблизно». Кожне число в evidence має дослівно бути в даних — інакше
   висновок буде відкинутий цілком.
2. Не вигадуй причин, яких не видно з цифр. «Маржа впала до 9%» — факт;
   «бо давав знижки друзям» — домисел.
3. Ідентифікатори (repId, clientId, driverId, id, personId) копіюй ДОСЛІВНО
   з даних. Не вигадуй і не скорочуй їх. Рядок із невідомим ідентифікатором
   буде відкинутий.
4. Пиши українською, діловим тоном, без вступів на кшталт «Звичайно!».
5. Сортуй за важливістю: найдорожча проблема першою.
6. Якщо все спокійно — так і скажи, не вигадуй проблем заради кількості.
7. У полі period копіюй дати з даних або пиши «станом на зараз», якщо
   показник саме такий.

ЯК ЧИТАТИ ЧАС. У даних три різні вікна, і плутати їх не можна:
оборот, вал і темп — ПОТІК за обраний період; виконання плану — за
КАЛЕНДАРНИЙ МІСЯЦЬ; борги, залишки й оборотність складу — СТАНОМ НА ЗАРАЗ.
Розбіжність між ними не є суперечністю.`;

const PROMPTS: Record<CompanySection, string> = {
  reps: `Ти комерційний директор будівельної компанії Budvik.

Тобі дають готові цифри по кожному торговому: оборот, вал і рентабельність,
темп, портфель клієнтів за станами, дебіторку зі старінням, виконання плану
і ГОТОВИЙ список кандидатів на дію по клієнтах.

Твоя робота — скласти власнику картину по КОЖНІЙ людині: у чому вона
сильна, де провисає, і кому з її клієнтів дзвонити першими.

Стани клієнтів: NEW — перше замовлення в періоді; ACTIVE — беруть у
звичному ритмі; SLIPPING — мовчать помітно довше, ніж зазвичай саме для
цього клієнта; DORMANT — 60+ днів без замовлення; LOST — 90+ днів.

Типи дій: COLLECT_DEBT — забрати прострочений борг; CHURN_RISK — утримати,
поки не пішов; REACTIVATE — повернути того, хто вже мовчить; DEVELOP —
розширити асортимент у того, хто бере багато, але вузько; OFFER_BONUS —
закріпити лояльного, поки його не переманили.

Список кандидатів уже порахований правилами. Твоя робота — впорядкувати
його за важливістю і сказати, з чого почати розмову. ДОДАВАТИ клієнтів,
яких немає в кандидатах, не можна.

ПРО РЕНТАБЕЛЬНІСТЬ. Вал порахований лише по документах, де відома
собівартість. Поруч завжди є покриття_собівартістю_відсотків — якщо воно
низьке, рентабельність описує лише частину обороту, і це треба казати
вголос, а не подавати як показник по всьому обороту.

ЧОГО В ДАНИХ НЕМАЄ: причин повернень, змісту розмов із клієнтами, причин
відмов. Констатуй факти, не пояснюй мотиви людей.

${BASE_RULES}`,

  products: `Ти комерційний директор будівельної компанії Budvik.

Тобі дають рентабельність по брендах і товарах, ABC/XYZ, стан складу
(оборотність, неліквід за давністю) і дефіцит за швидкістю продажів.

Твоя робота — сказати власнику, що вигідно продавати, що лежить мертвим
вантажем і що робити з кожною групою.

ABC: A — 80% обороту, B — до 95%, C — решта. XYZ — стабільність продажів
по місяцях: X стабільні, Z рвані. Товар може бути A за оборотом і C за
прибутком — саме такі випадки найцінніші для розмови.

ПРО ЦИФРИ СКЛАДУ. Оцінка запасу ЗМІШАНА: собівартість там, де відома,
інакше ціна продажу — тобто загальна вартість завищена на маржу тієї
частини. Якщо називаєш вартість запасу, згадуй це. Рентабельність бренду
рахується з рядків документів, тому знижка з шапки в неї не потрапляє, і
вона трохи оптимістичніша за рентабельність компанії.

МЕРТВИЙ ТОВАР — ЦЕ ЗАМОРОЖЕНІ ГРОШІ. Позиція, що лежить рік без жодного
продажу, не «чекає покупця»: вона тримає гроші, за які можна було б завезти
те, що продається. Тому для таких позицій дія DISCOUNT — головна, і в
коментарі кажи КОНКРЕТНО: яку глибину знижки пропонуєш і скільки грошей це
поверне. Цифри бери з блоку «повернемо_зі_знижкою» — там уже пораховано для
10%, 25% і 40%, рахувати самому не треба.

Орієнтир глибини: лежить понад рік або жодного продажу — 25–40%, бо м'яка
знижка його не зрушить; 180–365 днів — 10–25%; 90–180 днів — спершу WATCH
або 10%, товар ще може піти сам. Дорогі позиції з великою сумою важливіші
за дешеві: одна така вивільняє більше, ніж десяток дрібних.

RETURN_TO_SUPPLIER став на місце знижки лише тоді, коли позиція ніколи не
продавалася — тобто це помилка закупівлі, а не повільний товар.

Групування по БРЕНДАХ, а не категоріях — категорії в 1С не заповнені.

ЧОГО В ДАНИХ НЕМАЄ: постачальників, строків поставки, закупівельних умов,
сезонності. Не будуй планів закупівлі, які цього потребують.

${BASE_RULES}`,

  logistics: `Ти операційний директор будівельної компанії Budvik.

Тобі дають ефективність кожного водія за маршрутними листами: пробіг проти
плану, точки вигрузки, зарплату, привезений оборот, інкасацію й аномалії
одометра.

Твоя робота — сказати власнику, де логістика працює нормально, а де
цифри не сходяться і варто розібратися.

ЯК УЛАШТОВАНА ОПЛАТА: ставка за пробіг нараховується ЗА КОЖЕН ЛИСТ (два
виїзди за день — дві ставки), плюс за кожну унікальну адресу вигрузки
(місто дорожче за область), плюс відсоток від суми в листі за мінусом
боргів, які водій забирає.

ДВІ ЦИФРИ ІНКАСАЦІЇ НЕ СУМУЮТЬСЯ: «за_відмітками» — те, що водій відмітив
на планшеті; «борги_з_листів» — база, віднята з обороту в зарплаті. Для
маршрутів сайту друга виводиться з першої, тож їх сума була б подвійним
рахунком.

ПРО АНОМАЛІЇ. Одометр до GPS у нормі 1,2–1,6: GPS-трек іде по прямій, а
дорога довша. Сильно більше означає, що кілометри є, а треку до них немає.
Це привід подивитися, а НЕ доказ обману — причин у даних немає, і
звинувачувати людину не можна. Дивись також на покриття: якщо порівняння
є лише для двох змін із двадцяти, висновок про водія робити зарано.

${BASE_RULES}`,

  strategy: `Ти радник власника будівельної компанії Budvik.

Тобі дають витримку з уже готових і перевірених розділів аналізу —
торгові, товари, логістика — за той самий період, плюс зведення по
компанії і список людей.

Твоя робота — звести це в 3–6 пріоритетів для власника і сказати, над чим
працювати з КОЖНОЮ людиною найближчий місяць. Це не переказ розділів:
цінність саме в тому, щоб побачити зв'язки між ними — наприклад, коли
низька маржа в одного торгового збігається з брендом, що лежить на складі.

Нових цифр не вводь: усі числа беруться з наданої витримки.

${BASE_RULES}`,
};

// ──────────────────────────────── Валідація ────────────────────────────────

/** Ключі, значення яких є ідентифікаторами сутностей. */
const ID_KEYS = /^(repId|clientId|driverId|personId|counterpartyId|id)$/;

/** Усі ідентифікатори, що зустрічаються у фактах. */
function collectIds(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 12 || !value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && ID_KEYS.test(key)) out.add(item);
    else collectIds(item, out, depth + 1);
  }
}

type Rejection = { kept: unknown; rejected: number };

/**
 * Чистить payload секції.
 *
 * Два різні запобіжники, і обидва потрібні:
 *   числа — щоб модель не приписала компанії суму, якої ніхто не рахував;
 *   ідентифікатори — щоб у чеклісті не з'явився клієнт, якого не існує.
 *
 * Викидається рівно та одиниця, що зіпсована: інсайт із чужим числом,
 * рядок дії з чужим id, блок людини з чужим repId. Валити весь звіт через
 * один поганий рядок було б гірше — решта висновків нормальні.
 */
export function validateCompanyPayload(
  section: CompanySection,
  payload: unknown,
  facts: unknown
): Rejection {
  const numbers = new Set<number>();
  collectNumbers(facts, numbers);
  const ids = new Set<string>();
  collectIds(facts, ids);

  let rejected = 0;

  /**
   * Масив із того, що реально прийшло.
   *
   * Приблизно в одному випадку з трьох модель загортає масив у РЯДОК із
   * JSON — схема це пропускає, бо рядок теж валідне значення до перевірки
   * типу. `extractInsights` в insights.ts ловить те саме для інсайтів, і без
   * такого ж розбору тут увесь звіт по 9 торгових мовчки ставав порожнім при
   * rejected = 0: найгірший спосіб помилитися, бо керівник бачить «нічого
   * вартого уваги» замість збою.
   */
  const asArray = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Не JSON — нижче віддамо порожній масив.
      }
    }
    return [];
  };

  const evidenceOk = (evidence: unknown): boolean => {
    if (!Array.isArray(evidence)) return true;
    return !evidence.some(
      (e) =>
        e &&
        typeof e === "object" &&
        typeof (e as InsightEvidence).value === "number" &&
        (e as InsightEvidence).value !== 0 &&
        !isKnownNumber((e as InsightEvidence).value, numbers)
    );
  };

  const keepInsights = (list: unknown): Insight[] => {
    return asArray(list).filter((item) => {
      const ok = evidenceOk((item as Insight)?.evidence);
      if (!ok) {
        rejected += 1;
        console.warn(
          `company-insights[${section}]: відкинуто «${(item as Insight)?.title}» — число не з даних`
        );
      }
      return ok;
    }) as Insight[];
  };

  const keepById = <T extends Record<string, unknown>>(list: unknown, key: string): T[] => {
    return asArray(list).filter((item) => {
      const id = (item as Record<string, unknown>)?.[key];
      const known = typeof id === "string" && ids.has(id);
      const ok = known && evidenceOk((item as Record<string, unknown>).evidence);
      if (!ok) {
        rejected += 1;
        console.warn(
          `company-insights[${section}]: відкинуто рядок з ${key}=${String(id)}` +
            (known ? " (число не з даних)" : " (ідентифікатора немає в даних)")
        );
      }
      return ok;
    }) as T[];
  };

  if (section === "reps") {
    const p = (payload ?? {}) as RepsPayload;
    const reps = keepById<RepBlock>(p.reps, "repId").map((block) => ({
      ...block,
      insights: keepInsights(block.insights),
      actions: keepById<RepBlock["actions"][number]>(block.actions, "clientId"),
    }));
    return { kept: { team: keepInsights(p.team), reps }, rejected };
  }

  if (section === "products") {
    const p = (payload ?? {}) as ProductsPayload;
    return {
      kept: {
        insights: keepInsights(p.insights),
        promote: keepById(p.promote, "id"),
        illiquid: keepById(p.illiquid, "id"),
      },
      rejected,
    };
  }

  if (section === "logistics") {
    const p = (payload ?? {}) as LogisticsPayload;
    const drivers = keepById<LogisticsPayload["drivers"][number]>(p.drivers, "driverId").map(
      (d) => ({ ...d, insights: keepInsights(d.insights) })
    );
    return { kept: { overall: keepInsights(p.overall), drivers }, rejected };
  }

  const p = (payload ?? {}) as StrategyPayload;
  const priorities = (asArray(p.priorities) as StrategyPayload["priorities"]).filter((item) => {
    const ok = evidenceOk(item?.evidence);
    if (!ok) rejected += 1;
    return ok;
  });
  return {
    kept: {
      summary: typeof p.summary === "string" ? p.summary : "",
      priorities,
      people: keepById(p.people, "personId"),
    },
    rejected,
  };
}

// ──────────────────────────────── Генерація ────────────────────────────────

/** Чи в payload не лишилося нічого змістовного. */
function isEmptyPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  return Object.values(payload).every((v) =>
    Array.isArray(v) ? v.length === 0 : typeof v === "string" ? v.trim() === "" : v == null
  );
}

export type CompanyResult = {
  payload: unknown;
  model: string;
  tokens: number;
  rejected: number;
};

/** Чи налаштований ключ. Роут віддає 503 із зрозумілим текстом, а не падає. */
export function companyInsightsConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Один виклик моделі. Кидає помилку на обриві — тихого збою тут бути не має. */
async function callModel(
  client: Anthropic,
  section: CompanySection,
  facts: unknown,
  scopeNote?: string
): Promise<{ raw: unknown; tokens: number }> {
  const tool = TOOLS[section];

  const message = await client.messages
    .stream({
      model: MODEL,
      max_tokens: MAX_TOKENS[section],
      system: PROMPTS[section],
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: `${scopeNote ? `${scopeNote}\n\n` : ""}ДАНІ:\n${JSON.stringify(facts, null, 1)}`,
        },
      ],
    })
    .finalMessage();

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Модель не повернула структурованої відповіді");
  }

  // Обрив ловимо ДО читання input: при tool_choice API однаково віддає
  // tool_use блок, але з недописаним JSON, і збій виглядав би як порожній
  // звіт — найгірший спосіб помилитися.
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "Модель не вклалася в ліміт відповіді — звіт обірвався на півслові. Спробуйте ще раз або звузьте період."
    );
  }

  return {
    raw: block.input,
    tokens: message.usage.input_tokens + message.usage.output_tokens,
  };
}

/**
 * Скільки торгових аналізувати одним запитом.
 *
 * На дев'ятьох людях відповідь не вкладалася й у 16 тис. токенів: на кожного
 * йде ~1,5 тис. (три сильні сторони, три слабкі, три інсайти з доказами і до
 * восьми дій із коментарями), і модель обривалася на півслові. Пачка по три
 * лишає запас навіть на найактивнішому торговому з повним чеклістом.
 *
 * Пачки йдуть послідовно, а не паралельно: одночасні запити з однаковим
 * великим контекстом упираються в ліміти API, а виграш у часі невеликий —
 * звіт однаково генерується натисканням і раз на добу.
 */
const REPS_PER_CALL = 3;

/** Факти секції торгових зі звуженим списком людей. */
function sliceRepsFacts(facts: unknown, from: number, to: number): unknown {
  const f = facts as { торгові?: unknown[] };
  return { ...(facts as object), торгові: (f.торгові ?? []).slice(from, to) };
}

/**
 * Генерує одну секцію аналізу фірми.
 *
 * Стрім, а не messages.create: на такому обсязі виводу SDK попереджає про
 * ризик таймауту без нього. Результат однаково збирається цілком — стрім тут
 * заради надійності з'єднання, а не заради показу тексту по літері.
 *
 * Секція «Торгові» ріжеться на пачки (див. REPS_PER_CALL) і зливається в
 * один payload: команда описується один раз, у першому запиті.
 */
export async function generateCompanySection(input: {
  section: CompanySection;
  facts: unknown;
}): Promise<CompanyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Бракує ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });

  if (input.section === "reps") {
    return generateRepsSection(client, input.facts);
  }

  const { raw, tokens } = await callModel(client, input.section, input.facts);
  const { kept, rejected } = validateCompanyPayload(input.section, raw, input.facts);

  assertNotEmpty(input.section, kept, raw, rejected);

  return { payload: kept, model: MODEL, tokens, rejected };
}

/**
 * Порожній звіт при непорожній відповіді моделі — тихий збій, найгірший з
 * можливих: керівник побачив би «нічого вартого уваги» там, де насправді не
 * спрацював розбір. Логуємо структуру, що прийшла, і кидаємо помилку.
 */
function assertNotEmpty(
  section: CompanySection,
  kept: unknown,
  raw: unknown,
  rejected: number
): void {
  if (!isEmptyPayload(kept)) return;

  const obj = (raw ?? {}) as Record<string, unknown>;
  const shape = Object.entries(obj)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? `array(${v.length})` : typeof v}`)
    .join(", ");
  console.error(
    `company-insights[${section}]: порожній звіт. структура відповіді: {${shape}}, ` +
      `відкинуто: ${rejected}\nпочаток відповіді: ${JSON.stringify(obj).slice(0, 500)}`
  );
  throw new Error(
    rejected > 0
      ? `Усі ${rejected} висновків відкинуто перевіркою: у них числа або клієнти, яких немає в даних. Спробуйте ще раз.`
      : "Модель повернула порожній звіт. Спробуйте ще раз або звузьте період."
  );
}

/**
 * Секція «Торгові» пачками.
 *
 * Кожна пачка бачить ті самі спільні цифри (підсумок компанії, медіани), але
 * лише своїх людей — тому висновки про команду просимо тільки в першої, інакше
 * кожна пачка описувала б команду по-своєму, дивлячись на третину людей.
 */
async function generateRepsSection(
  client: Anthropic,
  facts: unknown
): Promise<CompanyResult> {
  const all = (facts as { торгові?: unknown[] }).торгові ?? [];
  if (all.length === 0) {
    throw new Error("За обраний період жоден торговий не має реалізацій.");
  }

  const team: Insight[] = [];
  const reps: RepBlock[] = [];
  let tokens = 0;
  let rejected = 0;

  for (let start = 0; start < all.length; start += REPS_PER_CALL) {
    const isFirst = start === 0;
    const slice = sliceRepsFacts(facts, start, start + REPS_PER_CALL);
    const names = (slice as { торгові: Array<{ торговий?: string }> }).торгові
      .map((r) => r.торговий ?? "—")
      .join(", ");

    const expected = (slice as { торгові: unknown[] }).торгові.length;

    // Вимога «блок на кожного» повторюється тут переліком імен навмисно. На
    // реальному прогоні остання пачка (троє з оборотом 21–23 тис.) вернулася
    // порожньою: модель вирішила, що про малі числа писати нема чого. Але
    // керівникові саме такий блок і потрібен — щоб побачити, що людина майже
    // не продає, і поговорити про це.
    const { raw, tokens: used } = await callModel(
      client,
      "reps",
      slice,
      isFirst
        ? `Це перша частина команди із ${all.length} торгових: ${names}. Дай блок на КОЖНОГО з цих ${expected} людей і висновки про команду загалом, спираючись на підсумок компанії та медіани.`
        : `Це наступна частина команди із ${all.length} торгових: ${names}. Висновки про команду вже зроблено раніше — поле team залиш порожнім. Дай блок на КОЖНОГО з цих ${expected} людей, навіть якщо оборот у когось малий: «майже не продає» — це теж висновок, і саме він потрібен керівникові.`
    );

    const { kept, rejected: dropped } = validateCompanyPayload("reps", raw, slice);
    const part = kept as RepsPayload;

    tokens += used;
    rejected += dropped;
    if (isFirst) team.push(...part.team);
    reps.push(...part.reps);

    if (part.reps.length < expected) {
      console.warn(
        `company-insights[reps]: пачка ${names} — отримано ${part.reps.length} блоків із ${expected}` +
          (dropped > 0 ? ` (відкинуто ${dropped})` : "")
      );
    }
  }

  assertNotEmpty("reps", { team, reps }, { team, reps }, rejected);

  return { payload: { team, reps } satisfies RepsPayload, model: MODEL, tokens, rejected };
}
