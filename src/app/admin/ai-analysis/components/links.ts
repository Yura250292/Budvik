/**
 * Куди «провалюватись» із АІ-аналізу.
 *
 * Головна вимога до звіту — можливість перевірити кожну цифру: побачив
 * «SIGMA: 2,3 млн без руху» — натиснув і подивився, які саме позиції там
 * лежать. Без цього звіт лишається текстом, якому або віриш, або ні.
 *
 * Усі адреси ведуть на ЖИВІ сторінки з тим самим періодом. Числа там
 * можуть уже відрізнятися від звіту — у цьому й сенс: видно, що змінилося
 * від часу генерації.
 *
 * Посилання — звичайні <a href="/admin/...">. Ctrl/Cmd-клік і середня
 * кнопка автоматично відкривають вкладку застосунку: цим займається
 * LinkInterceptor у шелі адмінки, окремих обробників тут не треба.
 */

/** Бренд без прив'язки до 1С — у фактах ідентифікатора немає. */
export const NO_BRAND = "БЕЗ_БРЕНДУ";

/** Профіль торгового з тим самим періодом. */
export function repHref(repId: string, from: string, to: string): string {
  return `/admin/sales-analytics/${repId}?from=${from}&to=${to}`;
}

/** Клієнт на карті: пін розкривається карткою з останнім замовленням. */
export function clientHref(counterpartyId: string): string {
  return `/admin/sales-analytics?tab=clients&view=map&client=${counterpartyId}`;
}

/** Дебіторка торгового — список боржників із розкладкою за віком. */
export function receivablesHref(repId: string, from: string, to: string): string {
  return `/admin/sales-analytics?tab=clients&view=payers&rep=${repId}&from=${from}&to=${to}`;
}

/**
 * Оборотність складу, за потреби звужена до бренду.
 *
 * `days` — вікно швидкості (за ним визначається «рухається / стоїть»), а не
 * період звіту: склад живе своїм часом, і в фактах це підписано окремо.
 */
export function turnoverHref(brandId?: string | null, days = 90): string {
  const brand = brandId && brandId !== NO_BRAND ? `&brandId=${brandId}` : "";
  return `/admin/procurement/turnover?days=${days}${brand}`;
}

/** Закупівлі: дефіцит, за потреби по бренду. */
export function procurementHref(brandId?: string | null): string {
  return brandId && brandId !== NO_BRAND
    ? `/admin/procurement?brandId=${brandId}`
    : "/admin/procurement";
}

/** Картка товару в каталозі адмінки. */
export function productHref(productId: string): string {
  return `/admin/products?id=${productId}`;
}

/** Бренд у розрізі продажів — вкладка асортименту. */
export function brandHref(brandId: string, from: string, to: string): string {
  return brandId === NO_BRAND
    ? `/admin/sales-analytics?tab=overview&from=${from}&to=${to}`
    : `/admin/sales-analytics?tab=overview&brand=${brandId}&from=${from}&to=${to}`;
}

/** Зарплата й маршрутні листи водія. */
export function driverHref(driverId: string, from: string, to: string): string {
  return `/admin/drivers?tab=payroll&driver=${driverId}&from=${from}&to=${to}`;
}

/** Плани й виконання по команді за місяць. */
export function plansHref(month: string): string {
  return `/admin/sales-analytics?tab=kpi&view=plans&month=${month}`;
}
