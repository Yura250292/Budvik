/**
 * Читальний SQL моделі над віртуальними видами — перевірка, збірка, запуск.
 *
 * Це свідома зміна старого правила «модель не бачить бази»: керівникові
 * потрібні зрізи, яких жоден готовий інструмент не передбачив («скільки
 * ящиків піни по днях минулого тижня», «хто з водіїв здавав касу цього
 * тижня»). Замість вигадувати інструмент на кожне таке питання даємо
 * моделі SELECT — але лише над видами з query-views.ts, лише на читання
 * і лише керівникові. Кожне число все одно приходить із Postgres, а не з
 * памʼяті моделі, і проходить числовий вартовий так само, як з інших
 * інструментів.
 *
 * Чому три шари захисту, а не один. Застосунок ходить у базу як postgres
 * (superuser), тож покластися лише на права не можна:
 * 1. посимвольний сканер — забороняє `"` (базові таблиці CamelCase
 *    недосяжні без лапок), `;` (одна команда), `$` (dollar-quoting і
 *    параметри), коментарі зрізаються, а чорний список слів
 *    перевіряється на тексті БЕЗ вмісту літералів, щоб `ILIKE '%set%'`
 *    не ловився;
 * 2. транзакція READ ONLY + statement_timeout + lock_timeout — навіть
 *    те, що просочилось би повз сканер, база не запише;
 * 3. обмежувач на два одночасні запити — пул Prisma спільний з усім
 *    сайтом (connection_limit=3), і два важкі SELECT-и моделі не мають
 *    права зʼїсти його цілком.
 *
 * Помилки повертаються МОДЕЛІ як дані з підказкою за SQLSTATE: вона
 * виправляє запит і повторює, замість того щоб користувач бачив 500-ту.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import limiter from "@/lib/assistant/concurrency";
import { humanText } from "@/lib/assistant/format";
import { kyivDate, kyivTime } from "@/lib/date/kyiv";
import { HELPER_BY_NAME, VIEWS, VIEW_BY_NAME, type View } from "@/lib/assistant/facts/query-views";

/** Довший текст — це вже не запит, а вставлений документ. */
export const SQL_MAX_CHARS = 4000;

export type SqlCheck =
  | { ok: true; sql: string; masked: string; views: string[] }
  | { ok: false; error: string; hint: string | null };

/* ── Сканер ────────────────────────────────────────────────────────────── */

const QUOTES_HINT =
  "подвійні лапки заборонені: колонки видів пишуться маленькими літерами без лапок, а базові таблиці недоступні — дивись describe";

/**
 * Слова, після яких запит точно не про читання.
 *
 * Свідомо НЕ заборонено comment, fetch, move, cluster, load — вони
 * трапляються як колонки (`comment`) і в законному `FETCH FIRST`.
 */
const FORBIDDEN_WORDS =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|vacuum|analyze|analyse|reindex|refresh|copy|import|set|reset|call|do|lock|listen|unlisten|notify|execute|prepare|deallocate|declare|begin|commit|rollback|savepoint|abort|discard|explain|show|into|returning|checkpoint|reassign|security)\b/i;

const FORBIDDEN_LOCK = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i;

/**
 * Функції й каталоги, яких моделі не треба: сон, файли, сигнали іншим
 * сесіям, послідовності, системні таблиці з чужими запитами й паролями.
 */
const FORBIDDEN_PREFIX =
  /\b(pg_sleep|pg_read|pg_ls_|pg_stat|pg_file_|lo_|dblink|set_config|current_setting|pg_terminate|pg_cancel|pg_reload|pg_rotate|pg_advisory|pg_try_advisory|pg_notify|pg_logical|pg_replication|pg_create_|pg_drop_|pg_switch_wal|pg_promote|pg_backup|nextval|setval|currval|regclass|regproc|to_xml|query_to_|table_to_|cursor_to_|pg_authid|pg_shadow|pg_user_mapping|pg_largeobject|pg_settings|pg_catalog|information_schema|pg_roles|pg_database|pg_tables|pg_class|pg_namespace|pg_proc|pg_attribute|pg_locks|pg_extension)/i;

const FORBIDDEN_CHR = /\bchr\s*\(/i;

const isIdentChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);

/**
 * Один прохід по тексту: зрізає коментарі, перевіряє літерали, ловить
 * заборонені символи поза ними й повертає дві версії — чисту (її й
 * виконуємо) та замасковану (у ній вміст літералів замінено пробілами;
 * по ній шукаємо слова).
 */
