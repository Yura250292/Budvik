/**
 * Власні блоки у відповіді помічника: діаграма, плитки, дерево, файл, маршрут.
 *
 * Формат — звичайний огороджений блок маркдауна з JSON усередині:
 *
 *   ```budvik-chart
 *   {"type":"column","title":"Оборот по місяцях","unit":"₴", …}
 *   ```
 *
 * Чому так, а не окремим полем відповіді. Відповідь лишається ОДНИМ
 * маркдауном: модель пише блок так само, як таблицю, код складає його
 * тим самим рядком, історія, пересилання в чат персоналу й голосове
 * читання працюють без змін, а кабінет замість сірого коду малює
 * картинку. Там, де малювати нікому (Telegram, стара версія кабінету),
 * блок читається як службовий і нічого не ламає.
 *
 * Файл спільний для сервера й браузера — тому без Prisma й без React.
 * Сервер тут бере шаблони для кодових відповідей і заглушки для історії,
 * браузер — розбір і перевірку перед малюванням.
 *
 * ПЕРЕВІРКА — ЛАСКАВА. Модель інколи дає на одне значення менше чи більше,
 * ніж підписів; малювати таку діаграму краще, ніж показати помилку. Тому
 * довжини вирівнюються (зайве відрізається, бракуюче стає порожнім), а
 * відмовляємо лише тоді, коли малювати нема з чого.
 */

export const BLOCK = {
  chart: "budvik-chart",
  kpi: "budvik-kpi",
  tree: "budvik-tree",
  file: "budvik-file",
  route: "budvik-route",
} as const;

export type BlockKind = keyof typeof BLOCK;

/* ── Діаграма ────────────────────────────────────────────────────────── */

/**
 * bar — горизонтальні смуги: рейтинги, бренди, торгові (довгі назви).
 * column — стовпчики: місяці, тижні, небагато періодів.
 * line — тренд у часі, до чотирьох ліній.
 * scatter — звʼязок двох показників: кожна точка — товар, клієнт чи торговий.
 *
 * Двох осей Y немає свідомо: два показники різного масштабу на одній
 * картинці вигадують кореляцію, якої в даних немає. Такі речі — двома
 * діаграмами поспіль.
 */
export type ChartType = "bar" | "column" | "line" | "scatter";

export type ChartSpec = {
  type: ChartType;
  title: string;
  /** Одиниця значень: «₴», «шт», «%», «дн» або порожньо. */
  unit: string;
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
  points: Array<{ label: string; x: number; y: number }>;
  xLabel?: string;
  yLabel?: string;
  /** Одиниця осі X — лише для scatter. */
  xUnit?: string;
  /** Одне речення під діаграмою: звідки дані, що не враховано. */
  note?: string;
};

export const CHART_LIMITS = { categories: 24, series: 4, points: 60, title: 100, label: 60 };

/* ── Плитки ─────────────────────────────────────────────────────────── */

export type Tone = "good" | "bad" | "neutral";

export type KpiSpec = {
  items: Array<{
    label: string;
    /** Уже відформатоване: «7,7 млн ₴», «1 618», «58,6 %». */
    value: string;
    /** «+37 % до попередніх 60 днів» — зі знаком і з тим, до чого порівнюємо. */
    delta?: string;
    tone?: Tone;
    hint?: string;
  }>;
};

export const KPI_LIMIT = 4;

/* ── Дерево «що від чого залежить» ──────────────────────────────────── */

/**
 * Дерево показників: зверху результат, нижче — з чого він складається
 * або чим пояснюється. «Оборот ← клієнти × частота × середній чек»,
 * «падіння ← пішли 3 клієнти Кулика ← …».
 *
 * Дерево, а не довільна блок-схема: для питання «чому» керівникові
 * потрібен ланцюжок причин із числами біля кожної, і на телефоні він
 * читається зверху вниз без горизонтальної прокрутки.
 */
export type TreeNode = {
  label: string;
  value?: string;
  delta?: string;
  tone?: Tone;
  children?: TreeNode[];
};

export type TreeSpec = { title: string; root: TreeNode; note?: string };

export const TREE_LIMITS = { depth: 4, nodes: 25 };

/* ── Файл ───────────────────────────────────────────────────────────── */

export type FileSpec = {
  url: string;
  name: string;
  format: "xlsx" | "xlsx_1c" | "pdf";
  rows: number;
  sizeKb: number;
};

