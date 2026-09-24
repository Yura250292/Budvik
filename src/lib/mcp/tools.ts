/**
 * Інструменти, які MCP-конектор віддає claude.ai і ChatGPT.
 *
 * Три види:
 * 1. describe_data — які є дані (усі види query_db) і правила SQL над ними;
 * 2. query_db — читальний SELECT над цими видами, через окрему читальну
 *    роль Postgres і до 500 рядків (для графіків треба денні ряди за рік);
 * 3. готові зведення помічника керівника — ті самі ToolDef, що в кабінеті,
 *    з тими самими числами, звіреними з кабінетом.
 *
 * Список зведень — явний, а не «все, що бачить ADMIN»: новий пишучий
 * інструмент помічника не має потрапити назовні сам собою.
 */

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_BY_NAME } from "@/lib/assistant/tools";
import { describeViews } from "@/lib/assistant/tools/query";
import { VIEWS } from "@/lib/assistant/facts/query-views";
import { ToolArgError } from "@/lib/assistant/validate";
import type { ToolContext, ToolDef } from "@/lib/assistant/types";
import { runReadOnlyQuery } from "@/lib/assistant/facts/query-db";
import { kyivDate } from "@/lib/date/kyiv";
import { readonlyDb } from "@/lib/mcp/readonly-db";
import { absoluteUrl } from "@/lib/seo/site";
import type { McpCtx } from "@/lib/mcp/audit";

export type { McpCtx } from "@/lib/mcp/audit";

/** Готові зведення керівника, які віддаємо назовні. Порядок — як у помічника. */
export const SUMMARY_TOOLS = [
  "staff_now",
  "team_overview",
  "staff_profile",
  "team_receivables",
  "documents",
  "shifts_report",
  "drivers_report",
  "drivers_today",
  "site_report",
  "stock_health",
  "sync_health",
  "money_flows",
  "sales_analysis",
  "search_clients",
  "client_profile",
  "product_search",
  // Нічого не пише: план доставки й порядок об'їзду лише рахуються, чернетки
  // маршрутів створює людина кнопкою на сайті (посилання у відповіді).
  "build_route",
  // Наради й задачі команді — щоб модель у Claude/ChatGPT була в курсі подій.
  "meetings",
] as const;

const QUERY_MAX_ROWS = 500;
const QUERY_TIMEOUT_MS = 15_000;

export type ToolRun = { result: CallToolResult; rows?: number | null };

export type McpTool = {
  def: Tool;
  run: (ctx: McpCtx, args: Record<string, unknown>) => Promise<ToolRun>;
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const textResult = (data: unknown, isError = false): CallToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
  ...(isError ? { isError: true } : {}),
});

/** Контекст помічника керівника: уся фірма, «я» — сам адмін. Як у роуті помічника. */
function toolContext(ctx: McpCtx): ToolContext {
  return {
    userId: ctx.userId,
    role: "ADMIN",
    kind: "ADMIN",
    scope: { repId: ctx.userId, repName: ctx.userName, company: true },
    today: kyivDate(new Date()),
  };
}

const describeData: McpTool = {
  def: {
    name: "describe_data",
    title: "Опис даних Budvik",
    description:
      `Які дані є для query_db: без аргументів — список ${VIEWS.length} представлень (продажі, рядки накладних, клієнти й борги, товари, склад, оплати, зміни, трек, маршрути, водії, інтернет-замовлення, ціни 1С/сайту/ринку, пропозиції агента цін, ціни постачальників, наради й задачі, потенційні клієнти, сезонність, сайт по днях…) і правила SQL; з views — колонки й приклади запитів для названих. Виклич перед першим query_db у розмові.`,
    inputSchema: {
      type: "object",
      properties: {
        views: {
          type: "array",
          items: { type: "string" },
          description: "Назви представлень, напр. [\"documents\", \"document_lines\"]. Порожньо — список усіх із правилами.",
        },
      },
    },
    annotations: { title: "Опис даних", ...READ_ONLY },
  },
  async run(_ctx, args) {
    const raw = args.views;
    const names = Array.isArray(raw)
      ? raw.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      : typeof raw === "string"
        ? raw.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
        : [];
    return { result: textResult(describeViews(names)) };
  },
};

