/**
 * query_db — читальний SQL керівника над віртуальними видами.
 *
 * Останній інструмент у списку, а не перший: готові зведення (team_overview,
 * documents, staff_profile…) віддають числа, звірені з кабінетом, і модель
 * має йти по них спочатку. query_db — для зрізів, яких ніхто не
 * передбачив. Лише ADMIN: торговому база фірми цілком не належить, а
 * скоуп «свої клієнти» у довільному SQL не втримати.
 *
 * describe і sql приймаються в одному виклику навмисно: раундів на хід
 * чотири (MAX_ROUNDS), і витрачати окремий на «покажи колонки» —
 * розкіш. Помилка бази повертається як ДАНІ з підказкою: модель виправляє
 * запит і повторює, а користувач не бачить 500-ї.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { str, ToolArgError } from "@/lib/assistant/validate";
import { VIEWS, VIEW_BY_NAME, type View } from "@/lib/assistant/facts/query-views";
import { recordQueryDb, runReadOnlyQuery } from "@/lib/assistant/facts/query-db";

/** Стеля рядків для моделі: більше вона однаково не прочитає, а агрегувати — краще. */
const MAX_ROWS = 100;
const TIMEOUT_MS = 10_000;

const RULES = [
  "Лише представлення з цього списку; базових таблиць і подвійних лапок немає. Колонки — маленькими літерами, як у describe.",
  "ЗАВЖДИ LIMIT ≤ 50. Суми й кількості рахуй через GROUP BY, а не читай рядки.",
  "Дати: колонка day — справжня дата за Києвом; порівнюй з 'YYYY-MM-DD' (day = '2026-09-09', day BETWEEN '…' AND '…'). Дати бери з КОНТЕКСТУ.",
  "Продажі: documents / document_lines WHERE real_sale (проведені реалізації й повернення з 1С з 2026 року). Повернення вже від'ємні — SUM(total) дає нетто; документи й клієнтів рахуй з doc_type <> 'RETURN'.",
  "Людей, клієнтів і товари шукай ILIKE '%…%' по частині слова (rep ILIKE '%Кулик%'). Аліаси — латиницею, у відповіді перекладай. Порожній результат — привід перевірити фільтр, а не висновок «нічого немає».",
];

const EXAMPLES = [
  "SELECT rep, SUM(total) AS amount, COUNT(*) FILTER (WHERE doc_type <> 'RETURN') AS docs FROM documents WHERE real_sale AND day BETWEEN '2026-09-01' AND '2026-09-10' GROUP BY rep ORDER BY amount DESC LIMIT 20",
  "SELECT day, SUM(quantity) AS qty, SUM(amount) AS amount FROM document_lines WHERE real_sale AND product ILIKE '%піна%' AND day >= '2026-09-01' GROUP BY day ORDER BY day LIMIT 31",
  "SELECT name, debt, rep, last_sale_day FROM clients WHERE debt > 0 ORDER BY debt DESC LIMIT 20",
];

/** describe приходить масивом, але flash часом шле «documents, clients» рядком. */
function describeNames(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(/[,\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  }
  throw new ToolArgError("Поле «describe» має бути масивом назв представлень");
}

function viewCard(v: View) {
  return {
    назва: v.name,
    про_що: v.purpose,
    колонки: v.columns.map((c) => ({ назва: c.name, тип: c.type, опис: c.description })),
    ...(v.examples ? { приклади: v.examples } : {}),
  };
}

function describe(names: string[]) {
  if (names.length === 0) {
    return {
      представлення: VIEWS.map((v) => ({ назва: v.name, про_що: v.purpose })),
      правила: RULES,
      приклади: EXAMPLES,
    };
  }
  const available = VIEWS.map((v) => v.name);
  return {
    представлення: names.map((name) => {
      const v = VIEW_BY_NAME.get(name);
      return v ? viewCard(v) : { назва: name, помилка: "такого представлення немає", доступні: available };
    }),
  };
}

export const queryDbTool: ToolDef = {
  name: "query_db",
  label: "Читаю базу",
  kinds: ["ADMIN"],
  description:
    "Читальний SQL (лише SELECT) над представленнями бази: documents, document_lines, clients, products, stock_by_location, payments, payment_allocations, shifts, track_days, route_sheets, delivery_routes, cash_handovers, pick_marks, warehouse_shifts, site_orders, debt_snapshots та інші. Спершу describe: [] — список і правила, describe: ['documents'] — колонки з прикладами; потім sql. Можна describe і sql разом в одному виклику. Викликай лише коли жоден готовий інструмент не покриває питання — їхні числа звірені з кабінетом.",
  parameters: {
    type: "object",
    properties: {
      describe: {
        type: "array",
        items: { type: "string" },
        description: "Які представлення описати (колонки, приклади). Порожній масив — список усіх із правилами.",
      },
      sql: {
        type: "string",
        description: "SELECT над представленнями. Колонки маленькими літерами без лапок, дати 'YYYY-MM-DD', ЗАВЖДИ LIMIT ≤ 50.",
      },
    },
  },
  async run(ctx, args) {
    const names = describeNames(args.describe);
    const sql = args.sql === undefined || args.sql === null || args.sql === "" ? null : str(args.sql, "sql", { max: 20_000 });
    if (names === null && sql === null) {
      throw new ToolArgError("Вкажи describe (список представлень) або sql (SELECT), можна обидва разом");
    }

    const out: Record<string, unknown> = names === null ? {} : describe(names);
    if (sql === null) return out;

    const result = await runReadOnlyQuery(sql, { timeoutMs: TIMEOUT_MS, maxRows: MAX_ROWS });
    const viewsUsed = result.views.join(",") || "—";

    if (!result.ok) {
      console.warn(`[query_db] ${ctx.userId} · ${result.ms} мс · помилка ${result.code ?? "?"} · ${viewsUsed}`);
      await recordQueryDb(ctx.today, { ok: false, ms: result.ms, code: result.code });
      return {
        ...out,
        помилка: result.error,
        код: result.code,
        підказка: result.hint,
        представлення_у_запиті: result.views,
      };
    }

    console.info(`[query_db] ${ctx.userId} · ${result.ms} мс · ${result.rows.length} рядків · ${viewsUsed}`);
    await recordQueryDb(ctx.today, { ok: true, ms: result.ms });

    let hint: string | null = null;
    if (result.rows.length === 0) {
      hint = "порожньо: перевір фільтри — day у форматі 'YYYY-MM-DD', real_sale для продажів, ILIKE '%…%' для імен; якщо й так порожньо — даних справді немає";
    } else if (result.truncated) {
      hint = `показано лише перші ${MAX_ROWS} рядків — агрегуй (GROUP BY) або звузь фільтр`;
    } else if (result.rows.length > 50) {
      hint = "рядків багато — краще агрегуй (GROUP BY), ніж перелічуй";
    }

    return {
      ...out,
      рядки: result.rows,
      рядків: result.rows.length,
      ...(result.truncated ? { обрізано: true } : {}),
      ...(hint ? { підказка: hint } : {}),
    };
  },
};
