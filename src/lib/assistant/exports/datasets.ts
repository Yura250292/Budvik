/**
 * Набори даних для вивантаження — ПОВНІ списки, а не верхівки для чату.
 *
 * У відповіді помічник показує 10–15 рядків, бо це читають з телефона. Файл
 * просять саме тоді, коли потрібен весь перелік: «сформуй по бренду APRO
 * позиції, які треба замовити, у Excel». Тому кожен набір тут бере ті самі
 * джерела, що й інструменти (числа мають збігатися з відповіддю), але без
 * `slice`.
 *
 * Модель не збирає рядки сама: вона називає набір і фільтри, а рядки
 * рахує код. Інакше заявка на 500 позицій з'їла б увесь вихід моделі й
 * мала б шанс розійтися з базою. Виняток — `rows`, маленька таблиця, яку
 * модель уже має в розмові (підсумок, порівняння), і `sql` — довільний
 * читальний запит у тій самій пісочниці, що й query_db.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ToolContext } from "@/lib/assistant/types";
import type { ExportColumn, ExportDataset, RowTone } from "@/lib/assistant/exports/types";
import { XLSX_MAX_ROWS } from "@/lib/assistant/exports/types";
import { ToolArgError, bool, enumOf, int, str } from "@/lib/assistant/validate";
import { brandProblem, resolveBrand } from "@/lib/assistant/facts/brands";
import { resolveStaff, staffProblem, listStaff, repKinds } from "@/lib/assistant/facts/staff";
import { buildLowStockReport, DEFAULT_PARAMS } from "@/lib/procurement/low-stock";
import { deadStockItems } from "@/lib/assistant/facts/product-facts";
import { DEAD_STOCK_DAYS } from "@/lib/assistant/config";
import { receivableRowsByRep, toDebtorList } from "@/lib/analytics/money-facts";
import { payerVerdicts, verdictLabel } from "@/lib/assistant/facts/discipline-cache";
import { buildAbcReport } from "@/lib/analytics/abc";
import { runReadOnlyQuery } from "@/lib/assistant/facts/query-db";
import { checkedPeriod, hasPeriodArgs } from "@/lib/assistant/tools/admin";
import { periodFromArgs } from "@/lib/assistant/period";
import { kyivDate } from "@/lib/date/kyiv";

export const DATASETS = ["order_proposal", "dead_stock", "receivables", "abc", "sql", "rows"] as const;
export type DatasetName = (typeof DATASETS)[number];

type Problem = { помилка: string; варіанти?: unknown };
type Built = ExportDataset | Problem;

const today = () => kyivDate(new Date());
const dmy = (day: string) => day.split("-").reverse().join(".");

async function brandArg(args: Record<string, unknown>): Promise<{ id: string; name: string } | null | Problem> {
  if (typeof args.brand !== "string" || !args.brand.trim()) return null;
  const query = str(args.brand, "brand", { min: 2, max: 40 });
  const match = await resolveBrand(query);
  return match.ok ? match.brand : brandProblem(match, query);
}

const isProblem = (v: unknown): v is Problem => Boolean(v && typeof v === "object" && "помилка" in v);

/** Остання відома собівартість — у заявці сума має бути в закупівельних цінах. */
async function lastCosts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ productId: string; cost: number }>>`
    SELECT DISTINCT ON (i."productId") i."productId", i."purchasePrice"::float AS cost
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED' AND s."docType" = 'REALIZATION'
      AND i."purchasePrice" > 0
      AND i."productId" IN (${Prisma.join(ids)})
    ORDER BY i."productId", s."createdAt" DESC
  `;
  return new Map(rows.map((r) => [r.productId, Math.round(r.cost * 100) / 100]));
}

/* ── Заявка: що замовити ──────────────────────────────────────────────── */

