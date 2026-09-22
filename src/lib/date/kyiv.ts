/**
 * Робота з київською добою на сервері, який працює в UTC.
 *
 * Наївний setHours(0,0,0,0) дав би опівніч UTC — і між 00:00 та 03:00 за
 * Києвом звіти показували б учорашні дані. Ці хелпери рахують межі доби
 * з урахуванням літнього/зимового часу.
 *
 * Логіка DST занадто тонка, щоб жити у двох копіях: її вже фіксили
 * комітами 9e33aad («групування та фільтри дат за київським часом») і
 * 9033bc7 («нічні накладні зникали з фільтра періоду»).
 */

export const KYIV_TZ = "Europe/Kyiv";

/**
 * Мітка часу з бази як київський настінний час — фрагмент SQL.
 *
 * Пастка, на якій ловився кожен запит з `AT TIME ZONE 'Europe/Kyiv'`:
 * колонки Prisma мають тип `timestamp WITHOUT time zone`, а в них лежить
 * UTC. Postgres же трактує один `AT TIME ZONE 'Europe/Kyiv'` над таким
 * значенням як «це київський час, переведи його в timestamptz» — і час
 * їде на 3 години НАЗАД замість вперед. Доба тоді починається о 03:00,
 * і все, що сталося з півночі до третьої, лічиться вчорашнім.
 *
 * Тому спершу оголошуємо пояс збереженого значення ('UTC'), і лише потім
 * переводимо в київський. Один фрагмент на всю аналітику, щоб правило не
 * жило у двадцяти запитах окремими копіями.
 *
 * Мітки, що приїхали з 1С (SalesDocument.createdAt, Payment.paidAt), — це
 * київський настінний час, записаний як UTC. Для них конверсія теж потрібна:
 * межі періоду рахує kyivDayStart/kyivDayEnd, тобто той самий UTC-момент, і
 * групування має говорити з фільтром однією мовою. Ціна — документи, оформлені
 * після 21:00 (одиниці на тисячу), лягають у наступну добу; те саме
 * компромісне правило вже діє в помічнику (query-views.ts, KYIV_DAY).
 */
export function kyivTsSql(column: string): string {
  return `((${column}) AT TIME ZONE 'UTC' AT TIME ZONE '${KYIV_TZ}')`;
}

/** Київська дата (::date) з мітки — той самий фрагмент, готовий для GROUP BY. */
export function kyivDaySql(column: string): string {
  return `${kyivTsSql(column)}::date`;
}

/** Дата у форматі YYYY-MM-DD за київським часом. */
export function kyivDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/** Зсув Києва відносно UTC у мілісекундах на конкретний момент (враховує DST). */
export function kyivOffsetMs(at: Date): number {
  const kyiv = new Date(at.toLocaleString("en-US", { timeZone: KYIV_TZ }));
  const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  return kyiv.getTime() - utc.getTime();
}

/** "2026-08-07" → момент 00:00:00 за Києвом, у UTC. */
export function kyivDayStart(day: string): Date {
  const asUtc = new Date(`${day}T00:00:00Z`);
  return new Date(asUtc.getTime() - kyivOffsetMs(asUtc));
}

/** "2026-08-07" → момент 23:59:59.999 за Києвом, у UTC. */
export function kyivDayEnd(day: string): Date {
  const asUtc = new Date(`${day}T23:59:59.999Z`);
  return new Date(asUtc.getTime() - kyivOffsetMs(asUtc));
}

/** Година доби (0-23) за київським часом — для погодинних гістограм. */
export function kyivHour(value: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: KYIV_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(value)
  );
}

/** "HH:MM" за київським часом. */
export function kyivTime(value: Date): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: KYIV_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
