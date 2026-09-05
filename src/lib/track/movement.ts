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
  /**
   * Що каже про швидкість САМ прилад.
   *
   * Найсильніше свідчення з усіх, і довго не використовуване. Геометрія — це
   * здогад із двох координат, а це вимір допплера в приймачі. Там, де вони
   * розходяться, права зазвичай геометрія... але не завжди, див. нижче.
   */
  speedKmh?: number | null;
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

/** Зрушив за паузу далі — значить їхав; ближче — стояв на місці. */
const GAP_MOVED_M = 200;

/**
 * Нижче цієї швидкості прилад не вважає, що машина їде.
 *
 * П'ять, а не три: приймач у стоячій машині зрідка видає одиниці, і поріг у
 * три кілометри зробив би правило беззубим саме там, де воно потрібне.
 */
const DEVICE_MOVING_KMH = 5;

/**
 * Межі ділянки, до якої застосовне правило про мовчазний датчик.
 *
 * Довгу поїздку за свідченням приладу відкидати не можна: є планшети, які
 * звітують нуль і на трасі. А от кілометр за чверть години — це вже не
 * поїздка, і якщо прилад ще й каже «стою», то він каже правду.
 */
const SILENT_RUN_MAX_M = 1_500;
const SILENT_RUN_MAX_MS = 15 * 60_000;

/**
 * Наскільки широко треба розійтися, щоб це вважалося рухом.
 *
 * Найважливіший поріг тут, і взятий він із виміру, а не зі стелі. 03.09 у
 * Олександра три ділянки по пів години виглядали ходьбою: шлях 1,2–2,1 км,
 * середня 4 км/год. Насправді планшет не рухався взагалі — усі точки лежали
 * в коробці 60–80 метрів, а сам пристрій усі ті пів години звітував нульову
 * швидкість. Ці кілометри намалювало тремтіння приймача на місці.
 *
 * Сума відрізків для стоянки не показник у принципі: за пів години дрібних
 * стрибків набігає скільки завгодно. Показник — чи вийшла людина за коло.
 */
