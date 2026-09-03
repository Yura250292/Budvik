/**
 * Чим саме людина рухалася: машиною, ногами чи стояла.
 *
 * Питання не академічне. Власника цікавить швидке пересування — це і є
 * маршрут; а торговий півдня ходить пішки: ринок, двір, склад клієнта, з
 * поверху на поверх. На карті ці метри виглядають однаково — синя лінія — і
 * саме вони роблять «хвости»: людина обійшла ринок, а лінія намалювала
 * зигзаг через квартал. Ще гірше, коли такий відрізок кладеться на дороги:
 * OSRM чесно проводить пішохідну петлю вулицями, і в треку зʼявляється
 * поїздка, якої не було.
 *
 * За даними 03.09 розділення чисте, без сірої зони. У трьох торгових:
 * машиною 81–149 км за 100–150 хвилин, ногами 2,4–5,4 км за 60–120 хвилин
 * відрізками по 3–20 хвилин, і в жодному пішому відрізку швидкість не
 * піднімалася вище 7 км/год.
 *
 * ЗАТОР — це їзда, і плутати його з ходьбою не можна: у місті бус повзе
 * 5–15 км/год цілком буденно. Розрізняє їх не миттєва швидкість, а два
 * інші факти. По-перше, пік: у заторі машина раз у раз проскакує 10–20
 * км/год, пішохід — ніколи. По-друге, тривалість: хвилинне повзання між
 * світлофорами — не спосіб пересування, а частина поїздки.
 */

/** Як людина рухалася на цьому відрізку. */
export type MoveMode = "DRIVE" | "WALK" | "STOP";

export type MovePoint = {
  lat: number;
  lng: number;
  recordedAt: Date;
};

export type MoveSegment = {
  mode: MoveMode;
  /** Індекси першої й останньої точки відрізка у вхідному масиві, включно. */
  start: number;
  end: number;
  from: Date;
  to: Date;
  meters: number;
  minutes: number;
};

/** Нижче цього людина не рухається — це дрейф приймача на місці. */
const STOP_KMH = 1;

/**
 * Стеля пішохода.
 *
 * 7 км/год — це вже швидка хода, майже біг. Вище починається смуга, у якій
 * трапляється і машина в заторі, і двір, і виїзд із парковки, — і вся вона
 * лишається їздою навмисно: приписати машині зайвий кілометр не страшно,
 * а от викинути з маршруту справжню поїздку — страшно.
 */
const WALK_KMH = 7;

/**
 * Пік у межах відрізка, вище якого це вже не ходьба.
 *
 * Медіана згладжує, і хвилина в заторі цілком може дати медіану 5 км/год.
 * Але щоб уся ділянка НІ РАЗУ не перевищила 10 км/год, машина має стояти —
 * а тоді це не затор, а зупинка.
 */
const WALK_PEAK_KMH = 10;

/** Вікно згладжування: менше — і кожен світлофор стає окремим відрізком. */
const SMOOTH_MS = 90_000;

/** Коротша ходьба — не спосіб пересування, а маневр: віддаємо її їзді. */
const MIN_WALK_MS = 3 * 60_000;

/** Коротша зупинка — світлофор, а не стоянка. */
const MIN_STOP_MS = 2 * 60_000;

/**
 * Пауза, після якої швидкість нічого не означає.
 *
 * Планшет був офлайн або приймач мовчав; між двома точками година й вісім
 * кілометрів. Порахувати з цього 8 км/год і назвати ходьбою було б
 * найгіршим із можливих висновків — насправді там поїздка, яку ми просто
 * не бачили. Такі проміжки завжди їзда: саме їх добиває дорога з OSRM.
 */
const MAX_TRUSTED_GAP_MS = 5 * 60_000;

const EARTH_R = 6_371_000;