const queryDb: McpTool = {
  def: {
    name: "query_db",
    title: "SQL-запит до даних Budvik",
    description:
      "Читальний SQL (лише SELECT / WITH) над представленнями з describe_data. Колонки маленькими літерами без лапок, дати 'YYYY-MM-DD'. До 500 рядків — рахуй у SQL (GROUP BY, date_trunc), а не тягни сирі рядки. Відповідь: columns і rows (масиви значень у порядку columns). Помилка бази приходить із кодом і підказкою — виправ запит і повтори. Спершу подивись, чи немає готового зведення.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SELECT над представленнями, напр. SELECT rep, SUM(total) AS amount FROM documents WHERE real_sale AND day >= '2026-09-01' GROUP BY rep ORDER BY amount DESC LIMIT 20" },
      },
      required: ["sql"],
    },
    annotations: { title: "SQL-запит (читання)", ...READ_ONLY },
  },
  async run(_ctx, args) {
    const sql = typeof args.sql === "string" ? args.sql.trim() : "";
    if (!sql) return { result: textResult({ помилка: "Потрібне поле sql — SELECT над представленнями з describe_data" }, true) };

    const r = await runReadOnlyQuery(sql, { db: readonlyDb(), maxRows: QUERY_MAX_ROWS, timeoutMs: QUERY_TIMEOUT_MS });
    if (!r.ok) {
      return { result: textResult({ помилка: r.error, код: r.code, підказка: r.hint, представлення_у_запиті: r.views }, true) };
    }
    // Колонки окремо, рядки масивами: для 500 рядків це вдвічі менше токенів,
    // ніж повторювати назви в кожному об'єкті.
    const columns = r.rows.length ? Object.keys(r.rows[0]) : [];
    const rows = r.rows.map((row) => columns.map((c) => row[c]));
    let hint: string | undefined;
    if (!r.rows.length) {
      hint = "порожньо: перевір фільтри — day 'YYYY-MM-DD', real_sale для продажів, ILIKE '%…%' для імен; якщо й так порожньо — даних справді немає";
    } else if (r.truncated) {
      hint = `показано лише перші ${QUERY_MAX_ROWS} рядків — агрегуй (GROUP BY) або звузь період`;
    }
    return {
      result: textResult({ columns, rows, row_count: rows.length, ...(r.truncated ? { truncated: true } : {}), ...(hint ? { hint } : {}), ms: r.ms }),
      rows: rows.length,
    };
  },
};

/** Шлях до екрана сайту: саме значення, а не текст, де він десь усередині. */
const SITE_PATH = /^\/(admin|sales|driver|warehouse)(\/|\?|$)/;

/**
 * Посилання на екрани сайту — повними адресами.
 *
 * Зведення помічника живуть у кабінеті й віддають відносні шляхи
 * («/admin/logistics/delivery?tab=plan…»): там це клікабельно. У claude.ai чи
 * ChatGPT такий шлях нікуди не веде — людина бачить посилання на план і не
 * може його відкрити. Міняємо лише значення, що цілком є шляхом сайту.
 */
export function absolutizeLinks<T>(value: T): T {
  if (typeof value === "string") return (SITE_PATH.test(value) ? absoluteUrl(value) : value) as T;
  if (Array.isArray(value)) return value.map((v) => absolutizeLinks(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, absolutizeLinks(v)])) as T;
  }
  return value;
}

/** Готове зведення помічника → інструмент MCP. */
function fromToolDef(def: ToolDef): McpTool {
  if (def.write) throw new Error(`MCP: ${def.name} пише в базу — назовні не віддаємо`);
  if (!(def.kinds ?? ["SALES"]).includes("ADMIN")) throw new Error(`MCP: ${def.name} не для керівника`);
  return {
    def: {
      name: def.name,
      title: def.label,
      description: def.description,
      inputSchema: { type: "object", ...(def.parameters as Record<string, unknown>) } as Tool["inputSchema"],
      annotations: { title: def.label, ...READ_ONLY },
    },
    async run(ctx, args) {
      try {
        const out = await def.run(toolContext(ctx), args);
        return { result: textResult(absolutizeLinks(out ?? {})) };
      } catch (e) {
        if (e instanceof ToolArgError) return { result: textResult({ помилка: e.message }, true) };
        throw e;
      }
    },
  };
}

let cache: Map<string, McpTool> | undefined;

/** Усі інструменти за назвою. Будується раз: список фіксований. */
export function mcpTools(): Map<string, McpTool> {
  if (cache) return cache;
  const list: McpTool[] = [describeData, queryDb];
  for (const name of SUMMARY_TOOLS) {
    const def = TOOL_BY_NAME.get(name);
    if (!def) throw new Error(`MCP: інструмента ${name} немає в помічнику`);
    list.push(fromToolDef(def));
  }
  cache = new Map(list.map((t) => [t.def.name, t]));
  return cache;
}
