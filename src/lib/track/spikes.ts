/**
 * Поодинокі точки, які вистрілюють убік і одразу повертаються.
 *
 * На карті це «вуса»: лінія відходить на пів кілометра вбік і тим самим
 * місцем вертається. У пробіг вони йдуть двічі — туди й назад, — тому в
 * Джумаги 03.09 дев'ятнадцять таких точок дали 14,4 зайвих кілометра.
 *
 * **Звідки вони беруться.** Не з нізвідки: застосунок їх ловить сам
 * (`recorder.ts`, правило про дрейф), але має запобіжник — після п'яти
 * відкинутих поспіль шоста точка пишеться хай там що. Запобіжник потрібен:
 * якби приймач з якоїсь причини завжди звітував нуль, правило з'їло б цілу
 * поїздку. Але саме він і пропускає кожну шосту під час довгої стоянки з
 * гуляючим приймачем — і кожна така стає вусом.
 *
 * **Чому лікуємо на сервері.** По-перше, тут видно СУСІДА СПРАВА: планшет
 * знає лише минуле, а вус впізнається саме тим, що трек повернувся туди,
 * звідки вийшов. По-друге, це лікує й уже записану історію, а не лише те,
 * що приїде завтра.
 *
 * **Головне свідчення — сам прилад.** Він у ту мить звітує нульову
 * швидкість, а геометрія вимагає сотні кілометрів на годину. Одне з двох
 * неправда, і це точно не нерухомий планшет (те саме міркування, що й у
 * фільтрі дрейфу на пристрої).
 */

import { haversineM } from "@/lib/track/geo";

export type SpikePoint = {
  lat: number;
  lng: number;
  recordedAt: Date;
  speedKmh?: number | null;
};

/**
 * Наскільки мало треба зрушити по прямій, щоб це був вус, а не поворот.
 *
 * 0.35 означає: пройшли 700 метрів туди-назад, а зрушили менше ніж на 245.
 * Справжній розворот на дорозі так не виглядає — там між «туди» і «назад»
 * лежить розділова, і по прямій виходить помітно більше.
 */
const SPUR_RATIO = 0.35;

/** Дрібні коливання не чіпаємо: це шум приймача, а не вус. */
const MIN_DETOUR_M = 150;

/** Нижче цієї швидкості прилад вважає, що стоїть. Те саме число, що в застосунку. */
const STANDING_KMH = 3;

/** Стоячи так «переміститися» не можна. */
const STANDING_IMPLIED_KMH = 30;

/** Стеля правдоподібності для буса — вище неї точка неможлива за будь-яких свідчень. */
const MAX_PLAUSIBLE_KMH = 150;

/**
 * Прибирає вуса. Повертає ті самі об'єкти, лише без спотворених точок.
 *
 * Один прохід: вус — це ОДНА точка між двома добрими, і після її видалення
 * сусіди сходяться. Два підряд зіпсовані фікси дають уже не вус, а розрив,
 * і вигадувати за них шлях ми не беремося.
 */
export function dropSpikes<T extends SpikePoint>(points: T[]): T[] {
  if (points.length < 3) return points;

  const out: T[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const next = points[i + 1];

    const outM = haversineM(prev.lat, prev.lng, cur.lat, cur.lng);
    const backM = haversineM(cur.lat, cur.lng, next.lat, next.lng);
    const acrossM = haversineM(prev.lat, prev.lng, next.lat, next.lng);

    const detourM = outM + backM - acrossM;
    const seconds = (next.recordedAt.getTime() - prev.recordedAt.getTime()) / 1000;

    if (acrossM >= (outM + backM) * SPUR_RATIO || detourM < MIN_DETOUR_M || seconds <= 0) {
      out.push(cur);
      continue;
    }

    const impliedKmh = (outM + backM) / 1000 / (seconds / 3600);
    const standing = cur.speedKmh != null && cur.speedKmh < STANDING_KMH;

    const impossible =
      (standing && impliedKmh > STANDING_IMPLIED_KMH) || impliedKmh > MAX_PLAUSIBLE_KMH;

    if (!impossible) out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
}