async function orderProposal(args: Record<string, unknown>): Promise<Built> {
  const brand = await brandArg(args);
  if (isProblem(brand)) return brand;
  const months = int(args.months, "months", { min: 1, max: 3, fallback: 1 });
  const window = int(args.days, "days", { min: 30, max: 180, fallback: 90 });
  const urgentOnly = bool(args.urgent_only, false);

  const report = await buildLowStockReport({ brandId: brand?.id ?? null, ...DEFAULT_PARAMS, velocityDays: window });
  if (!report) return { помилка: "Бренд не знайдено" };

  /*
   * Кількість — на ОБРАНИЙ горизонт, а не на два місяці звіту закупівель:
   * власник питає «що замовити на наступний місяць». Правило те саме, що в
   * low-stock.ts (не менше норми, мінус залишок), плюс округлення вгору до
   * кратності пакування — інакше «замовити 7» там, де продають пачками по 10.
   */
  const items = report.sections
    .flatMap((s) => s.groups.flatMap((g) => g.items))
    .filter((i) => i.severity < 3 && (!urgentOnly || i.severity === 0))
    .map((i) => {
      const need = Math.max(i.threshold - i.stock, Math.ceil(i.perMonth * months) - i.stock, 0);
      const pack = i.packQty && i.packQty > 1 ? i.packQty : 1;
      return { ...i, qty: Math.ceil(need / pack) * pack };
    })
    .filter((i) => i.qty > 0)
    .sort((a, b) => a.severity - b.severity || b.sold90 - a.sold90)
    .slice(0, XLSX_MAX_ROWS);

  const costs = await lastCosts(items.map((i) => i.id));
  // Коротко: у PDF довгий статус розтягував кожен рядок утричі.
  const STATUS = ["Терміново", "Мало, < місяця", "Нижче норми"];

  const rows = items.map((i) => {
    const cost = costs.get(i.id) ?? null;
    return {
      brand: i.brandName,
      sku: i.sku ?? "",
      name: i.name,
      stock: i.stock,
      sold: Math.round(i.sold90),
      perMonth: i.perMonth,
      daysLeft: i.daysLeft,
      pack: i.packQty && i.packQty > 1 ? i.packQty : null,
      qty: i.qty,
      cost,
      sum: cost != null ? Math.round(cost * i.qty * 100) / 100 : null,
      status: STATUS[i.severity] ?? "",
      lastReceipt: i.lastReceiptAt ? dmy(i.lastReceiptAt.slice(0, 10)) : "",
      guid: i.externalId ?? "",
    };
  });
  const tones: RowTone[] = items.map((i) => (i.severity === 0 ? "urgent" : i.severity === 1 ? "warn" : null));
  const total = rows.reduce((s, r) => s + (r.sum ?? 0), 0);
  const noCost = rows.filter((r) => r.cost == null).length;

  const columns: ExportColumn[] = [
    { key: "brand", header: "Бренд", width: 14 },
    { key: "sku", header: "Артикул", width: 14 },
    { key: "name", header: "Назва", width: 56 },
    { key: "stock", header: "Залишок", kind: "int", width: 9 },
    { key: "sold", header: `Продано за ${window} дн`, kind: "int", width: 11 },
    { key: "perMonth", header: "На місяць", kind: "decimal", width: 10 },
    { key: "daysLeft", header: "Вистачить, дн", kind: "int", width: 10 },
    { key: "pack", header: "Кратність", kind: "int", width: 9 },
    { key: "qty", header: `Замовити на ${months} міс`, kind: "int", width: 11 },
    { key: "cost", header: "Собівартість", kind: "price", width: 12 },
    { key: "sum", header: "Сума", kind: "money", width: 13 },
    { key: "status", header: "Статус", width: 16 },
    { key: "lastReceipt", header: "Останній прихід", kind: "date", width: 13 },
    { key: "guid", header: "Код 1С", width: 38, pdf: false },
  ];

  const who = brand?.name ?? "усі бренди";
  return {
    title: `Що замовити — ${who}`,
    subtitle: `Сформовано ${dmy(today())} · темп продажів за ${window} днів · кількість на ${months} міс.`,
    summary: [
      `Позицій: ${rows.length}`,
      `терміново: ${items.filter((i) => i.severity === 0).length}`,
      `сума за собівартістю: ${Math.round(total).toLocaleString("uk-UA")} грн${
        noCost ? ` — ${noCost} поз. без відомої собівартості в суму НЕ входять (клітинка порожня, прайсу не підставлено)` : ""
      }`,
    ],
    sheets: [{ name: "Заявка", columns, rows, tones }],
    notes: [
      "Терміново — продається й скінчилось; мало — вистачить менш ніж на місяць; нижче норми — рідко продається й залишок нижче мінімуму.",
      "Кількість = потреба на горизонт за середнім темпом, мінус залишок, не менше норми, округлено до кратності.",
      "Не враховано товар у дорозі й замовлення постачальнику, які ще не надійшли: 1С їх не передає.",
      "Собівартість — з останньої реалізації, це оцінка, а не ціна постачальника.",
    ],
    oneC: items.map((i) => ({ guid: i.externalId, sku: i.sku, name: i.name, qty: i.qty, price: costs.get(i.id) ?? null })),
  };
}

/* ── Мертві залишки ───────────────────────────────────────────────────── */

