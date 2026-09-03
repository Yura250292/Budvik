/**
 * Де торговий СТОЯВ — і скільки.
 *
 * Питання «де були торгові» і питання «як вони їхали» — різні, і лінія
 * відповідає добре лише на друге. На перше вона відповідає погано за
 * побудовою: між двома фіксами лінія мусить щось намалювати, і що б вона не
 * намалювала, це буде здогад. Звідси й «хвости», які видно на карті кожного
 * дня.
 *
 * Зупинка здогадів не потребує. Це ділянка, де людина не вийшла за коло —
 * тобто факт, а не інтерполяція. Пін зупинки з часом і тривалістю відповідає
 * на питання власника точніше, ніж будь-яка лінія: був отут, стояв двадцять
 * хвилин, і ось у якого клієнта.
 *
 * Клієнта підставляємо самі, коли він очевидний: якщо цього дня є замовлення
 * від контрагента, чия точка ближче ніж MATCH_M, зупинка майже напевно про
 * нього. «Майже» — тому й `confident`: пін підписується, але як здогад, а не
 * як відмітка візиту. Справжні відмітки ставить торговий у застосунку, і
 * плутати одне з одним не можна.
 */

import { classifyMovement, type MovePoint } from "@/lib/track/movement";
import { haversineM } from "@/lib/track/geo";

/**
 * Коротша стоянка на карту не йде.
 *
 * П'ять хвилин — це вже не світлофор і не «пропустити пішохода», а привід
 * спитати, що людина там робила. Менше — і карта знову вкриється точками,
 * від яких ми щойно її почистили.
 */
const MIN_MINUTES = 5;

/**
 * Наскільки близько має бути клієнт, щоб підписати ним зупинку.
 *
 * 150 метрів — це двір і сусідній під'їзд, але вже не сусідній квартал.
 * Координати контрагентів місцями уточнені лише до міста (див. клієнтську
 * карту), тож ширший радіус почав би підписувати зупинки навмання.
 */
const MATCH_M = 150;

export type TrackStop = {
  /** Порядковий номер зупинки за день — він же підпис на піні. */
  seq: number;
  lat: number;
  lng: number;
  from: Date;
  to: Date;
  minutes: number;
  /** Клієнт, у якого людина найімовірніше стояла, якщо він очевидний. */
  counterpartyId: string | null;
  counterpartyName: string | null;
  /** Скільки метрів від зупинки до точки того клієнта. */
  distanceM: number | null;
};

export type StopCandidate = {
  counterpartyId: string;
  name: string;
  lat: number | null;
  lng: number | null;
};

/**
 * Середина зупинки — не перша точка, а центр хмари.
 *
 * Перша точка часто найгірша: людина щойно заїхала, приймач ще не встиг
 * зійтися. Центр стійкіший і не залежить від того, з якого боку під'їхали.
 */
function centroid(points: MovePoint[], from: number, to: number): { lat: number; lng: number } {
  let lat = 0;
  let lng = 0;
  for (let i = from; i <= to; i++) {
    lat += points[i].lat;
    lng += points[i].lng;
  }
  const n = to - from + 1;
  return { lat: lat / n, lng: lng / n };
}

/**
 * Зупинки дня з треку. Точки мусять іти за часом.
 *
 * `candidates` — клієнти, у яких цього дня є документи. Порожній список — не
 * помилка: зупинки лишаються, просто без підписів.
 */
export function findStops(points: MovePoint[], candidates: StopCandidate[] = []): TrackStop[] {
  const located = candidates.filter(
    (c): c is StopCandidate & { lat: number; lng: number } => c.lat != null && c.lng != null
  );

  const stops: TrackStop[] = [];
  for (const seg of classifyMovement(points)) {
    if (seg.mode !== "STOP" || seg.minutes < MIN_MINUTES) continue;

    const at = centroid(points, seg.start, seg.end);

    let nearest: { c: (typeof located)[number]; m: number } | null = null;
    for (const c of located) {
      const m = haversineM(at.lat, at.lng, c.lat, c.lng);
      if (!nearest || m < nearest.m) nearest = { c, m };
    }
    const matched = nearest && nearest.m <= MATCH_M ? nearest : null;

    stops.push({
      seq: stops.length + 1,
      lat: at.lat,
      lng: at.lng,
      from: seg.from,
      to: seg.to,
      minutes: seg.minutes,
      counterpartyId: matched?.c.counterpartyId ?? null,
      counterpartyName: matched?.c.name ?? null,
      distanceM: matched ? Math.round(matched.m) : null,
    });
  }
  return stops;
}