/* ── Розбір ─────────────────────────────────────────────────────────── */

export type Parsed<T> = { ok: true; spec: T } | { ok: false; error: string };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[\s  ]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const tone = (v: unknown): Tone | undefined => (v === "good" || v === "bad" || v === "neutral" ? v : undefined);

function json(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw.trim()) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseChart(raw: string): Parsed<ChartSpec> {
  const o = json(raw);
  if (!o) return { ok: false, error: "діаграма: не JSON" };

  const type = o.type as ChartType;
  if (!["bar", "column", "line", "scatter"].includes(type)) return { ok: false, error: "діаграма: невідомий тип" };

  const spec: ChartSpec = {
    type,
    title: str(o.title, CHART_LIMITS.title) || "Діаграма",
    unit: str(o.unit, 8),
    categories: [],
    series: [],
    points: [],
    xLabel: str(o.xLabel, CHART_LIMITS.label) || undefined,
    yLabel: str(o.yLabel, CHART_LIMITS.label) || undefined,
    xUnit: str(o.xUnit, 8) || undefined,
    note: str(o.note, 240) || undefined,
  };

  if (type === "scatter") {
    const points = Array.isArray(o.points) ? o.points : [];
    for (const p of points.slice(0, CHART_LIMITS.points)) {
      const r = p as Record<string, unknown>;
      const x = num(r?.x);
      const y = num(r?.y);
      if (x == null || y == null) continue;
      spec.points.push({ label: str(r.label, CHART_LIMITS.label) || "—", x, y });
    }
    return spec.points.length >= 2 ? { ok: true, spec } : { ok: false, error: "діаграма: замало точок" };
  }

  spec.categories = (Array.isArray(o.categories) ? o.categories : [])
    .slice(0, CHART_LIMITS.categories)
    .map((c) => (typeof c === "number" ? String(c) : str(c, CHART_LIMITS.label)));
  const n = spec.categories.length;
  if (n === 0) return { ok: false, error: "діаграма: немає підписів" };

  const series = Array.isArray(o.series) ? o.series : [];
  for (const s of series.slice(0, CHART_LIMITS.series)) {
    const r = s as Record<string, unknown>;
    const values = (Array.isArray(r?.values) ? r.values : []).slice(0, n).map(num);
    while (values.length < n) values.push(null);
    if (values.every((v) => v == null)) continue;
    spec.series.push({ name: str(r.name, CHART_LIMITS.label) || spec.title, values });
  }
  if (spec.series.length === 0) return { ok: false, error: "діаграма: немає значень" };
  if (type === "line" && n < 2) return { ok: false, error: "діаграма: для лінії потрібно ≥ 2 точки" };
  return { ok: true, spec };
}

export function parseKpi(raw: string): Parsed<KpiSpec> {
  const o = json(raw);
  const items = Array.isArray(o?.items) ? (o!.items as unknown[]) : [];
  const spec: KpiSpec = {
    items: items
      .slice(0, KPI_LIMIT)
      .map((i) => i as Record<string, unknown>)
      .map((i) => ({
        label: str(i?.label, 40),
        value: typeof i?.value === "number" ? String(i.value) : str(i?.value, 24),
        delta: str(i?.delta, 48) || undefined,
        tone: tone(i?.tone),
        hint: str(i?.hint, 60) || undefined,
      }))
      .filter((i) => i.label && i.value),
  };
  return spec.items.length > 0 ? { ok: true, spec } : { ok: false, error: "плитки: порожньо" };
}

export function parseTree(raw: string): Parsed<TreeSpec> {
  const o = json(raw);
  if (!o) return { ok: false, error: "дерево: не JSON" };
  let budget = TREE_LIMITS.nodes;

  const node = (v: unknown, depth: number): TreeNode | null => {
    const r = v as Record<string, unknown> | null;
    const label = str(r?.label, 80);
    if (!r || !label || budget <= 0) return null;
    budget--;
    const children =
      depth < TREE_LIMITS.depth && Array.isArray(r.children)
        ? r.children.map((c) => node(c, depth + 1)).filter((c): c is TreeNode => c != null)
        : [];
    return {
      label,
      value: typeof r.value === "number" ? String(r.value) : str(r.value, 24) || undefined,
      delta: str(r.delta, 48) || undefined,
      tone: tone(r.tone),
      ...(children.length ? { children } : {}),
    };
  };

  const root = node(o.root, 1);
  if (!root) return { ok: false, error: "дерево: немає кореня" };
  return { ok: true, spec: { title: str(o.title, CHART_LIMITS.title) || root.label, root, note: str(o.note, 240) || undefined } };
}