function scan(raw: string): SqlCheck {
  let sql = "";
  let masked = "";
  let i = 0;
  const n = raw.length;

  while (i < n) {
    const ch = raw[i];
    const next = raw[i + 1] ?? "";

    if (ch === "-" && next === "-") {
      while (i < n && raw[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (raw[i] === "/" && raw[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (raw[i] === "*" && raw[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth > 0) return { ok: false, error: "незакритий коментар /* … */", hint: null };
      sql += " ";
      masked += " ";
      continue;
    }
    if (ch === "'") {
      // E'…' і U&'…' мають зворотні скісні риски, які наш сканер не
      // розбирає, — простіше заборонити ці префікси, ніж повторити лексер.
      const prev = raw[i - 1] ?? "";
      const prev2 = raw[i - 2] ?? "";
      if ((prev === "e" || prev === "E") && !isIdentChar(prev2)) {
        return { ok: false, error: "escape-рядки E'…' заборонені — пиши звичайний літерал '…'", hint: null };
      }
      if (prev === "&") return { ok: false, error: "рядки U&'…' заборонені", hint: null };

      let literal = "'";
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (raw[j] === "'") {
          if (raw[j + 1] === "'") {
            literal += "''";
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        literal += raw[j];
        j++;
      }
      if (!closed) return { ok: false, error: "незакритий рядковий літерал '…'", hint: null };
      sql += literal + "'";
      masked += "'" + " ".repeat(literal.length - 1) + "'";
      i = j + 1;
      continue;
    }
    if (ch === '"') return { ok: false, error: "у запиті є подвійні лапки", hint: QUOTES_HINT };
    if (ch === "$") {
      return { ok: false, error: "символ $ заборонений (dollar-quoting і параметри)", hint: "дати й тексти пиши літералами в одинарних лапках" };
    }
    if (ch === ";") {
      // Одна крапка з комою наприкінці — звичка моделі, а не друга команда.
      const tail = raw.slice(i + 1).replace(/--[^\n]*/g, "").trim();
      if (tail === "") {
        i++;
        continue;
      }
      return { ok: false, error: "крапка з комою всередині запиту — дозволена лише одна команда SELECT", hint: null };
    }
    sql += ch;
    masked += ch;
    i++;
  }

  return { ok: true, sql: sql.trim(), masked: masked.trim(), views: [] };
}

/** Перевірка запиту моделі — без звернення до бази. */
export function validateSql(raw: string): SqlCheck {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, error: "порожній запит", hint: null };
  if (text.length > SQL_MAX_CHARS) {
    return { ok: false, error: `запит задовгий (${text.length} символів, стеля ${SQL_MAX_CHARS})`, hint: "прибери зайве або розбий на два виклики" };
  }

  const scanned = scan(text);
  if (!scanned.ok) return scanned;
  const { sql, masked } = scanned;

  if (!/^(select|with)(\s|\()/i.test(masked)) {
    return { ok: false, error: "запит має починатися зі SELECT або WITH", hint: "дозволено лише читання" };
  }
  const word = masked.match(FORBIDDEN_WORDS);
  if (word) {
    return { ok: false, error: `слово «${word[1].toUpperCase()}» заборонене — дозволено лише SELECT`, hint: null };
  }
  if (FORBIDDEN_LOCK.test(masked)) {
    return { ok: false, error: "FOR UPDATE / FOR SHARE заборонено — база лише на читання", hint: null };
  }
  const fn = masked.match(FORBIDDEN_PREFIX);
  if (fn) {
    return { ok: false, error: `«${fn[1]}» недоступне з помічника`, hint: "працюй лише з представленнями зі describe" };
  }
  if (FORBIDDEN_CHR.test(masked)) {
    return { ok: false, error: "chr() заборонено", hint: null };
  }

  const views = VIEWS.filter((v) => new RegExp(`\\b${v.name}\\b`, "i").test(masked)).map((v) => v.name);
  return { ok: true, sql, masked, views };
}

/* ── Збірка ────────────────────────────────────────────────────────────── */

/** Службові CTE попереду, потім види у порядку VIEWS: WITH не рекурсивний. */
function ctesFor(viewNames: string[]): Array<{ name: string; body: string }> {
  const picked = viewNames.map((n) => VIEW_BY_NAME.get(n)).filter((v): v is View => Boolean(v));
  const helperNames = new Set<string>();
  for (const v of picked) for (const d of v.deps ?? []) helperNames.add(d);

  const helpers = [...helperNames]
    .map((n) => HELPER_BY_NAME.get(n))
    .filter((h): h is NonNullable<typeof h> => Boolean(h));
  const views = VIEWS.filter((v) => picked.includes(v)).map((v) => ({ name: v.name, body: v.sql }));
  return [...helpers, ...views];
}

/**
 * `WITH … SELECT * FROM (<sql>) q LIMIT maxRows+1`.
 *
 * Зайвий рядок — щоб чесно сказати «обрізано», а не мовчки віддати рівно
 * стелю. Власний WITH моделі всередині підзапиту — законний.
 */
export function buildQuery(sql: string, views: string[], maxRows: number): string {
  const ctes = ctesFor(views);
  const withClause = ctes.length
    ? `WITH ${ctes.map((c) => `${c.name} AS NOT MATERIALIZED (${c.body}\n)`).join(",\n")}\n`
    : "";
  return `${withClause}SELECT * FROM (\n${sql}\n) q LIMIT ${Math.max(1, Math.floor(maxRows)) + 1}`;
}

/* ── Запуск ────────────────────────────────────────────────────────────── */

/** Два одночасні запити моделі — не більше; третій чекає в черзі. */
const runLimited = limiter(2);

/**
 * Єдине місце, де цей модуль торкається Prisma.
 *
 * READ ONLY — перша команда транзакції (інакше Postgres її відхилить);
 * statement_timeout — щоб декартів добуток моделі не жив довше за хід;
 * lock_timeout — щоб читання не висіло за міграцією. Таймаут
 * інтерактивної транзакції з запасом над statement_timeout: помилку має
 * віддати база (57014, її вміємо пояснити), а не Prisma (P2028).
 */
export function runInReadOnlyTx<T = Record<string, unknown>>(text: string, timeoutMs: number): Promise<T[]> {
  const ms = Math.max(500, Math.round(timeoutMs));
  return runLimited(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${ms}`);
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = 2000");
        return tx.$queryRawUnsafe<T[]>(text);
      },
      { maxWait: 5000, timeout: ms + 5000 }
    )
  );
}

/* ── Значення ──────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

/**
 * Будь-яке значення з Postgres → те, що можна віддати моделі в JSON.
 *
 * bigint (count) і Decimal (avg, sum по numeric) JSON не серіалізує;
 * Date опівночі UTC — це колонка типу date, її показуємо датою; решту
 * міток — київським часом. Рядки чистимо як людський текст: у нотатках
 * трапляється що завгодно.
 */
export function plainValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return Number.isInteger(v) ? v : Math.round(v * 100) / 100;
  }
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return humanText(v, 160);
  if (v instanceof Date) {
    const t = v.getTime();
    if (Number.isNaN(t)) return null;
    if (t % DAY_MS === 0) return v.toISOString().slice(0, 10);
    return `${kyivDate(v)} ${kyivTime(v)}`;
  }
  if (v instanceof Uint8Array) return "<bytes>";
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") {
    return plainValue((v as { toNumber: () => number }).toNumber());
  }
  try {
    return humanText(JSON.stringify(v), 300);
  } catch {
    return null;
  }
}

function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = plainValue(v);
  return out;
}

/* ── Помилки ───────────────────────────────────────────────────────────── */

export type DbError = { error: string; code: string | null; hint: string | null };

const HINTS: Array<[RegExp, string]> = [
  [/^57014$/, "запит перевищив ліміт часу — звузь період (фільтр по day), додай умову або агрегуй замість рядків"],
  [/^(42703|42P01)$/, "такої колонки або представлення немає — подивись describe і бери назви звідти, маленькими літерами"],
  [/^42601$/, "синтаксична помилка SQL — перевір лапки, коми, дужки й порядок GROUP BY / ORDER BY / LIMIT"],
  [/^42883$/, "функції для таких типів немає — приведи типи явно: ::numeric, ::text, ::date"],
  [/^(22P02|22007|22008)$/, "невірний формат значення — дата як 'YYYY-MM-DD', статуси й типи великими літерами як у describe"],
  [/^25006$/, "база лише на читання — дозволено тільки SELECT"],
  [/^42804$/, "невідповідність типів — приведи явно (::numeric, ::text)"],
  [/^42P18$/, "тип значення неоднозначний — додай ::text або ::numeric"],
  [/^22012$/, "ділення на нуль — постав NULLIF(знаменник, 0)"],
  [/^42P19$/, "щось не так із групуванням — усі неагреговані колонки мають бути в GROUP BY"],
  [/^42803$/, "колонка поза GROUP BY — додай її в GROUP BY або в агрегат"],
  [/^(53300|08\w{3})$/, "база зайнята — повтори за кілька секунд"],
  [/^(40001|40P01)$/, "конфлікт із іншою транзакцією — просто повтори"],
];

/** Витягує SQLSTATE і людське пояснення з того, що кинув Prisma. */
export function describeDbError(e: unknown): DbError {
  let code: string | null = null;
  let message = e instanceof Error ? e.message : String(e);

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (e.meta ?? {}) as Record<string, unknown>;
    if (e.code === "P2010") {
      code = typeof meta.code === "string" ? meta.code : null;
      if (typeof meta.message === "string") message = meta.message;
    } else if (e.code === "P2024") {
      return { error: "база зайнята: не дочекались вільного зʼєднання", code: "P2024", hint: "повтори за кілька секунд або спрости запит" };
    } else if (e.code === "P2028") {
      return { error: "транзакцію закрито за часом", code: "P2028", hint: "запит надто довгий — звузь період або агрегуй" };
    } else {
      code = e.code;
    }
  }
  if (!code) {
    const m = message.match(/code:\s*"?(\w{5})"?/) ?? message.match(/SQLSTATE[^0-9A-Z]*([0-9A-Z]{5})/);
    if (m) code = m[1];
  }
  // Prisma дописує до тексту бази свій контекст — моделі потрібен лише сам текст.
  const dbMsg = message.match(/message:\s*"([^"]+)"/);
  if (dbMsg) message = dbMsg[1];
  message = humanText(message.replace(/\s*\n\s*/g, " "), 300);

  const hint = code ? (HINTS.find(([re]) => re.test(code as string))?.[1] ?? null) : null;
  return { error: message || "невідома помилка бази", code, hint };
}

/* ── Разом ─────────────────────────────────────────────────────────────── */

export type QueryOptions = { timeoutMs?: number; maxRows?: number };

export type QueryResult =
  | { ok: true; rows: Record<string, unknown>[]; truncated: boolean; ms: number; views: string[] }
  | { ok: false; error: string; code: string | null; hint: string | null; ms: number; views: string[] };

/** Перевірити, зібрати, виконати, унормувати. Не кидає — усе повертає як дані. */
export async function runReadOnlyQuery(raw: string, opts: QueryOptions = {}): Promise<QueryResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRows = opts.maxRows ?? 100;
  const started = Date.now();

  const check = validateSql(raw);
  if (!check.ok) return { ok: false, error: check.error, code: null, hint: check.hint, ms: 0, views: [] };

  const text = buildQuery(check.sql, check.views, maxRows);
  try {
    const rows = await runInReadOnlyTx<Record<string, unknown>>(text, timeoutMs);
    const truncated = rows.length > maxRows;
    return {
      ok: true,
      rows: (truncated ? rows.slice(0, maxRows) : rows).map(plainRow),
      truncated,
      ms: Date.now() - started,
      views: check.views,
    };
  } catch (e) {
    const d = describeDbError(e);
    return { ok: false, ...d, ms: Date.now() - started, views: check.views };
  }
}

/* ── Лічильник ─────────────────────────────────────────────────────────── */

const STATE_KEY = "assistant:queryDb";
const KEEP_DAYS = 14;

export type QueryDbDay = {
  calls: number;
  errors: number;
  /** Сумарний час, мс — середнє рахується при читанні. */
  ms: number;
  /** Коди помилок → скільки разів: видно, на чому модель спотикається. */
  codes: Record<string, number>;
};

/**
 * Скільки разів модель ходила в базу, скільки з того впало і на чому.
 *
 * За зразком number-guard.ts: лічильник у SyncState, а не таблиця — тут
 * питання одне, «чи вміє вона писати SQL по видах», і відповідь дають
 * кілька чисел на день. Скрипти-проби вимикають запис змінною
 * ASSISTANT_QUERY_DB_COUNTER=off, щоб не домішувати себе в бойову
 * статистику. Ніколи не кидає: лічильник про якість, а не про роботу.
 */
export async function recordQueryDb(day: string, hit: { ok: boolean; ms: number; code?: string | null }): Promise<void> {
  if (process.env.ASSISTANT_QUERY_DB_COUNTER === "off") return;
  try {
    const row = await prisma.syncState.findUnique({ where: { key: STATE_KEY } });
    let log: Record<string, QueryDbDay> = {};
    if (row) {
      try {
        log = JSON.parse(row.value) as Record<string, QueryDbDay>;
      } catch {
        log = {};
      }
    }
    const acc = log[day] ?? { calls: 0, errors: 0, ms: 0, codes: {} };
    acc.calls += 1;
    acc.ms += Math.round(hit.ms);
    if (!hit.ok) {
      acc.errors += 1;
      const code = hit.code ?? "?";
      acc.codes[code] = (acc.codes[code] ?? 0) + 1;
    }
    log[day] = acc;

    for (const key of Object.keys(log).sort()) {
      if (Object.keys(log).length <= KEEP_DAYS) break;
      if (key < day) delete log[key];
    }

    const value = JSON.stringify(log);
    await prisma.syncState.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value },
      update: { value },
    });
  } catch {
    // Лічильник не має права зламати відповідь.
  }
}