function haversineM(a: MovePoint, b: MovePoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Швидкість кожного проміжку між сусідніми точками, км/год. */
function gapSpeeds(points: MovePoint[]): Array<{ kmh: number; meters: number; ms: number }> {
  const out: Array<{ kmh: number; meters: number; ms: number }> = [];
  for (let i = 1; i < points.length; i++) {
    const meters = haversineM(points[i - 1], points[i]);
    const ms = points[i].recordedAt.getTime() - points[i - 1].recordedAt.getTime();
    out.push({ meters, ms, kmh: ms > 0 ? (meters / ms) * 3_600_000 / 1000 : 0 });
  }
  return out;
}

/** Медіана швидкості у вікні ±SMOOTH_MS навколо проміжку. */
function smooth(points: MovePoint[], raw: ReturnType<typeof gapSpeeds>): number[] {
  const at = (i: number) => points[i + 1].recordedAt.getTime();
  const out: number[] = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = at(i);
    while (lo < raw.length && at(lo) < t - SMOOTH_MS) lo++;
    while (hi < raw.length && at(hi) <= t + SMOOTH_MS) hi++;
    const window = raw.slice(lo, hi).map((g) => g.kmh).sort((a, b) => a - b);
    out.push(window.length ? window[Math.floor(window.length / 2)] : raw[i].kmh);
  }
  return out;
}

/**
 * Ділить трек на відрізки за способом пересування.
 *
 * Точки мусять іти за часом. Менше двох — відрізків немає: один фікс не
 * свідчить ні про рух, ні про стоянку.
 */
export function classifyMovement(points: MovePoint[]): MoveSegment[] {
  if (points.length < 2) return [];

  const raw = gapSpeeds(points);
  const med = smooth(points, raw);

  const label = raw.map((gap, i): MoveMode => {
    // Довга пауза не свідчить про швидкість — там поїздка, якої не видно.
    if (gap.ms > MAX_TRUSTED_GAP_MS) return "DRIVE";
    if (med[i] < STOP_KMH) return "STOP";
    return med[i] < WALK_KMH ? "WALK" : "DRIVE";
  });

  /**
   * Пік усередині ділянки вирішує суперечку «ходьба чи затор».
   *
   * Рахуємо його по СИРІЙ швидкості: медіана для того й потрібна, щоб
   * прибрати сплески, а тут саме сплеск і є доказом.
   */
  const runs = toRuns(label);
  for (const run of runs) {
    if (run.mode !== "WALK") continue;
    let peak = 0;
    for (let i = run.start; i <= run.end; i++) peak = Math.max(peak, raw[i].kmh);
    if (peak > WALK_PEAK_KMH) run.mode = "DRIVE";
  }

  // Короткі ділянки — не спосіб пересування, а частина сусідньої.
  const spanMs = (r: { start: number; end: number }) =>
    points[r.end + 1].recordedAt.getTime() - points[r.start].recordedAt.getTime();
  for (const run of runs) {
    if (run.mode === "WALK" && spanMs(run) < MIN_WALK_MS) run.mode = "DRIVE";
    else if (run.mode === "STOP" && spanMs(run) < MIN_STOP_MS) run.mode = "DRIVE";
  }

  return merge(runs).map((run) => {
    let meters = 0;
    for (let i = run.start; i <= run.end; i++) meters += raw[i].meters;
    const from = points[run.start].recordedAt;
    const to = points[run.end + 1].recordedAt;
    return {
      mode: run.mode,
      start: run.start,
      end: run.end + 1,
      from,
      to,
      meters: Math.round(meters),
      minutes: Math.round((to.getTime() - from.getTime()) / 60_000),
    };
  });
}

type Run = { mode: MoveMode; start: number; end: number };

function toRuns(label: MoveMode[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < label.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.mode === label[i]) last.end = i;
    else runs.push({ mode: label[i], start: i, end: i });
  }
  return runs;
}

/** Склеює сусідів, які після переоцінки стали однаковими. */
function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && last.mode === run.mode) last.end = run.end;
    else out.push({ ...run });
  }
  return out;
}

/** Скільки кілометрів чим пройдено — підсумок для картки дня. */
export function movementTotals(segments: MoveSegment[]): Record<MoveMode, { km: number; minutes: number }> {
  const totals: Record<MoveMode, { km: number; minutes: number }> = {
    DRIVE: { km: 0, minutes: 0 },
    WALK: { km: 0, minutes: 0 },
    STOP: { km: 0, minutes: 0 },
  };
  for (const s of segments) {
    totals[s.mode].km += s.meters / 1000;
    totals[s.mode].minutes += s.minutes;
  }
  for (const mode of Object.keys(totals) as MoveMode[]) {
    totals[mode].km = Math.round(totals[mode].km * 10) / 10;
  }
  return totals;
}
