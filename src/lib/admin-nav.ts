import type { IconKey } from "@/components/admin/icons";

/**
 * Єдине джерело навігації адмінки: меню сайдбару, ролі, хлібні крихти.
 *
 * Ролі тут — шар видимості. Enforcement лишається в src/middleware.ts:
 * якщо міняєте roles нижче, синхронізуйте перелік блокувань SALES там.
 */

export type AdminRole = "ADMIN" | "MANAGER" | "SALES";

export type NavItem = {
  href: string;
  title: string;
  desc?: string;
  iconKey: IconKey;
  roles: AdminRole[];
};

export type NavGroup = {
  id: string;
  title: string;
  collapsedByDefault?: boolean;
  items: NavItem[];
};

const ALL: AdminRole[] = ["ADMIN", "MANAGER", "SALES"];
const AM: AdminRole[] = ["ADMIN", "MANAGER"];

export const TOP_ITEMS: NavItem[] = [
  { href: "/admin", title: "Дашборд", iconKey: "dashboard", roles: ALL },
  { href: "/admin/orders", title: "Замовлення", desc: "Усі замовлення", iconKey: "orders", roles: ALL },
  { href: "/admin/products", title: "Товари", desc: "Каталог", iconKey: "products", roles: AM },
  { href: "/admin/users", title: "Клієнти", desc: "База клієнтів", iconKey: "clients", roles: AM },
  { href: "/admin/wholesale", title: "Оптовики", desc: "Заявки та акаунти", iconKey: "wholesale", roles: AM },
  { href: "/admin/sales", title: "Торгові", desc: "Акаунти торгових", iconKey: "sales", roles: AM },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "sales-docs",
    title: "Продажі та документи",
    items: [
      { href: "/admin/erp/counterparties", title: "Контрагенти", desc: "Постачальники та покупці", iconKey: "counterparties", roles: ALL },
      { href: "/admin/erp/purchase-orders", title: "Прихід", desc: "Прихідні накладні", iconKey: "purchase", roles: ALL },
      { href: "/admin/erp/sales", title: "Продаж", desc: "Документи B2B/оффлайн", iconKey: "money", roles: ALL },
      { href: "/admin/erp/invoices", title: "Видаткові накладні", desc: "Генерація та оплати", iconKey: "invoice", roles: AM },
      { href: "/admin/erp/promotions", title: "Акції", desc: "Знижки, кешбек, об'ємні ціни", iconKey: "promo", roles: AM },
    ],
  },
  {
    id: "analytics",
    title: "Аналітика та звіти",
    items: [
      { href: "/admin/analytics", title: "Аналітика", desc: "Замовлення, оборот, платежі, бонуси", iconKey: "chart", roles: AM },
      { href: "/admin/sales-analytics", title: "Аналітика торгових", desc: "Продажі, КПІ, маршрути, паливо", iconKey: "chart", roles: ALL },
      { href: "/admin/reports", title: "Звіти", desc: "Склад і торгові представники", iconKey: "report", roles: AM },
      { href: "/admin/sales-reports", title: "Звіти торгових", desc: "Деталізація по представниках", iconKey: "report", roles: AM },
      { href: "/admin/warehouse-reports", title: "Звіти складу", desc: "Рухи та залишки", iconKey: "report", roles: AM },
      { href: "/admin/erp/reports", title: "ERP-звіти", desc: "Документообіг", iconKey: "report", roles: AM },
      { href: "/admin/erp/stats", title: "ERP-статистика", desc: "Зведені показники", iconKey: "chart", roles: AM },
    ],
  },
  {
    id: "logistics",
    title: "Логістика та склад",
    items: [
      { href: "/admin/erp/delivery-routes", title: "Маршрути доставки", desc: "Шляхові листи для водіїв", iconKey: "truck", roles: AM },
      { href: "/admin/erp/route-planner", title: "Планувальник маршрутів", desc: "Побудова маршруту на карті", iconKey: "truck", roles: AM },
      { href: "/admin/stock-locations", title: "Склади та залишки", desc: "Управління складами", iconKey: "warehouse", roles: AM },
      { href: "/admin/client-folders", title: "Папки клієнтів", desc: "Шаблони напрямків для торгових", iconKey: "folder", roles: AM },
    ],
  },
  {
    id: "team",
    title: "Команда",
    items: [
      { href: "/admin/sales-reps", title: "Торгові представники", desc: "Регіони, клієнти, категорії", iconKey: "team", roles: AM },
      { href: "/admin/erp/commissions", title: "Мотивація", desc: "Комісії менеджерів", iconKey: "star", roles: AM },
      { href: "/admin/erp/commissions/rates", title: "Ставки комісій", desc: "Налаштування відсотків", iconKey: "star", roles: AM },
    ],
  },
  {
    id: "tools",
    title: "Дані та інструменти",
    collapsedByDefault: true,
    items: [
      { href: "/admin/erp/sync", title: "Синхронізація 1С", desc: "Порівняння з базою, розбіжності", iconKey: "sync", roles: AM },
      { href: "/admin/erp/scan", title: "AI Сканер", desc: "Фото → документ", iconKey: "camera", roles: ALL },
      { href: "/admin/erp/import", title: "Імпорт", desc: "Завантаження даних", iconKey: "import", roles: ALL },
      { href: "/admin/erp/images", title: "Зображення", desc: "Парсинг та AI-пошук фото", iconKey: "image", roles: AM },
      { href: "/admin/erp/price-check", title: "Моніторинг цін", desc: "AI аналіз цін конкурентів", iconKey: "price", roles: AM },
      { href: "/admin/erp/seasonal", title: "Сезонні товари", desc: "Рекомендації по порі року", iconKey: "seasonal", roles: AM },
      { href: "/admin/integration", title: "Інтеграції", desc: "Зовнішні сервіси", iconKey: "plug", roles: AM },
    ],
  },
];