const STOP_SPREAD_M = 120;

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

  /**
   * «GAP» — службова мітка довгої паузи, яка не доживає до результату.
   *
   * Потрібна, щоб пауза не приклеїлася до сусідів. Планшет Передрія 03.09
   * віддавав фікси раз на десять хвилин: між ними людина проїжджала
   * кілометри, а по прямій виходило 5 км/год — і півтори години дороги
   * ставали «ходьбою». Пауза мусить рахуватися окремо й за іншим правилом,
   * тому вона розриває ділянку, а не тоне в її середній швидкості.
   */
  const label = raw.map((gap, i): MoveMode | "GAP" => {
    if (gap.ms > MAX_TRUSTED_GAP_MS) return "GAP";
    if (med[i] < STOP_KMH) return "STOP";
    return med[i] < WALK_KMH ? "WALK" : "DRIVE";
  });

  const runs = toRuns(label);

  /**
   * Остаточне слово — за СЕРЕДНЬОЮ швидкістю всієї ділянки, а не за
   * найшвидшою миттю в ній.
   *
   * Спершу тут стояв пік: мовляв, пішохід ніколи не проскочить 10 км/год, а
   * машина в заторі проскочить. Правило виявилося крихким рівно там, де
   * найдорожче. Один хибний фікс усередині — і дев'ять хвилин ходьби по
   * ринку ставали «їздою», яку матчер потім чесно розкладав вулицями. Саме
   * звідси бралася плутанина ліній у Винниках: 0,39 км за 9 хвилин, тобто
   * 2,6 км/год, намальовані як проїзд кварталами.
   *
   * Середня такого не вміє: щоб вона впала до 3 км/год, стояти має вся
   * ділянка, а не одна мить у ній.
   */
  for (const run of runs) {
    let meters = 0;
    for (let i = run.start; i <= run.end; i++) meters += raw[i].meters;
    /**
     * Пауза судиться не швидкістю, а відстанню: за пів години можна і
     * проїхати двадцять кілометрів, і простояти на місці, а середня по
     * прямій в обох випадках бреше.
     */
    if (run.mode === "GAP") {
      run.mode = meters >= GAP_MOVED_M ? "DRIVE" : "STOP";
      continue;
    }

    /**
     * Спершу — чи взагалі зрушили з місця, і аж потім швидкість. Порядок
     * тут і є виправленням: за середньою швидкістю тремтіння на місці
     * впевнено видає себе за ходьбу.
     */
    if (spreadM(points, run.start, run.end + 1) < STOP_SPREAD_M) {
      run.mode = "STOP";
      continue;
    }

    const ms = points[run.end + 1].recordedAt.getTime() - points[run.start].recordedAt.getTime();
    const kmh = ms > 0 ? (meters / ms) * 3_600_000 / 1000 : 0;
    run.mode = kmh < STOP_KMH ? "STOP" : kmh < WALK_KMH ? "WALK" : "DRIVE";
  }

  /**
   * Затор — це їзда, і ось як він відрізняється від ходьби.
   *
   * Не швидкістю: бус у корку повзе тими самими 5 км/год, що й пішохід. А
   * тим, що навколо. Корок — це середина поїздки: до нього їхали і після
   * нього поїхали, машина не зупинялася. Ходьба ж завжди між зупинками —
   * людина спершу стала, вийшла, і аж тоді пішла.
   *
   * Тому повільна ділянка, ЗАТИСНУТА їздою з обох боків, лишається їздою.
   * Край дня рахуємо як зупинку: день починається й закінчується на місці.
   */
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].mode !== "WALK") continue;
    const before = runs[i - 1]?.mode ?? "STOP";
    const after = runs[i + 1]?.mode ?? "STOP";
    if (before === "DRIVE" && after === "DRIVE") runs[i].mode = "DRIVE";
  }

  /**
   * Ділянка, у якій прилад ЖОДНОГО разу не показав руху, — не їзда.
   *
   * Геометрія тут регулярно бреше: приймач у селі чергує джерела (супутники
   * ±5 м і вежі ±60 м), і лінія смикається між двома паралельними шляхами.
   * Виходить «569 метрів за 3 хвилини, тобто 11 км/год» там, де машина
   * стояла — у Валентина 05.09 у Славську саме так.
   *
   * Дві умови, і обидві виміряні, а не вгадані.
   *
   * Перша: швидкість мусить бути відома в УСІХ точках ділянки — приймачі, які
   * її не віддають, під правило не потрапляють зовсім.
   *
   * Друга з'явилася після контрольного прогону: без неї правило зрізало
   * Кулику 04.09 дев'яносто чотири кілометри СПРАВЖНЬОЇ траси, бо його
   * планшет звітує нуль і на ходу. Тому чіпаємо лише короткі ділянки — там,
   * де хибна геометрія й живе, і де ціна помилки обмежена кількома сотнями
   * метрів.
   */
  for (const run of runs) {
    if (run.mode !== "DRIVE") continue;

    const meters = (() => {
      let m = 0;
      for (let i = run.start; i <= run.end; i++) m += raw[i].meters;
      return m;
    })();
    const ms = points[run.end + 1].recordedAt.getTime() - points[run.start].recordedAt.getTime();
    if (meters > SILENT_RUN_MAX_M || ms > SILENT_RUN_MAX_MS) continue;
    let known = 0;
    let moved = false;
    for (let i = run.start; i <= run.end + 1 && i < points.length; i++) {
      const kmh = points[i].speedKmh;
      if (kmh == null) {
        known = -1;
        break;
      }
      known++;
      if (kmh >= DEVICE_MOVING_KMH) {
        moved = true;
        break;
      }
    }
    if (known > 0 && !moved) run.mode = "STOP";
  }

  // Короткі ділянки — не спосіб пересування, а частина сусідньої.
  const spanMs = (r: { start: number; end: number }) =>
    points[r.end + 1].recordedAt.getTime() - points[r.start].recordedAt.getTime();
  for (const run of runs) {
    if (run.mode === "WALK" && spanMs(run) < MIN_WALK_MS) run.mode = "DRIVE";
    else if (run.mode === "STOP" && spanMs(run) < MIN_STOP_MS) run.mode = "DRIVE";
  }

  return merge(runs as Array<Run & { mode: MoveMode }>).map((run) => {
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

/**
 * Наскільки широко розкидані точки ділянки — діагональ коробки, що їх
 * охоплює. Саме це відрізняє «стояв» від «йшов»: сума дрібних стрибків
 * росте й на місці, а коробка — ні.
 */
function spreadM(points: MovePoint[], from: number, to: number): number {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (let i = from; i <= to; i++) {
    minLat = Math.min(minLat, points[i].lat);
    maxLat = Math.max(maxLat, points[i].lat);
    minLng = Math.min(minLng, points[i].lng);
    maxLng = Math.max(maxLng, points[i].lng);
  }
  return haversineM(
    { lat: minLat, lng: minLng, recordedAt: points[from].recordedAt },
    { lat: maxLat, lng: maxLng, recordedAt: points[from].recordedAt }
  );
}

type Run = { mode: MoveMode | "GAP"; start: number; end: number };

function toRuns(label: Array<MoveMode | "GAP">): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < label.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.mode === label[i]) last.end = i;
    else runs.push({ mode: label[i], start: i, end: i });
  }
  return runs;
}

/** Склеює сусідів, які після переоцінки стали однаковими. */
function merge(runs: Array<Run & { mode: MoveMode }>): Array<Run & { mode: MoveMode }> {
  const out: Array<Run & { mode: MoveMode }> = [];
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
