/**
 * Прив'язка треку до доріг — щоб лінія лягала по вулиці, а не ламаною.
 *
 * Трек — це послідовність фіксів, і навіть чистий GPS дає вершину раз на
 * 200–300 метрів при швидкості 50 км/год. На карті це зрізані повороти й
 * прямі крізь двори: людина їхала дорогою, а лінія — навпростець.
 *
 * OSRM має для цього окрему службу `/match`: вона бере ЦІЛИЙ слід і шукає
 * послідовність доріг, якою людина найімовірніше проїхала. Це не те саме, що
 * `/route` у домальовці розривів — той з'єднує ДВІ точки, а ця кладе на граф
 * увесь слід.
 *
 * Три рішення, за якими стоїть сьогоднішній досвід:
 *
 * 1. Прив'язка — ДЛЯ МАЛЮНКА, не для даних. Сирі точки лишаються джерелом
 *    правди, пробіг рахується як рахувався. Матчинг — це здогад, і хай навіть
 *    дуже добрий, підміняти ним виміряне не можна: помилку в кілометражі
 *    потім не відрізниш від помилки водія.
 *
 * 2. Годуємо матчер лише довіреними фіксами. Точка з похибкою 700 метрів
 *    впевнено кладе слід на сусідню вулицю — рівно так домальовка колись
 *    малювала петлі кварталами.
 *
 * 3. Бюджет часу й чесний відкат. Демо-сервер OSRM повільний і лімітований;
 *    якщо шматок не прив'язався — лишаємо на його місці сиру лінію, а не
 *    порожнечу. Карта в найгіршому випадку виглядає як досі.
 */

import { getRoute, matchTrace } from "@/lib/geo/osrm";
import { haversineM, MAX_ACCURACY_M } from "@/lib/track/geo";
import { classifyMovement } from "@/lib/track/movement";

/**
 * Скільки координат ідуть в один запит.
 *
 * Публічний демо-сервер приймає рівно десять: одинадцята вже «TooBig»
 * (перевірено на справжньому сліді 02.09). Власний OSRM такої межі не має —
 * там це число можна підняти до тисяч і класти добу одним запитом.
 */
const CHUNK = Number(process.env.OSRM_MATCH_CHUNK ?? 10);

/**
 * Нижче цієї впевненості дорогу не малюємо.
 *
 * На щільному сліді матчер віддає 0,84–0,98 — це справжня вулиця. Нуль він
 * ставить там, де точки рідкі або людина стояла, і саме там охоче кладе слід
 * на паралельну дорогу. Впевнено намальований НЕ ТОЙ проїзд гірший за чесну
 * ламану: ламану видно оком, а вигадану вулицю — ні.
 */
const MIN_CONFIDENCE = 0.5;

/**
 * Скільки часу дозволено витратити на всю добу.
 *
 * Сторінка чекає на цей результат, тож межа мусить бути людською. Що не
 * встигли — лишається сирою лінією; наступне відкриття дня добере решту з
 * кеша, бо результат зберігається.
 */
const BUDGET_MS = 12_000;

/** Ближчі за це точки матчеру нічого не додають, лише з'їдають ліміт. */
const MIN_STEP_M = 8;

export type TrackVertex = {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  /**
   * Час фікса. Без нього поділ на їзду й ходьбу неможливий, і прив'язка
   * поводиться як раніше — кладе на дороги весь слід підряд.
   */
  recordedAt?: Date;
};

/**
 * Проріджує слід перед матчингом.
 *
 * Стоянка з десятком фіксів на місці дає матчеру мікропетлі, а ліміт
 * координат витрачається намарно. Лишаємо лише те, що справді рухається.
 */
function thin(points: TrackVertex[]): TrackVertex[] {
  const out: TrackVertex[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && haversineM(last.lat, last.lng, p.lat, p.lng) < MIN_STEP_M) continue;
    out.push(p);
  }
  return out;
}

/**
 * Кладе денний трек на дороги. Повертає лінію [lat, lng] або null, якщо
 * прив'язувати нічого.
 */
