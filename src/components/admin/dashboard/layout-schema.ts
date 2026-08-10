import type { AdminRole } from "@/lib/admin-nav";

/**
 * Розміри віджетів — пресети колонок/рядків 12-колонкової сітки,
 * а не довільний піксельний ресайз: розкладка лишається охайною
 * на будь-якій ширині й переживає зміну екрана.
 */
export const WIDGET_SIZES = ["1x1", "2x1", "2x2", "3x1", "4x1", "4x2"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export type WidgetType =
  | "stat-orders"
  | "stat-products"
  | "stat-clients"
  | "stat-wholesale"
  | "recent-orders"
  | "sales-summary"
  | "revenue-chart";

export type WidgetInstance = {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  order: number;
};

export type DashboardLayout = {
  version: 1;
  widgets: WidgetInstance[];
};

export const LAYOUT_VERSION = 1 as const;
export const MAX_WIDGETS = 20;

/** Кількість колонок/рядків, які займає віджет. */
export function sizeToSpan(size: WidgetSize): { cols: number; rows: number } {
  const [cols, rows] = size.split("x").map(Number);
  return { cols: cols * 3, rows };
}

/** CSS-класи для 12-колонкової сітки. Мобільно все зводиться до 2 колонок. */
export function sizeToClass(size: WidgetSize): string {
  const { cols, rows } = sizeToSpan(size);
  const colClass =
    { 3: "md:col-span-3", 6: "md:col-span-6", 9: "md:col-span-9", 12: "md:col-span-12" }[cols] ?? "md:col-span-3";
  const rowClass = rows === 2 ? "md:row-span-2" : "md:row-span-1";
  // Дрібні віджети на телефоні — по одному в ряд, широкі — на всю ширину.
  const mobileClass = cols >= 9 ? "col-span-2" : "col-span-1";
  return `${mobileClass} ${colClass} ${rowClass}`;
}

export const DEFAULT_LAYOUTS: Record<AdminRole, WidgetInstance[]> = {
  ADMIN: [
    { id: "w-orders", type: "stat-orders", size: "1x1", order: 0 },
    { id: "w-products", type: "stat-products", size: "1x1", order: 1 },
    { id: "w-clients", type: "stat-clients", size: "1x1", order: 2 },
    { id: "w-wholesale", type: "stat-wholesale", size: "1x1", order: 3 },
    { id: "w-summary", type: "sales-summary", size: "2x1", order: 4 },
    { id: "w-recent", type: "recent-orders", size: "2x2", order: 5 },
    { id: "w-revenue", type: "revenue-chart", size: "4x1", order: 6 },
  ],
  MANAGER: [
    { id: "w-orders", type: "stat-orders", size: "1x1", order: 0 },
    { id: "w-products", type: "stat-products", size: "1x1", order: 1 },
    { id: "w-clients", type: "stat-clients", size: "1x1", order: 2 },
    { id: "w-wholesale", type: "stat-wholesale", size: "1x1", order: 3 },
    { id: "w-summary", type: "sales-summary", size: "2x1", order: 4 },
    { id: "w-recent", type: "recent-orders", size: "2x2", order: 5 },
    { id: "w-revenue", type: "revenue-chart", size: "4x1", order: 6 },
  ],
  // Торговому не даємо «Товари»: /admin/products для нього закритий
  // middleware, і плитка вела б у редирект.
  SALES: [
    { id: "w-orders", type: "stat-orders", size: "1x1", order: 0 },
    { id: "w-summary", type: "sales-summary", size: "2x1", order: 1 },
    { id: "w-recent", type: "recent-orders", size: "2x2", order: 2 },
  ],
};

export function defaultLayout(role: AdminRole): DashboardLayout {
  return { version: LAYOUT_VERSION, widgets: DEFAULT_LAYOUTS[role].map((w) => ({ ...w })) };
}
