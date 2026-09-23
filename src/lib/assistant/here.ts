/**
 * «Де я зараз» — для маршруту, що починається від людини, а не від складу.
 *
 * Два джерела, і порядок між ними важливий.
 *
 * Перше — пристрій: браузер (чи WebView застосунку) кладе координати в
 * тіло маршрутного питання. Це найсвіжіше, що в нас може бути, і єдине
 * джерело для керівника: треку він не пише.
 *
 * Друге — трек робочого застосунку. Браузер може не дати дозволу або
 * промовчати, а водій чи торговий у зміні шле точки щохвилини. Беремо
 * лише свіжу: точка годинної давнини — це вже «де я був», і маршрут від
 * неї поведе людину назад.
 *
 * Нічого з цього немає — повертаємо null, і маршрут виїжджає зі складу з
 * чесною приміткою. Вгадувати місце людини гірше, ніж сказати, що його
 * не знаємо.
 */

import { prisma } from "@/lib/prisma";
import type { Here } from "@/lib/assistant/types";

/**
 * Межі, у яких координата взагалі має сенс.
 *
 * Ширші за зону розвозки: людина може питати маршрут з відрядження, і
 * відкидати її через область було б дивно. Але (0, 0) чи переплутані
 * широта з довготою — це збій, а не місце.
 */
const BOUNDS = { latMin: 44, latMax: 53, lngMin: 22, lngMax: 41 };

/** Старша за це координата з пристрою — уже не «зараз». */
const DEVICE_MAX_AGE_MS = 10 * 60_000;

/** Старша за це точка треку — людина вже деінде. */
const TRACK_MAX_AGE_MS = 15 * 60_000;

function inBounds(lat: number, lng: number): boolean {
  return lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lng >= BOUNDS.lngMin && lng <= BOUNDS.lngMax;
}

/**
 * Координати з тіла запиту. Усе, що не схоже на справжню позицію, — null:
 * тіло збирає клієнт, і довіряти йому більше, ніж перевірці, не варто.
 */
export function hereFromBody(raw: unknown, now = Date.now()): Here | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lat = typeof r.lat === "number" ? r.lat : NaN;
  const lng = typeof r.lng === "number" ? r.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBounds(lat, lng)) return null;

  // Час фіксу — з пристрою; майбутнє в межах хвилини пробачаємо (годинник).
  if (typeof r.at === "number") {
    const age = now - r.at;
    if (age > DEVICE_MAX_AGE_MS || age < -60_000) return null;
  }

  const acc = typeof r.accuracy === "number" && Number.isFinite(r.accuracy) && r.accuracy >= 0 ? Math.round(r.accuracy) : null;
  return { lat, lng, accuracyM: acc, source: "пристрій" };
}

/** Остання свіжа точка треку цієї людини — або null. */
export async function hereFromTrack(userId: string, now = Date.now()): Promise<Here | null> {
  const p = await prisma.trackPoint.findFirst({
    where: { userId, recordedAt: { gte: new Date(now - TRACK_MAX_AGE_MS) } },
    orderBy: { recordedAt: "desc" },
    select: { lat: true, lng: true, accuracyM: true },
  });
  if (!p || !inBounds(p.lat, p.lng)) return null;
  return { lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, source: "трек" };
}

/**
 * Похибка, з якою старт ще має сенс.
 *
 * Ноутбук без GPS визначає місце за IP — це «десь у Львові» з похибкою в
 * кілька кілометрів. Маршрут від такої точки впевнено назве перший рукав
 * «+3,2 км», якого насправді немає. Грубше за цю межу — не беремо.
 */
export const HERE_MAX_ACCURACY_M = 3_000;

/** Людська підпис похибки: «±40 м», «±1,2 км». */
export function accuracyLabel(m: number | null): string {
  if (m === null) return "похибка невідома";
  return m < 1000 ? `±${m} м` : `±${(m / 1000).toFixed(1).replace(".", ",")} км`;
}
