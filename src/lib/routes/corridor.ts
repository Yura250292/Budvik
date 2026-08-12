/**
 * Зона напрямку: коридор уздовж лінії маршруту.
 *
 * Питання, на яке відповідає цей модуль: кого торговий може зачепити, не
 * роблячи гака. Тому зона рахується від РЕАЛЬНОЇ лінії маршруту (геометрія
 * OSRM), а не від кіл навколо населених пунктів: між Стриєм і Миколаєвом
 * 40 км дороги, і всі, хто стоїть уздовж неї, — за пів години об'їзду.
 * Кола навколо пунктів цю смугу якраз і губили б, лишаючи дірки там, де
 * торговий фізично проїжджає щотижня.
 *
 * Відстань міряється до ВІДРІЗКІВ полілінії, а не до її вершин. OSRM
 * повертає геометрію нерівномірно: на прямій ділянці траси між сусідніми
 * точками буває 3–5 км, і клієнт біля середини такого відрізка за
 * відстанню «до вершин» опинявся б за 2 км від дороги, хоча стоїть на ній.
 *
 * Проєкція: локальна рівнокутна (equirectangular) навколо середньої
 * широти. На Львівщині (φ≈49.5°) похибка проти справжньої геодезичної
 * менша за 0.1% на дистанціях у десятки кілометрів — це на два порядки
 * менше за похибку самих координат клієнтів, з яких третина стоїть у
 * центрі села (geoSource=CITY). Haversine на кожну пару точок тут був би
 * чесніше рівно настільки, наскільки й непомітно, але вдесятеро повільніше:
 * 380 клієнтів × тисячі відрізків геометрії рахуються на кожен рух повзунка.
 */

// Default-імпорт, хоча .d.ts оголошує і іменовані: у ESM-збірці пакета
// реально експортується лише default, і `import { union }` валить збірку
// Turbopack на етапі статичного аналізу.
import polygonClipping from "polygon-clipping";

export type LatLng = { lat: number; lng: number };

/** Скільки кілометрів в одному градусі широти. */
const KM_PER_DEG_LAT = 111.32;

/** Локальні метри-в-градусах для смуги навколо заданої широти. */
function scale(refLat: number): { kx: number; ky: number } {
  return {
    ky: KM_PER_DEG_LAT,
    kx: KM_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180),
  };
}

/** Квадрат відстані (км²) від точки до відрізка в локальних координатах. */
function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  // Вироджений відрізок (дублікат точки в геометрії) — міряємо до вершини.
  if (lenSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }

  // Параметр проєкції, затиснутий у [0,1]: за межами відрізка найближча
  // точка — його кінець, а не продовження прямої.
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/**
 * Осьова лінія коридору.
 *
 * Якщо геометрії OSRM немає (шаблон заведений до кешування маршруту або
 * сервіс не відповів), падаємо на ламану по самих пунктах: зона виходить
 * грубішою, але напрямок усе одно має смугу, а не набір кіл.
 */
export function corridorAxis(
  geometry: { coordinates?: [number, number][] } | null | undefined,
  stops: LatLng[]
): LatLng[] {
  const coords = geometry?.coordinates;
  if (coords?.length) {
    // GeoJSON — [lng, lat]
    return coords.map(([lng, lat]) => ({ lat, lng }));
  }
  return stops;
}

/**
 * Індекс для швидких запитів «як далеко ця точка від маршруту».
 *
 * Будується раз на напрямок і перевикористовується для всіх клієнтів:
 * інакше проєкція осі перераховувалася б 380 разів поспіль.
 */
export class CorridorIndex {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly kx: number;
  private readonly ky: number;
  private readonly refLat: number;