async function deadStock(ctx: ToolContext, args: Record<string, unknown>): Promise<Built> {
  const brand = await brandArg(args);
  if (isProblem(brand)) return brand;
  const minDays = int(args.days, "days", { min: 30, max: 365, fallback: DEAD_STOCK_DAYS });
  const items = await deadStockItems({ repId: ctx.scope.repId, brand: brand?.name ?? null, minDays, limit: XLSX_MAX_ROWS });

  const rows = items.map((p) => {
    const cost = p.lastCost ?? null;
    const idle = p.lastSale ? Math.floor((Date.now() - new Date(p.lastSale).getTime()) / 86_400_000) : null;
    return {
      brand: p.brand ?? "",
      sku: p.sku ?? "",
      name: p.name,
      free: p.free,
      cost,
      sum: cost != null ? Math.round(cost * p.free * 100) / 100 : null,
      price: p.price,
      lastSale: p.lastSale ? dmy(kyivDate(new Date(p.lastSale))) : "не продавався",
      idle,
    };
  });
  const total = rows.reduce((s, r) => s + (r.sum ?? 0), 0);

  return {
    title: `Мертві залишки — ${brand?.name ?? "усі бренди"}`,
    subtitle: `Сформовано ${dmy(today())} · без продажу ${minDays}+ днів`,
    summary: [`Позицій: ${rows.length}`, `заморожено за собівартістю: ${Math.round(total).toLocaleString("uk-UA")} грн`],
    sheets: [
      {
        name: "Без руху",
        columns: [
          { key: "brand", header: "Бренд", width: 14 },
          { key: "sku", header: "Артикул", width: 14 },
          { key: "name", header: "Назва", width: 56 },
          { key: "free", header: "Вільний залишок", kind: "int", width: 11 },
          { key: "cost", header: "Собівартість", kind: "price", width: 12 },
          { key: "sum", header: "Заморожено", kind: "money", width: 13 },
          { key: "price", header: "Ціна сайту", kind: "price", width: 12 },
          { key: "lastSale", header: "Остання продаж", kind: "date", width: 14 },
          { key: "idle", header: "Днів без продажу", kind: "int", width: 11 },
        ],
        rows,
      },
    ],
    notes: ["Упорядковано за замороженими грошима.", "Собівартість — з останньої реалізації, це оцінка."],
  };
}

/* ── Дебіторка ───────────────────────────────────────────────────────── */

async function receivables(args: Record<string, unknown>): Promise<Built> {
  let repId: string | null = null;
  let repName = "уся фірма";
  if (typeof args.rep === "string" && args.rep.trim()) {
    const match = await resolveStaff(str(args.rep, "rep", { min: 2, max: 60 }), ["SALES"]);
    if (!match.ok) return staffProblem(match, "торгового");
    repId = match.user.id;
    repName = match.user.name;
  }
  const overdueOnly = bool(args.overdue_only, false);
  // Свої рахунки (працівники, склади) — не клієнти; як і в team_receivables.
  const includeInternal = bool(args.include_internal, false);
  const [allRows, verdicts, staff, kinds] = await Promise.all([
    receivableRowsByRep(repId),
    payerVerdicts(),
    listStaff(["SALES"]),
    repKinds(),
  ]);
  const rows = includeInternal ? allRows : allRows.filter((r) => !r.internal);
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const repOf = new Map(rows.map((r) => [r.counterpartyId, r.repId]));
  const repOfClient = (id: string) => nameOf.get(repOf.get(id) ?? "") ?? "";
  // Згруповано по торговому — «дебіторка по торгових і їх клієнтах» читається блоками.
  const debtors = toDebtorList(rows)
    .filter((d) => (overdueOnly ? d.overdue > 0 : true))
    .sort((a, b) => (repOfClient(a.counterpartyId) || "яяя").localeCompare(repOfClient(b.counterpartyId) || "яяя", "uk") || b.overdue - a.overdue || b.debt - a.debt)
    .slice(0, XLSX_MAX_ROWS);

  const out = debtors.map((d) => ({
    client: d.name,
    code: d.code ?? "",
    rep: repOfClient(d.counterpartyId),
    repKind: kinds.get(repOf.get(d.counterpartyId) ?? "") ?? "",
    debt: Math.round(d.debt * 100) / 100,
    overdue: Math.round(d.overdue * 100) / 100,
    oldest: d.oldestDays,
    payer: verdictLabel(verdicts.verdicts.get(d.counterpartyId)) ?? "",
    lastDoc: d.lastDocAt ? dmy(d.lastDocAt.slice(0, 10)) : "",
  }));
  const total = out.reduce((s, r) => s + r.debt, 0);
  const overdue = out.reduce((s, r) => s + r.overdue, 0);

  return {
    title: `Дебіторка — ${repName}`,
    subtitle: `Сформовано ${dmy(today())}${overdueOnly ? " · лише прострочені" : ""}`,
    summary: [
      `Боржників: ${out.length}`,
      `борг: ${Math.round(total).toLocaleString("uk-UA")} грн`,
      `прострочено: ${Math.round(overdue).toLocaleString("uk-UA")} грн`,
    ],
    sheets: [
      {
        name: "Боржники",
        columns: [
          { key: "client", header: "Клієнт", width: 44 },
          { key: "code", header: "Код 1С", width: 12 },
          { key: "rep", header: "Торговий", width: 22 },
          { key: "repKind", header: "Тип торгового", width: 12 },
          { key: "debt", header: "Борг", kind: "money", width: 13 },
          { key: "overdue", header: "Прострочено", kind: "money", width: 13 },
          { key: "oldest", header: "Найстаріший, дн", kind: "int", width: 11 },
          { key: "payer", header: "Платник", width: 18 },
          { key: "lastDoc", header: "Останнє відвантаження", kind: "date", width: 14 },
        ],
        rows: out,
        tones: debtors.map((d) => (d.overdue > 0 && (d.oldestDays ?? 0) > 60 ? "urgent" : d.overdue > 0 ? "warn" : null)),
      },
    ],
    notes: [
      "Вік боргу відновлено з наших відвантажень: 1С строків оплати не передає, тому «прострочено» — оцінка.",
      "Тип торгового: польовий — їздить до клієнтів; офіс — виписує документи на себе; власник — бере клієнтів на себе.",
      ...(includeInternal ? [] : ["Свої рахунки (працівники, склади, ФОП торгових) не включено."]),
    ],
  };
}

