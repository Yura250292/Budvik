/**
 * export_file — файл Excel, Excel для 1С або PDF просто з розмови.
 *
 * Сценарій власника (16.09.2026): «сформуй товари, які варто замовити на
 * наступний місяць» → «тепер по бренду APRO» → «зроби це в Excel, PDF або
 * файл, який можна відкрити в 1С».
 *
 * Лише керівникові: у файлі вся фірма, а торговий і так бачить своє в
 * кабінеті. Нічого в базі не пише — файл лягає в R2, а посилання на нього
 * кабінет малює карткою (блок budvik-file, див. loop.ts finalize).
 *
 * Модель називає НАБІР і фільтри — рядки рахує код (exports/datasets.ts).
 */

import type { ToolDef } from "@/lib/assistant/types";
import { enumOf } from "@/lib/assistant/validate";
import { buildDataset, DATASETS } from "@/lib/assistant/exports/datasets";
import { buildXlsx, buildXlsxFor1C } from "@/lib/assistant/exports/xlsx";
import { buildPdf } from "@/lib/assistant/exports/pdf";
import { fileName, saveExport } from "@/lib/assistant/exports/store";
import { FORMAT_META, type ExportFormat } from "@/lib/assistant/exports/types";
import { PERIOD_PARAMS } from "@/lib/assistant/tools/admin";

const FORMATS = ["xlsx", "xlsx_1c", "pdf"] as const;

export const exportFileTool: ToolDef = {
  name: "export_file",
  label: "Готую файл",
  kinds: ["ADMIN"],
  description:
    "Сформувати файл із ПОВНИМ списком і дати посилання для завантаження. format: xlsx — Excel із підсвіткою; xlsx_1c — плоский Excel для завантаження заявки в 1С (код 1С, артикул, назва, кількість, ціна; лише для order_proposal); pdf — для друку й пересилання. dataset: order_proposal — що замовити (дефіцит із кількістю на months місяців, кратністю й собівартістю; brand звужує до бренду, urgent_only — лише те, що продається й скінчилось); dead_stock — мертві залишки (brand, days без продажу); receivables — боржники (rep, overdue_only); abc — ABC/XYZ (dimension, basis, період, brand); sql — твій SELECT по представленнях query_db, до 5000 рядків, LIMIT 50 тут НЕ потрібен (columns — підписи колонок, title); rows — невелика таблиця, яку ти вже маєш у розмові (columns + rows, до 200 рядків). Викликай на «зроби Excel / ексель / таблицю / PDF / файл для 1С / вивантаж».",
  parameters: {
    type: "object",
    properties: {
      format: { type: "string", enum: [...FORMATS], description: "xlsx, xlsx_1c або pdf." },
      dataset: { type: "string", enum: [...DATASETS], description: "Який набір даних." },
      brand: { type: "string", description: "Бренд як у питанні («APRO», «Сила»)." },
      months: { type: "integer", description: "order_proposal: на скільки місяців замовляти, 1–3. За замовчуванням 1." },
      urgent_only: { type: "boolean", description: "order_proposal: лише позиції, що продаються й скінчились." },
      rep: { type: "string", description: "receivables: прізвище торгового." },
      overdue_only: { type: "boolean", description: "receivables: лише з простроченим боргом." },
      dimension: { type: "string", enum: ["product", "brand", "client"], description: "abc: по чому." },
      basis: { type: "string", enum: ["amount", "profit"], description: "abc: за оборотом чи прибутком." },
      sql: { type: "string", description: "sql: SELECT по представленнях query_db, без подвійних лапок." },
      columns: { type: "array", items: { type: "string" }, description: "sql/rows: підписи колонок українською." },
      rows: {
        type: "array",
        // Лише рядки: об'єднані типи ("string" | "number") схема Gemini
        // приймає не завжди. Числа код розпізнає сам (datasets.ts).
        items: { type: "array", items: { type: "string" } },
        description: "rows: рядки таблиці, у тому ж порядку, що columns; числа — рядком без пробілів («12300.5»).",
      },
      title: { type: "string", description: "sql/rows: назва файла й заголовок." },
      note: { type: "string", description: "Примітка під таблицею — межі даних." },
      ...PERIOD_PARAMS,
    },
    required: ["format", "dataset"],
  },
  async run(ctx, args) {
    const format = enumOf(args.format, "format", FORMATS) as ExportFormat | null;
    const dataset = enumOf(args.dataset, "dataset", DATASETS);
    if (!format || !dataset) return { помилка: "потрібні обидва параметри: format і dataset" };
    if (format === "xlsx_1c" && dataset !== "order_proposal") {
      return {
        помилка: "формат xlsx_1c — лише для заявки (dataset order_proposal): завантажувати в 1С документом є сенс тільки її",
      };
    }

    const built = await buildDataset(ctx, dataset, args);
    if ("помилка" in built) return built;

    const rows = built.sheets.reduce((s, sh) => s + sh.rows.length, 0);
    if (rows === 0) return { помилка: "даних для файла немає — список порожній", заголовок: built.title };

    const buffer =
      format === "pdf" ? await buildPdf(built) : format === "xlsx_1c" ? await buildXlsxFor1C(built) : await buildXlsx(built);
    const saved = await saveExport({
      userId: ctx.userId,
      buffer,
      format,
      name: fileName(built.title, format, ctx.today),
      rows,
    });

    return {
      файл_id: saved.id,
      назва: saved.name,
      формат: FORMAT_META[format].label,
      рядків: rows,
      розмір_кб: saved.sizeKb,
      підсумок: built.summary,
      підказка: `Посилання в тексті — [${saved.name}](file:${saved.id}). Картку для завантаження кабінет додасть сам; рядки файла у відповіді не переказуй.`,
    };
  },
};
