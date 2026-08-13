/**
 * Добір розривів у треку реальною дорогою.
 *
 * Трек — ламана між точками GPS. Поки планшет онлайн і шле точку кожні
 * 15 секунд, відрізки короткі й пряма між ними майже збігається з дорогою.
 * Але варто планшету втратити зв'язок (тримач без інтернету, вимкнений
 * екран, глухий підвал складу) — і в треку виникає розрив: дві точки з
 * різних кінців міста з'єднуються прямою через дахи.
 *
 * Наслідок не косметичний: у пробіг іде хорда, а вона коротша за дорогу.
 * На реальному дні водія два таких розриви дали 15,74 км із 15,76 км
 * «пробігу» — тобто майже весь показник був прямими лініями.
 *
 * Тут ці відрізки прокладаються через OSRM: у пробіг іде довжина дороги,
 * а на карту — її геометрія замість прямої.
 *
 * Окремо від geo.ts свідомо: там чиста геометрія без мережі, якуганяє
 * швидкий тест без бази й інтернету. Мережеві виклики живуть тут.
 */

import { getRoute } from "@/lib/geo/osrm";
import { haversineM } from "@/lib/track/geo";

/**
 * Скільки розривів добираємо за один прохід.
 *
 * OSRM у нас публічний демо-сервер без ключа: він лімітує й падає під
 * навантаженням. День із десятком розривів — уже аномалія (планшет майже
 * весь час офлайн), і добирати їх усі сенсу немає: точність усе одно буде
 * приблизною, а запити з'їдять ліміт для решти водіїв.
 */
export const MAX_GAPS_PER_RUN = 8;

/** Довший за це маршрут OSRM — ознака, що він об'їхав щось дивне. */
const SANITY_FACTOR = 4;

export type GapSegment = {
  /** Індекс точки-кінця розриву в масиві треку */
  index: number;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  /** Пряма між точками, метри */
  straightM: number;
};

export type ResolvedGap = GapSegment & {
  /** Дорогою, метри. null — OSRM не відповів або дав неправдоподібне */
  roadM: number | null;
  /** Геометрія дороги для карти */
  geometry: GeoJSON.LineString | null;
};

/**
 * Прокладає дорогу для кожного розриву.
 *
 * Помилка OSRM не валить розбір: розрив просто лишається прямою, як було
 * досі. Пробіг тоді занижений — але це рівно та поведінка, що була до
 * цієї функції, тож гірше не стане.
 */
export async function resolveGaps(gaps: GapSegment[]): Promise<ResolvedGap[]> {
  const take = gaps.slice(0, MAX_GAPS_PER_RUN);

  return Promise.all(
    take.map(async (g): Promise<ResolvedGap> => {
      try {
        const route = await getRoute([
          [g.from.lng, g.from.lat],
          [g.to.lng, g.to.lat],
        ]);
        const roadM = route.totalDistanceKm * 1000;

        // Дорога не буває коротшою за пряму, а вчетверо довша — ознака, що
        // OSRM повів через міст за 20 км або не знайшов з'їзду. Краще
        // лишити чесну пряму, ніж записати водієві зайві кілометри.
        if (roadM < g.straightM || roadM > g.straightM * SANITY_FACTOR) {
          return { ...g, roadM: null, geometry: null };
        }

        return { ...g, roadM, geometry: route.geometry };
      } catch {
        return { ...g, roadM: null, geometry: null };
      }
    })
  );
}

/**
 * Збирає лінію треку для карти, вплітаючи дороги замість прямих.
 *
 * Там, де планшет був офлайн, замість хорди через півміста підставляємо
 * геометрію реального проїзду. Точки без gapGeometry (звичайний щільний
 * трек) лягають як були — з'єднувати їх дорогами і зайве, і дорого.
 */
export function buildTrackPath(
  points: Array<{ lat: number; lng: number; gapGeometry?: unknown }>
): Array<[number, number]> {
  const out: Array<[number, number]> = [];

  for (const p of points) {
    const line = asLineString(p.gapGeometry);
    if (line) {
      // Геометрія OSRM іде в [lng, lat] і включає обидва кінці. Перший
      // кінець — це попередня точка, вона вже в масиві: пропускаємо, щоб
      // не задвоїти вершину.
      for (const [lng, lat] of line.coordinates.slice(1)) {
        out.push([lat, lng]);
      }
      continue;
    }
    out.push([p.lat, p.lng]);
  }

  return out;
}

/** Обережне читання Json з бази: там може лежати будь-що. */
function asLineString(v: unknown): GeoJSON.LineString | null {
  if (!v || typeof v !== "object") return null;
  const g = v as { type?: unknown; coordinates?: unknown };
  if (g.type !== "LineString" || !Array.isArray(g.coordinates)) return null;
  if (g.coordinates.length < 2) return null;
  return v as GeoJSON.LineString;
}

/**
 * Знаходить розриви серед підготовлених точок.
 *
 * Приймає вже відфільтровані точки (див. preparePoints): ті, що не пройшли
 * перевірку на точність чи правдоподібну швидкість, сюди не доходять.
 */
export function findGaps(
  points: Array<{ lat: number; lng: number; isGap: boolean }>,
  prev?: { lat: number; lng: number } | null
): GapSegment[] {
  const out: GapSegment[] = [];

  points.forEach((p, i) => {
    if (!p.isGap) return;
    // Перша точка пачки міряється від останньої збереженої в базі
    const from = i === 0 ? prev : points[i - 1];
    if (!from) return;
    out.push({
      index: i,
      from: { lat: from.lat, lng: from.lng },
      to: { lat: p.lat, lng: p.lng },
      straightM: haversineM(from.lat, from.lng, p.lat, p.lng),
    });
  });

  return out;
}