export async function matchDayPath(points: TrackVertex[]): Promise<Array<[number, number]> | null> {
  const trusted = points.filter((p) => p.accuracyM == null || p.accuracyM <= MAX_ACCURACY_M);
  if (trusted.length < 2) return null;

  const started = Date.now();

  /**
   * На дороги кладемо ЛИШЕ їзду — і це головне тут після самого матчингу.
   *
   * Матчер шукає послідовність доріг, якою людина найімовірніше проїхала. На
   * пішому сліді він робить рівно те, що вміє: чесно веде вулицями петлю,
   * яку торговий обійшов ногами по ринку. Виходить намальована поїздка, якої
   * не було, і саме вона давала «хвости» на карті. Стоянка ще гірша: три
   * години тремтіння приймача на місці матчер розкладає в клубок проїздів.
   *
   * Тому ходьба лишається сирою ламаною, а стоянка стискається в одну точку.
   */
  const withTime = trusted.every((p) => p.recordedAt instanceof Date);
  if (withTime) {
    const segments = classifyMovement(
      trusted as Array<TrackVertex & { recordedAt: Date }>
    );
    const out: Array<[number, number]> = [];
    for (const seg of segments) {
      const part = trusted.slice(seg.start, seg.end + 1);
      const line =
        seg.mode === "STOP"
          ? [[part[0].lat, part[0].lng] as [number, number]]
          : seg.mode === "WALK"
            ? thin(part).map((p) => [p.lat, p.lng] as [number, number])
            : await matchRun(thin(part), started);
      for (const v of out.length > 0 ? line.slice(1) : line) out.push(v);
    }
    return out.length >= 2 ? out : null;
  }

  return matchRun(thin(trusted), started).then((line) => (line.length >= 2 ? line : null));
}

/**
 * Другий спосіб покласти шматок на дороги — прокласти по них маршрут.
 *
 * Потрібен там, де матчер безсилий: на двох точках за кілометр одна від одної
 * він не має чого зіставляти й чесно віддає низьку впевненість. А саме такі
 * шматки й малювали діагоналі крізь квартали — у Славську їх було три з
 * тринадцяти.
 *
 * **Це виключно малюнок.** Пробіг рахується по сирих точках і сюди не
 * заглядає — і саме тому так можна. Те саме прокладання, застосоване до
 * КІЛОМЕТРІВ, роздуло день Передрія з 64 до 85 при одометрі 69: маршрутизатор
 * веде своїм найкращим шляхом, а не тим, яким їхала людина. Малювати цим
 * шляхом чесніше, ніж різати будинки; рахувати ним — ні.
 *
 * Запобіжник той самий, що й у домальовці розривів: дорога, довша за пряму
 * більш ніж удвічі, — це вже не «та сама дорога», а об'їзд, який ми
 * вигадали. Тоді краще чесна пряма.
 */
const ROUTE_SANITY_FACTOR = 2.5;

async function routeThrough(
  chunk: TrackVertex[],
  started: number
): Promise<Array<[number, number]> | null> {
  if (chunk.length < 2 || Date.now() - started > BUDGET_MS) return null;

  const from = chunk[0];
  const to = chunk[chunk.length - 1];
  const straightM = haversineM(from.lat, from.lng, to.lat, to.lng);
  // Дуже короткі шматки й так лягають у вулицю оком: не варті запиту.
  if (straightM < 120) return null;

  try {
    const route = await getRoute([
      [from.lng, from.lat],
      // Проміжні точки ведуть маршрут ТИМ шляхом, а не найкоротшим: без них
      // OSRM спрямив би заїзд у двір до сусідньої вулиці.
      ...chunk.slice(1, -1).map((p): [number, number] => [p.lng, p.lat]),
      [to.lng, to.lat],
    ]);
    const roadM = route.totalDistanceKm * 1000;
    if (roadM < straightM * 0.8 || roadM > straightM * ROUTE_SANITY_FACTOR) return null;
    const line = route.geometry?.coordinates;
    if (!Array.isArray(line) || line.length < 2) return null;
    return line.map(([lng, lat]) => [lat, lng] as [number, number]);
  } catch {
    return null;
  }
}

/** Кладе на дороги один суцільний відрізок їзди. */
async function matchRun(
  trusted: TrackVertex[],
  started: number
): Promise<Array<[number, number]>> {
  const out: Array<[number, number]> = [];
  if (trusted.length < 2) return trusted.map((p) => [p.lat, p.lng] as [number, number]);

  for (let i = 0; i < trusted.length - 1; i += CHUNK - 1) {
    const chunk = trusted.slice(i, i + CHUNK);
    if (chunk.length < 2) break;

    const raw = (): Array<[number, number]> =>
      chunk.map((p) => [p.lat, p.lng] as [number, number]);

    let line: Array<[number, number]>;
    if (Date.now() - started > BUDGET_MS) {
      line = raw();
    } else {
      const matched = await matchTrace(
        chunk.map((p) => ({ lng: p.lng, lat: p.lat, accuracyM: p.accuracyM }))
      ).catch(() => null);
      line =
        matched && matched.confidence >= MIN_CONFIDENCE
          ? matched.line.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
          : ((await routeThrough(chunk, started)) ?? raw());
    }

    // Шматки перекриваються однією точкою — не задвоюємо стик.
    for (const v of out.length > 0 ? line.slice(1) : line) out.push(v);
  }

  return out;
}