/** Плоский список усіх пунктів — для пошуку заголовків, іконок і перевірки доступу. */
export const ALL_NAV_ITEMS: NavItem[] = [...TOP_ITEMS, ...NAV_GROUPS.flatMap((g) => g.items)];

/**
 * Заголовки для хлібних крихт. Ключ — сегмент шляху після /admin.
 * Динамічні сегменти ([id]) підставляються як «Деталі».
 */
export const BREADCRUMB_MAP: Record<string, string> = {
  "/admin": "Дашборд",
  ...Object.fromEntries(ALL_NAV_ITEMS.map((i) => [i.href, i.title])),
  "/admin/erp": "ERP",
};

export function isAdminRole(role: unknown): role is AdminRole {
  return role === "ADMIN" || role === "MANAGER" || role === "SALES";
}

/** Пункт навігації, що найточніше (найдовший префікс) відповідає шляху. */
export function findNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ALL_NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(item.href + "/")) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best;
}

/**
 * Чи має роль доступ до шляху. Дзеркалить перелік блокувань SALES
 * у src/middleware.ts — використовується сайдбаром і перехопленням
 * кліків, щоб торговий не відкривав вкладку, яку middleware відіб'є.
 */
export function canAccess(pathname: string, role: AdminRole): boolean {
  if (role === "ADMIN" || role === "MANAGER") return true;
  const item = findNavItem(pathname);
  if (item) return item.roles.includes(role);
  // Невідомий маршрут: віддаємо рішення middleware, але блокуємо явні
  // заборони для SALES, щоб не плодити вкладки-редиректи.
  const blocked = [
    "/admin/products",
    "/admin/users",
    "/admin/sales/",
    "/admin/sales-reports",
    "/admin/sales-reps",
    "/admin/reports",
    "/admin/erp/reports",
    "/admin/erp/stats",
    "/admin/warehouse-reports",
    "/admin/integration",
  ];
  if (pathname === "/admin/sales") return false;
  return !blocked.some((p) => pathname.startsWith(p));
}

/** Заголовок сторінки для вкладки / крихт. */
export function titleForPath(pathname: string): string {
  if (BREADCRUMB_MAP[pathname]) return BREADCRUMB_MAP[pathname];
  const item = findNavItem(pathname);
  if (item) {
    // Глибша сторінка всередині розділу (картка документа тощо).
    return pathname === item.href ? item.title : `${item.title} — деталі`;
  }
  const last = pathname.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last) : "Адмінка";
}

export function iconForPath(pathname: string): IconKey {
  return findNavItem(pathname)?.iconKey ?? "page";
}

export type Crumb = { href: string; title: string };

/** Хлібні крихти: Дашборд → Розділ → (Деталі). */
export function buildCrumbs(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ href: "/admin", title: "Дашборд" }];
  if (pathname === "/admin") return crumbs;

  const item = findNavItem(pathname);
  if (item && item.href !== "/admin") {
    const group = NAV_GROUPS.find((g) => g.items.some((i) => i.href === item.href));
    if (group) crumbs.push({ href: item.href, title: group.title });
    crumbs.push({ href: item.href, title: item.title });
    if (pathname !== item.href) {
      crumbs.push({ href: pathname, title: "Деталі" });
    }
    return crumbs;
  }

  // Маршрут поза меню — показуємо сегменти як є.
  const segments = pathname.replace(/^\/admin\/?/, "").split("/").filter(Boolean);
  let acc = "/admin";
  for (const seg of segments) {
    acc += `/${seg}`;
    crumbs.push({ href: acc, title: BREADCRUMB_MAP[acc] ?? decodeURIComponent(seg) });
  }
  return crumbs;
}
