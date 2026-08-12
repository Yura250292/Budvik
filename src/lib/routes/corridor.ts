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
 * Полігон коридору для малювання на мапі.
 *
 * Замість справжнього буфера (для якого знадобився б turf і клієнтський
 * бандл на сотні кілобайт) будуємо об'єднання «капсул»: для кожного
 * відрізка — прямокутник шириною 2R, для кожної вершини — коло радіуса R.
 * Leaflet малює це як набір фігур з однаковим стилем і напівпрозорою
 * заливкою; візуально це і є смуга. Точність малюнка тут другорядна:
 * рішення «в зоні / не в зоні» ухвалює distanceKm, а не піксель на екрані.
 *
 * Осьова лінія проріджується: у геометрії OSRM на 246 км понад тисяча
 * точок, і малювати тисячу прямокутників — це секунди фризу на кожен рух
 * повзунка радіуса.
 */
export function corridorShapes(
  axis: LatLng[],
  radiusKm: number
): { segments: LatLng[][]; circles: Array<{ center: LatLng; radiusKm: number }> } {
  const simplified = simplifyAxis(axis, radiusKm / 3);
  if (simplified.length === 0) return { segments: [], circles: [] };
  if (simplified.length === 1) {
    return { segments: [], circles: [{ center: simplified[0], radiusKm }] };
  }

  const segments: LatLng[][] = [];
  for (let i = 0; i < simplified.length - 1; i++) {
    const a = simplified[i];
    const b = simplified[i + 1];
    const s = scale((a.lat + b.lat) / 2);

    const dx = (b.lng - a.lng) * s.kx;
    const dy = (b.lat - a.lat) * s.ky;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;

    // Нормаль до відрізка, довжиною radiusKm, назад у градуси.
    const nx = (-dy / len) * radiusKm;
    const ny = (dx / len) * radiusKm;
    const offLng = nx / s.kx;
    const offLat = ny / s.ky;

    segments.push([
      { lat: a.lat + offLat, lng: a.lng + offLng },
      { lat: b.lat + offLat, lng: b.lng + offLng },
      { lat: b.lat - offLat, lng: b.lng - offLng },
      { lat: a.lat - offLat, lng: a.lng - offLng },
    ]);
  }

  // Кола на стиках згладжують кути між прямокутниками.
  const circles = simplified.map((center) => ({ center, radiusKm }));
  return { segments, circles };
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