/* ── ABC ─────────────────────────────────────────────────────────────── */

async function abc(ctx: ToolContext, args: Record<string, unknown>): Promise<Built> {
  const dimension = (args.dimension == null ? null : enumOf(args.dimension, "dimension", ["product", "brand", "client"] as const)) ?? "product";
  const basis = (args.basis == null ? null : enumOf(args.basis, "basis", ["amount", "profit"] as const)) ?? "amount";
  const period = hasPeriodArgs(args) ? checkedPeriod(ctx.today, args) : periodFromArgs(ctx.today, { days: 180 });
  const brand = await brandArg(args);
  if (isProblem(brand)) return brand;

  const report = await buildAbcReport(period.from, period.to, dimension, null, XLSX_MAX_ROWS, basis);
  const rows = report.rows
    .filter((r) => !brand || dimension !== "product" || r.brandName === brand.name)
    .map((r) => ({
      name: r.name,
      brand: r.brandName ?? "",
      amount: Math.round(r.amount),
      profit: Math.round(r.profit),
      margin: r.marginPct,
      qty: Math.round(r.qty),
      docs: r.docs,
      share: r.share,
      cum: r.cumShare,
      abc: r.abc,
      xyz: r.xyz ?? "",
    }));
  const label = { product: "товари", brand: "бренди", client: "клієнти" }[dimension];

  return {
    title: `ABC/XYZ — ${label}${brand ? ` · ${brand.name}` : ""}`,
    subtitle: `${period.label} · класи за ${basis === "profit" ? "валовим прибутком" : "оборотом"} · сформовано ${dmy(today())}`,
    summary: [`Рядків: ${rows.length}`, `A: ${rows.filter((r) => r.abc === "A").length}, B: ${rows.filter((r) => r.abc === "B").length}, C: ${rows.filter((r) => r.abc === "C").length}`],
    sheets: [
      {
        name: "ABC",
        columns: [
          { key: "name", header: "Назва", width: 50 },
          ...(dimension === "product" ? [{ key: "brand", header: "Бренд", width: 14 }] : []),
          { key: "amount", header: "Оборот", kind: "money", width: 13 },
          { key: "profit", header: "Прибуток", kind: "money", width: 13 },
          { key: "margin", header: "Маржа, %", kind: "percent", width: 9 },
          { key: "qty", header: "К-сть", kind: "int", width: 9 },
          { key: "docs", header: "Документів", kind: "int", width: 10 },
          { key: "share", header: "Частка, %", kind: "percent", width: 9 },
          { key: "cum", header: "Накопичено, %", kind: "percent", width: 11 },
          { key: "abc", header: "ABC", width: 6 },
          { key: "xyz", header: "XYZ", width: 6 },
        ],
        rows,
      },
    ],
    notes: [
      brand && dimension === "product" ? "Класи рахувались по всьому асортименту; бренд лише звузив список." : "",
      report.xyzAvailable ? "" : "XYZ не пораховано: у періоді замало місяців.",
    ].filter(Boolean),
  };
}

