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
