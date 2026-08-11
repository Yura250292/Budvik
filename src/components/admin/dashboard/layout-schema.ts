import type { AdminRole } from "@/lib/admin-nav";

/**
 * Розміри віджетів — пресети колонок/рядків 12-колонкової сітки,
 * а не довільний піксельний ресайз: розкладка лишається охайною
 * на будь-якій ширині й переживає зміну екрана.
 */
export const WIDGET_SIZES = ["1x1", "2x1", "2x2", "3x1", "4x1", "4x2"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export type WidgetType =
  // Аналітика торгових — «Зведена»
  | "sales-totals"
  | "plan-attainment"
  | "money"
  | "top-reps"
  | "overdue-reps"
  // Аналітика торгових — «Огляд»
  | "revenue-timeline"
  | "brands"
  | "top-clients"
  | "top-products"
  // Звіти зі складу
  | "warehouse-totals"
  | "warehouse-shifts"
  | "warehouse-productivity"
  | "warehouse-nomenclature"
  // Магазин (сайт)
  | "stat-orders"
  | "stat-products"
  | "stat-clients"
  | "stat-wholesale"
  | "recent-orders"
  // Інструменти — не дані компанії, а те, що зручно мати під рукою
  | "weather"
  | "weather-forecast"
  | "currency"
  | "calculator"
  | "notes"
  | "clock"
  | "quick-actions";

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

/**
 * Дефолтні розкладки.
 *
 * Порядок — за тим, як на цифри дивляться в житті: спершу гроші періоду
 * («скільки продали, скільки зібрали, що з планом»), потім хто саме тягне
 * і де горить дебіторка, далі динаміка й асортимент, наприкінці склад.
 * Замовлення з сайту — внизу: їх мало, і це не щоденна робота.
 */
const MANAGER_LAYOUT: WidgetInstance[] = [
  { id: "w-sales", type: "sales-totals", size: "4x1", order: 0 },
  { id: "w-plan", type: "plan-attainment", size: "2x1", order: 1 },
  { id: "w-money", type: "money", size: "2x1", order: 2 },
  { id: "w-reps", type: "top-reps", size: "2x2", order: 3 },
  { id: "w-overdue", type: "overdue-reps", size: "2x2", order: 4 },
  { id: "w-timeline", type: "revenue-timeline", size: "4x2", order: 5 },
  { id: "w-brands", type: "brands", size: "2x2", order: 6 },
  { id: "w-clients", type: "top-clients", size: "2x2", order: 7 },
  { id: "w-wh-totals", type: "warehouse-totals", size: "4x1", order: 8 },
  { id: "w-wh-shifts", type: "warehouse-shifts", size: "2x1", order: 9 },
  { id: "w-wh-prod", type: "warehouse-productivity", size: "2x2", order: 10 },
  // Інструменти — в кінці: корисні щодня, але це не цифри бізнесу.
  { id: "w-weather", type: "weather", size: "2x1", order: 11 },
  { id: "w-currency", type: "currency", size: "2x1", order: 12 },
  { id: "w-notes", type: "notes", size: "2x2", order: 13 },
];

export const DEFAULT_LAYOUTS: Record<AdminRole, WidgetInstance[]> = {
  ADMIN: MANAGER_LAYOUT,
  MANAGER: MANAGER_LAYOUT,
  // Торговий бачить лише власні дані (API сам скоупить його до scope: "own"),
  // тож рейтинги колег і склад сюди не потрапляють.
  SALES: [
    { id: "w-sales", type: "sales-totals", size: "4x1", order: 0 },
    { id: "w-plan", type: "plan-attainment", size: "2x1", order: 1 },
    { id: "w-money", type: "money", size: "2x1", order: 2 },
    { id: "w-timeline", type: "revenue-timeline", size: "4x2", order: 3 },
    { id: "w-clients", type: "top-clients", size: "2x2", order: 4 },
    { id: "w-products", type: "top-products", size: "2x2", order: 5 },
    // Торговий у роз'їздах: погода й курс потрібні йому навіть частіше.
    { id: "w-weather", type: "weather", size: "2x1", order: 6 },
    { id: "w-currency", type: "currency", size: "2x1", order: 7 },
    { id: "w-notes", type: "notes", size: "2x2", order: 8 },
  ],
};

export function defaultLayout(role: AdminRole): DashboardLayout {
  return { version: LAYOUT_VERSION, widgets: DEFAULT_LAYOUTS[role].map((w) => ({ ...w })) };
}
