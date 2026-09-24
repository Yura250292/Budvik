/**
 * Куди веде сповіщення в адмінці — дзвіночок і стрічка однаково.
 *
 * Дзвіночок мав власну розводку й усе незнайоме слав у картку продажу
 * /admin/erp/sales/<relatedId>. Для задач там id задачі, для оплат — id
 * клієнта, і людина бачила порожній «Продаж — деталі». Тепер обидва місця
 * беруть одну функцію, і ця проба тримає її чесною.
 *
 *   npx tsx scripts/check-notification-href.mts
 *
 * Бази не торкається.
 */

import { adminNotificationHref } from "../src/lib/notifications/href";

const fails: string[] = [];
function check(name: string, got: string | null, want: string | null) {
  const ok = got === want;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${got}${ok ? "" : ` (чекали ${want})`}`);
  if (!ok) fails.push(name);
}

const n = (type: string, relatedId: string | null = "x1") => ({ type, relatedId });

// Саме той випадок, що ламався: задача, призначена собі.
check("нова задача — у задачі, не в продаж", adminNotificationHref(n("REP_TASK"), true), "/admin/tasks");
check("виконана задача — теж у задачі", adminNotificationHref(n("REP_TASK_DONE"), true), "/admin/tasks");
check("нарада — у нараду", adminNotificationHref(n("REP_MEETING"), true), "/admin/meetings/x1");
check("оплата — у картку клієнта", adminNotificationHref(n("REP_PAYMENT"), true), "/sales/clients/x1");
check("нарада менеджеру — без переходу", adminNotificationHref(n("REP_MEETING"), false), null);

// Те, що працювало, лишається як було.
check("замовлення з сайту", adminNotificationHref(n("NEW_ORDER"), true), "/admin/orders/x1");
check("статус замовлення", adminNotificationHref(n("ORDER_STATUS"), true), "/admin/orders/x1");
check("заявка на опт — документ продажу", adminNotificationHref(n("WHOLESALE_ORDER_REQUEST"), true), "/admin/erp/sales/x1");
check("маршрут водію", adminNotificationHref(n("ROUTE_ASSIGNED"), true), "/driver/tablet");

// Календар: id немає, але треба вести туди, де перепідключають.
check("календар відпав — у профіль", adminNotificationHref(n("CALENDAR_RECONNECT", null), true), "/admin/profile");
check("без id і невідомий тип — нікуди", adminNotificationHref(n("SOMETHING", null), true), null);

console.log();
if (fails.length > 0) {
  console.log(`✖ провалено ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("✔ усе зійшлося");
