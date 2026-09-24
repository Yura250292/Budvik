/**
 * Куди веде сповіщення в адмінці.
 *
 * Одна функція на дзвіночок у шапці й на стрічку /admin/feed. Раніше в
 * дзвіночка була своя розводка, яка про рядки стрічки торгового (REP_*) не
 * знала нічого і слала їх у картку продажу /admin/erp/sales/<relatedId>. Але
 * relatedId там різний: у задачі — id задачі, в оплаті — id клієнта, у нараді —
 * id наради. Людина тиснула на задачу й бачила порожній «Продаж — деталі» з
 * «Немає товарів». Перевірка: scripts/check-notification-href.mts.
 *
 * null — переходу немає: або нема куди (рахується для конкретного торгового,
 * і керівник побачив би порожнечу), або сторінка не для цієї ролі.
 *
 * Чистий модуль: без бази й без next/* — його імпортують клієнтські компоненти.
 */

import { REP_FEED_TYPES } from "@/lib/rep-feed/types";

type NotificationLike = { type: string; relatedId?: string | null };

export function adminNotificationHref(n: NotificationLike, isAdmin: boolean): string | null {
  // Переданий маршрут веде водія одразу в карту дня, а не в документ:
  // relatedId тут — id маршруту, і в /admin/erp/sales його нема чого шукати.
  if (n.type === "ROUTE_ASSIGNED") return "/driver/tablet";
  // Google Календар відпав: id немає, але вести треба туди, де перепідключають.
  if (n.type === "CALENDAR_RECONNECT") return "/admin/profile";

  if (!n.relatedId) return null;

  // Замовлення з сайту — це Order, а не SalesDocument. Без цієї гілки
  // сповіщення відкривало ERP-картку продажу, яка про роздріб не знає нічого.
  if (n.type === "NEW_ORDER" || n.type === "ORDER_STATUS") return `/admin/orders/${n.relatedId}`;

  if (n.type === REP_FEED_TYPES.REQUEST_DONE) return "/admin/requests";
  if (n.type === REP_FEED_TYPES.TASK || n.type === REP_FEED_TYPES.TASK_DONE) return "/admin/tasks";
  // Наради бачить лише ADMIN (MEETING_ROLES).
  if (n.type === REP_FEED_TYPES.MEETING) return isAdmin ? `/admin/meetings/${n.relatedId}` : null;
  // Картка клієнта живе в кабінеті торгового, куди пускають лише ADMIN.
  if (n.type === REP_FEED_TYPES.PAYMENT || n.type === REP_FEED_TYPES.VISIT) {
    return isAdmin ? `/sales/clients/${n.relatedId}` : null;
  }
  // Список дзвінків і сторінка приходу рахуються для конкретного торгового —
  // керівник відкрив би їх для себе й побачив порожнечу.
  if (
    n.type === REP_FEED_TYPES.CALL_LIST ||
    n.type === REP_FEED_TYPES.ARRIVAL ||
    n.type === REP_FEED_TYPES.WATCH ||
    n.type === REP_FEED_TYPES.PRICE_UP ||
    n.type === REP_FEED_TYPES.WEEK
  ) {
    return null;
  }

  // Решта (WHOLESALE_ORDER_REQUEST, SALES_DOC_CONFIRMED, документи зі стрічки)
  // кладуть у relatedId id документа продажу.
  return `/admin/erp/sales/${n.relatedId}`;
}
