/**
 * Де людина проїхала тією самою дорогою вдруге.
 *
 * Питання, заради якого це існує: скільки з денного пробігу — це повернення
 * назад по власному сліду. На карті такий проїзд не видно взагалі: друга
 * лінія лягає точно на першу, і день із двома заїздами в те саме село
 * виглядає як день з одним. А саме ці кілометри й можна прибрати, переклавши
 * порядок точок у маршруті.
 *
 * Як розпізнаємо. Слід ріжеться на клітинки по сорок метрів (ширина дороги
 * плюс похибка приймача), і кожен відрізок лишає в них свій напрямок. Якщо
 * пізніший відрізок потрапляє в уже зайняту клітинку, дивимося на кут між
 * напрямками: близькі — це той самий проїзд удруге, протилежні — повернення,
 * а поперечні (перехрестя) не рахуються зовсім.
 *
 * Найважливіша умова — ЧАС. Без неї сусідні точки однієї поїздки визнавали б
 * одна одну повтором, бо лежать у тій самій клітинці. Тому повтором вважаємо
 * лише те, що сталося не раніше ніж за кілька хвилин.
 */

import { haversineM } from "@/lib/track/geo";

/** Уперше цією дорогою; назад по власному сліду; той самий проїзд удруге. */
export type PassKind = "FIRST" | "BACK" | "AGAIN";

export type PassPoint = { lat: number; lng: number; recordedAt: Date };

/** Клітинка сітки: ширина дороги плюс похибка приймача. */
const CELL_M = 40;

/** Крок відбору вздовж відрізка — щоб довгий відрізок не перескочив клітинку. */
const SAMPLE_M = 25;

/**
 * Раніше цього часу повтором не вважаємо.
 *
 * Точка пишеться раз на двадцять секунд, тож сусідні точки однієї поїздки
 * завжди лежать в одних клітинках. Три хвилини — це вже інший заїзд, а не
 * та сама машина, що ще не виїхала з клітинки.
 */
const MIN_REVISIT_MS = 3 * 60_000;

/** Кут, до якого напрямки вважаються однаковими, і кут, з якого — зустрічними. */
const SAME_DEG = 50;
const OPPOSITE_DEG = 130;

/** Яка частка відрізка мусить лягти на старий слід, щоб це був повтор. */
const MATCH_SHARE = 0.4;

/**
 * Коротші пробіги одного виду вливаються в сусідній.
 *
 * Інакше на кожному перехресті лінія міняла б колір туди-сюди, і карта стала
 * б рябою рівно там, де дивитися нема на що.
 */
const MIN_RUN_M = 150;

function bearingDeg(a: PassPoint, b: PassPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Найменший кут між двома напрямками, 0..180. */
function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Точки відбору вздовж відрізка разом із їхніми клітинками. */
function samplesOf(a: PassPoint, b: PassPoint): Array<{ row: number; col: number }> {
  const meters = haversineM(a.lat, a.lng, b.lat, b.lng);
  const steps = Math.max(1, Math.ceil(meters / SAMPLE_M));
  const dLat = CELL_M / 111_320;
  const out: Array<{ row: number; col: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = a.lat + (b.lat - a.lat) * t;
    const lng = a.lng + (b.lng - a.lng) * t;
    const dLng = CELL_M / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    out.push({ row: Math.round(lat / dLat), col: Math.round(lng / dLng) });
  }
  return out;
}

/**
 * Розмічає кожен проміжок між точками.
 *
 * `driveGap[i]` — чи є проміжок i їздою. Ходьбу й стоянки не розмічаємо й у
 * сітку не кладемо: людина обійшла ринок двічі — це не повторний проїзд, а
 * тремтіння приймача на місці взагалі заповнило б сітку сміттям.
 */
export function markRepeatPasses(points: PassPoint[], driveGap: boolean[]): PassKind[] {
  const marks: PassKind[] = new Array(Math.max(0, points.length - 1)).fill("FIRST");
  if (points.length < 2) return marks;

  const seen = new Map<string, Array<{ bearing: number; at: number }>>();

  for (let i = 0; i < points.length - 1; i++) {
    if (!driveGap[i]) continue;
    const a = points[i];
    const b = points[i + 1];
    const meters = haversineM(a.lat, a.lng, b.lat, b.lng);
    // Стоячи на місці напрямок не визначений — такий проміжок ні про що не
    // свідчить і сітку тільки засмічує.
    if (meters < 5) continue;

    const bearing = bearingDeg(a, b);
    const at = b.recordedAt.getTime();
    const samples = samplesOf(a, b);

    /**
     * Дивимося не в саму клітинку, а в її ОКОЛИЦЮ — дев'ять клітинок.
     *
     * Без цього виміряні дні давали майже нуль повторів, і причина не в
     * даних. Точка пишеться раз на двадцять секунд, тобто на трасі раз на
     * триста метрів, і зворотний слід — це інша хорда тієї самої дуги: вона
     * відходить від першої на десятки метрів. Плюс саме округлення до сітки
     * кидає сусідні проїзди в різні клітинки. Околиця обидва ефекти
     * поглинає, лишаючись у межах ширини дороги.
     */
    let same = 0;
    let opposite = 0;
    for (const s of samples) {
      let bestSame = false;
      let bestOpposite = false;
      for (let dr = -1; dr <= 1 && !(bestSame || bestOpposite); dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const prior = seen.get(`${s.row + dr}:${s.col + dc}`);
          if (!prior) continue;
          for (const p of prior) {
            if (at - p.at < MIN_REVISIT_MS) continue;
            const angle = angleBetween(bearing, p.bearing);
            if (angle >= OPPOSITE_DEG) bestOpposite = true;
            else if (angle <= SAME_DEG) bestSame = true;
          }
          if (bestSame || bestOpposite) break;
        }
      }
      if (bestOpposite) opposite++;
      else if (bestSame) same++;
    }

    /**
     * Скільки відбірних точок мусить збігтися. Одна випадкова — це
     * перехрестя або сусідня смуга, і фарбувати через неї цілий проїзд
     * означало б підказати перекласти маршрут там, де нічого не повторено.
     */
    const need = Math.max(1, Math.ceil(samples.length * MATCH_SHARE));
    if (opposite >= need) marks[i] = "BACK";
    else if (same >= need) marks[i] = "AGAIN";

    for (const s of samples) {
      const key = `${s.row}:${s.col}`;
      const list = seen.get(key);
      if (list) list.push({ bearing, at });
      else seen.set(key, [{ bearing, at }]);
    }
  }

  return smooth(points, driveGap, marks);
}

/** Зливає надто короткі пробіги в сусідній вид — щоб лінія не рябіла. */
function smooth(points: PassPoint[], driveGap: boolean[], marks: PassKind[]): PassKind[] {
  const out = [...marks];
  let i = 0;
  while (i < out.length) {
    if (!driveGap[i]) {
      i++;
      continue;
    }
    let j = i;
    let meters = 0;
    while (j < out.length && driveGap[j] && out[j] === out[i]) {
      meters += haversineM(points[j].lat, points[j].lng, points[j + 1].lat, points[j + 1].lng);
      j++;
    }
    if (meters < MIN_RUN_M) {
      // Куди вливати: до попереднього виду, а на початку дня — до наступного.
      const before = i > 0 && driveGap[i - 1] ? out[i - 1] : null;
      const after = j < out.length && driveGap[j] ? out[j] : null;
      const target = before ?? after;
      if (target) for (let k = i; k < j; k++) out[k] = target;
    }
    i = j;
  }
  return out;
}