  constructor(axis: LatLng[]) {
    if (axis.length === 0) {
      this.kx = KM_PER_DEG_LAT;
      this.ky = KM_PER_DEG_LAT;
      this.refLat = 0;
      return;
    }

    // Середина за широтою, а не перша точка: на довгому напрямку
    // масштаб по довготі береться для центру смуги, а не для її краю.
    let minLat = axis[0].lat;
    let maxLat = axis[0].lat;
    for (const p of axis) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
    this.refLat = (minLat + maxLat) / 2;

    const s = scale(this.refLat);
    this.kx = s.kx;
    this.ky = s.ky;

    for (const p of axis) {
      this.xs.push(p.lng * this.kx);
      this.ys.push(p.lat * this.ky);
    }
  }

  get isEmpty(): boolean {
    return this.xs.length === 0;
  }

  /** Відстань у км від точки до найближчого місця на маршруті. */
  distanceKm(point: LatLng): number {
    if (this.isEmpty) return Number.POSITIVE_INFINITY;

    const px = point.lng * this.kx;
    const py = point.lat * this.ky;

    if (this.xs.length === 1) {
      const ex = px - this.xs[0];
      const ey = py - this.ys[0];
      return Math.sqrt(ex * ex + ey * ey);
    }

    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.xs.length - 1; i++) {
      const d = distSqToSegment(px, py, this.xs[i], this.ys[i], this.xs[i + 1], this.ys[i + 1]);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}

/**
 * Межа зони: зовнішні контури коридору, з дірками, якщо вони є.
 *
 * Перша версія малювала окремі фігури — прямокутник на відрізок плюс коло
 * на вершину — і на карті це виглядало як десятки накладених плям із
 * внутрішніми обведеннями по швах. Межу зони з такого не прочитати.
 *
 * Друга версія обгортала вісь одним кільцем (ліворуч туди, праворуч назад).
 * На прямій трасі виходило ідеально, але перевірка на реальному «Стрию»
 * показала, чому цього мало: 121 з 216 ділянок цього маршруту проходять
 * за <12 км від іншої своєї ж частини — це петля Львів→Стрий→Трускавець→
 * Львів, де дорога «туди» йде поруч із дорогою «назад». Одне кільце там
 * неминуче перетинає саме себе, і контур пірнав усередину зони (частина
 * точок опинялась за 0.9 км від осі замість 10).
 *
 * Тому союз рахується чесно, через polygon-clipping (~9 КБ gzip, і лише
 * в динамічному чанку карти). Кожен відрізок осі дає капсулу, всі капсули
 * об'єднуються — на виході зовнішні межі та справжні дірки між гілками
 * маршруту. Своя реалізація булевих операцій над полігонами тут була б
 * найгіршим варіантом: це класична задача з купою вироджених випадків.
 */
export function corridorRings(axis: LatLng[], radiusKm: number): LatLng[][] {
  const simplified = simplifyAxis(axis, radiusKm / 4);
  if (simplified.length === 0) return [];
  if (simplified.length === 1) return [circleRing(simplified[0], radiusKm)];

  // Капсула на кожен відрізок: прямокутник + півкола на торцях. Кожна —
  // опуклий полігон, тож союз рахується стійко.
  const capsules: Array<Array<[number, number]>> = [];
  for (let i = 0; i < simplified.length - 1; i++) {
    const capsule = segmentCapsule(simplified[i], simplified[i + 1], radiusKm);
    if (capsule) capsules.push(capsule.map((p) => [p.lng, p.lat] as [number, number]));
  }
  if (capsules.length === 0) return [];

  // Вхід для union: кожна капсула — окремий полігон з єдиним кільцем.
  const [first, ...rest] = capsules.map((c) => [closeRing(c)]);
  const united = polygonClipping.union(first as never, ...(rest as never[]));

  // Результат — MultiPolygon: [полігон][кільце][точка]. Беремо всі кільця:
  // зовнішні дають межу, внутрішні — дірки між гілками маршруту.
  const out: LatLng[][] = [];
  for (const polygon of united) {
    for (const ring of polygon) {
      if (ring.length < 4) continue;
      out.push(ring.map(([lng, lat]) => ({ lat, lng })));
    }
  }
  return out;
}

/** polygon-clipping вимагає замкненого кільця: перша точка = остання. */
function closeRing(ring: Array<[number, number]>): Array<[number, number]> {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

/**
 * Капсула навколо відрізка: прямокутник шириною 2R із заокругленими
 * торцями. Заокруглення обов'язкове — з гострими торцями союз давав би
 * зубці на кожному стику сусідніх відрізків.
 */
function segmentCapsule(a: LatLng, b: LatLng, radiusKm: number): LatLng[] | null {
  const n = normalAt(a, b);
  if (!n) return null;

  const out: LatLng[] = [];
  const startAngle = Math.atan2(n.y, n.x);

  // Лівий бік від a до b, дуга навколо b, правий бік назад, дуга навколо a.
  out.push(offsetPoint(a, n.x, n.y, radiusKm));
  out.push(offsetPoint(b, n.x, n.y, radiusKm));
  for (let k = 1; k < ARC_STEPS; k++) {
    const ang = startAngle - (Math.PI * k) / ARC_STEPS;
    out.push(offsetPoint(b, Math.cos(ang), Math.sin(ang), radiusKm));
  }
  out.push(offsetPoint(b, -n.x, -n.y, radiusKm));
  out.push(offsetPoint(a, -n.x, -n.y, radiusKm));
  for (let k = 1; k < ARC_STEPS; k++) {
    const ang = startAngle + Math.PI - (Math.PI * k) / ARC_STEPS;
    out.push(offsetPoint(a, Math.cos(ang), Math.sin(ang), radiusKm));
  }
  return out;
}

/** Скільки сегментів на дугу: 12 на півколо — на око вже гладко. */
const ARC_STEPS = 12;

/** Замкнене коло навколо точки — вироджений випадок осі з однієї точки. */
function circleRing(center: LatLng, radiusKm: number): LatLng[] {
  const s = scale(center.lat);
  const out: LatLng[] = [];
  for (let i = 0; i < ARC_STEPS * 2; i++) {
    const a = (i / (ARC_STEPS * 2)) * Math.PI * 2;
    out.push({
      lat: center.lat + (Math.sin(a) * radiusKm) / s.ky,
      lng: center.lng + (Math.cos(a) * radiusKm) / s.kx,
    });
  }
  return out;
}

/** Одинична нормаль (ліворуч від напрямку a→b) у локальних км-координатах. */
function normalAt(a: LatLng, b: LatLng): { x: number; y: number } | null {
  const s = scale((a.lat + b.lat) / 2);
  const dx = (b.lng - a.lng) * s.kx;
  const dy = (b.lat - a.lat) * s.ky;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  return { x: -dy / len, y: dx / len };
}

/** Зміщує точку на distKm у напрямку одиничного вектора (nx, ny). */
function offsetPoint(p: LatLng, nx: number, ny: number, distKm: number): LatLng {
  const s = scale(p.lat);
  return {
    lat: p.lat + (ny * distKm) / s.ky,
    lng: p.lng + (nx * distKm) / s.kx,
  };
}

/**
 * Проріджування осі за відстанню: викидаємо точки, ближчі за minStepKm до
 * попередньої залишеної. Кінцеву точку зберігаємо завжди, інакше хвіст
 * маршруту лишався б без смуги.
 */
function simplifyAxis(axis: LatLng[], minStepKm: number): LatLng[] {
  if (axis.length <= 2) return axis;

  const step = Math.max(0.5, minStepKm);
  const out: LatLng[] = [axis[0]];
  let last = axis[0];

  for (let i = 1; i < axis.length - 1; i++) {
    const p = axis[i];
    const s = scale((last.lat + p.lat) / 2);
    const dx = (p.lng - last.lng) * s.kx;
    const dy = (p.lat - last.lat) * s.ky;
    if (Math.hypot(dx, dy) >= step) {
      out.push(p);
      last = p;
    }
  }

  out.push(axis[axis.length - 1]);
  return out;
}