/* ── Довільний запит і готова таблиця ────────────────────────────────── */

function kindOf(values: unknown[]): ExportColumn["kind"] {
  const sample = values.filter((v) => v != null).slice(0, 50);
  if (sample.length && sample.every((v) => typeof v === "number")) {
    return sample.every((v) => Number.isInteger(v)) ? "int" : "decimal";
  }
  return "text";
}

async function sqlDataset(args: Record<string, unknown>): Promise<Built> {
  const sql = str(args.sql, "sql", { min: 10, max: 4000 });
  const result = await runReadOnlyQuery(sql, { maxRows: XLSX_MAX_ROWS, timeoutMs: 15_000 });
  if (!result.ok) return { помилка: `запит не виконався: ${result.error}`, ...(result.hint ? { підказка: result.hint } : {}) };
  if (result.rows.length === 0) return { помилка: "запит повернув 0 рядків — файл порожній, перевір фільтр" };

  const keys = Object.keys(result.rows[0]);
  const rows = result.rows.map((r) =>
    Object.fromEntries(keys.map((k) => [k, r[k] == null ? null : typeof r[k] === "number" ? (r[k] as number) : String(r[k])]))
  );
  const headers = Array.isArray(args.columns) ? (args.columns as unknown[]).map(String) : [];
  const title = typeof args.title === "string" && args.title.trim() ? str(args.title, "title", { max: 80 }) : "Вибірка з бази";

  return {
    title,
    subtitle: `Сформовано ${dmy(today())}${result.truncated ? ` · обрізано до ${XLSX_MAX_ROWS} рядків` : ""}`,
    summary: [`Рядків: ${rows.length}`],
    sheets: [
      {
        name: "Дані",
        columns: keys.map((k, i) => ({ key: k, header: headers[i] || k, kind: kindOf(rows.map((r) => r[k])), width: 16 })),
        rows,
      },
    ],
    notes: typeof args.note === "string" && args.note.trim() ? [str(args.note, "note", { max: 240 })] : [],
  };
}

function rowsDataset(args: Record<string, unknown>): Built {
  const headers = Array.isArray(args.columns) ? (args.columns as unknown[]).map((h) => String(h).slice(0, 40)) : [];
  const raw = Array.isArray(args.rows) ? (args.rows as unknown[]) : [];
  if (headers.length === 0 || headers.length > 12) throw new ToolArgError("columns: від 1 до 12 заголовків");
  if (raw.length === 0 || raw.length > 200) throw new ToolArgError("rows: від 1 до 200 рядків (довший перелік — dataset sql або готовий набір)");

  const keys = headers.map((_, i) => `c${i}`);
  const rows = raw.map((r) => {
    const cells = Array.isArray(r) ? r : [];
    return Object.fromEntries(
      keys.map((k, i) => {
        const v = cells[i];
        if (typeof v === "number" && Number.isFinite(v)) return [k, v];
        if (v == null || v === "") return [k, null];
        const text = String(v).trim();
        // «12300.5», «12 300,5» → число: у Excel воно має сумуватися, а не бути текстом.
        const compact = text.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
        return [k, /^-?\d+(\.\d+)?$/.test(compact) ? Number(compact) : text.slice(0, 300)];
      })
    );
  });
  const title = typeof args.title === "string" && args.title.trim() ? str(args.title, "title", { max: 80 }) : "Таблиця";

  return {
    title,
    subtitle: `Сформовано ${dmy(today())}`,
    summary: [`Рядків: ${rows.length}`],
    sheets: [{ name: "Таблиця", columns: keys.map((k, i) => ({ key: k, header: headers[i], kind: kindOf(rows.map((r) => r[k])) })), rows }],
    notes: typeof args.note === "string" && args.note.trim() ? [str(args.note, "note", { max: 240 })] : [],
  };
}

export async function buildDataset(ctx: ToolContext, name: DatasetName, args: Record<string, unknown>): Promise<Built> {
  switch (name) {
    case "order_proposal":
      return orderProposal(args);
    case "dead_stock":
      return deadStock(ctx, args);
    case "receivables":
      return receivables(args);
    case "abc":
      return abc(ctx, args);
    case "sql":
      return sqlDataset(args);
    case "rows":
      return rowsDataset(args);
  }
}