export function parseFile(raw: string): Parsed<FileSpec> {
  const o = json(raw);
  const url = str(o?.url, 300);
  const format = o?.format;
  if (!url.startsWith("/api/") || !(format === "xlsx" || format === "xlsx_1c" || format === "pdf")) {
    return { ok: false, error: "файл: неповні дані" };
  }
  return {
    ok: true,
    spec: {
      url,
      name: str(o?.name, 120) || "файл",
      format,
      rows: num(o?.rows) ?? 0,
      sizeKb: num(o?.sizeKb) ?? 0,
    },
  };
}

/* ── Складання й історія ─────────────────────────────────────────────── */

/** Блок як рядок маркдауна — для кодових відповідей. */
export function block(kind: BlockKind, payload: unknown): string {
  return ["```" + BLOCK[kind], JSON.stringify(payload), "```"].join("\n");
}

const ANY_BLOCK_RE = /```(budvik-(?:chart|kpi|tree|file|route))\s*\n([\s\S]*?)```/g;

const compactValue = (v: number | null): string => {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(".", ",")} млн`;
  if (a >= 10_000) return `${Math.round(v / 1000)} тис`;
  return String(Math.round(v * 10) / 10).replace(".", ",");
};

/**
 * Блоки в історії для моделі — короткими словами замість JSON.
 *
 * Координати маршруту чи сотня значень діаграми з'їдали б місце в КОЖНОМУ
 * наступному раунді, а моделі з них потрібно одне: що вона вже показала.
 * Тому діаграма стає назвою й короткими числами, плитки — «підпис: число»,
 * файл — назвою. Цього досить, щоб на «а скільки було в березні?» чи
 * «зроби це в PDF» модель знала, про що мова.
 */
export function blocksForHistory(content: string): string {
  return content.replace(ANY_BLOCK_RE, (_all, lang: string, body: string) => {
    if (lang === BLOCK.route) return "(маршрут показано списком у кабінеті)";

    if (lang === BLOCK.chart) {
      const p = parseChart(body);
      if (!p.ok) return "(діаграма в кабінеті)";
      const s = p.spec;
      const data =
        s.type === "scatter"
          ? s.points.slice(0, 8).map((pt) => `${pt.label} ${compactValue(pt.x)}/${compactValue(pt.y)}`)
          : s.series.map((ser) => `${ser.name}: ${s.categories.map((c, i) => `${c} ${compactValue(ser.values[i])}`).join(", ")}`);
      return `(діаграма «${s.title}»${s.unit ? `, ${s.unit}` : ""} — ${data.join("; ").slice(0, 400)})`;
    }

    if (lang === BLOCK.kpi) {
      const p = parseKpi(body);
      return p.ok ? `(плитки: ${p.spec.items.map((i) => `${i.label} ${i.value}`).join("; ")})` : "(плитки в кабінеті)";
    }

    if (lang === BLOCK.tree) {
      const p = parseTree(body);
      if (!p.ok) return "(схема в кабінеті)";
      const line = (n: TreeNode): string =>
        `${n.label}${n.value ? ` ${n.value}` : ""}${n.children ? ` ← ${n.children.map(line).join(", ")}` : ""}`;
      return `(схема «${p.spec.title}»: ${line(p.spec.root).slice(0, 400)})`;
    }

    const p = parseFile(body);
    return p.ok ? `(файл «${p.spec.name}» уже сформовано й показано в кабінеті)` : "(файл у кабінеті)";
  });
}

/** Текст без блоків — для числового вартового й підрахунку «чи є текст». */
export function withoutBlocks(content: string): string {
  return content.replace(ANY_BLOCK_RE, "");
}

/** Усі блоки діаграм і плиток як текст із числами — для окремої перевірки. */
export function blockNumbersText(content: string): string {
  const out: string[] = [];
  for (const m of content.matchAll(ANY_BLOCK_RE)) {
    if (m[1] === BLOCK.chart) {
      const p = parseChart(m[2]);
      if (!p.ok) continue;
      for (const s of p.spec.series) out.push(s.values.filter((v) => v != null).join(" "));
      for (const pt of p.spec.points) out.push(`${pt.x} ${pt.y}`);
    }
  }
  return out.join(" ");
}
