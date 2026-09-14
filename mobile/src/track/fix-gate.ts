/**
 * Які фікси йдуть у трек — рішення окремо від запису.
 *
 * Жило всередині `recorder.ts` і там же мовчки різало поїздки. 14.09.2026
 * пульси Джумаги показали 9 пачок фіксів за три хвилини їзди (31 км/год,
 * 1,7 км) і ОДНУ записану точку. Між записаними — рівно шість інтервалів по
 * двадцять секунд: п'ять відкинутих поспіль і шоста «хай там що». Причина —
 * правило дрейфу: воно вірило приладу, коли той каже «швидкість 0», а планшети
 * Lenovo кажуть це і на п'ятдесяти кілометрах на годину (07.09 у Ігоря швидкість
 * скаче 40→0, 50→0, 109→0 між сусідніми фіксами).
 *
 * **Що змінилося.** Підозрілий фікс більше не відкидається одразу — його
 * ПРИТРИМУЄМО до наступного. Вус від руху відрізняє не прилад, а те, куди
 * пішов слід далі: вус повертається туди, звідки вистрілив, а машина їде далі.
 * Ціна — одна точка затримки, і лише для підозрілих фіксів.
 *
 * **Чому окремий файл без жодного імпорту Expo.** Щоб рішення можна було
 * прогнати на справжніх треках з бази (`scripts/check-fix-gate.mts`), а не
 * вірити, що воно правильне. Застосунок і перевірка кличуть той самий код.
 */

/** Гірше за це — не координата, а вежа. */
export const MAX_ACCURACY_M = 1000;

/**
 * Між цим і MAX_ACCURACY_M фікс лишаємо лише в русі.
 *
 * Стоячи слабкий фікс — це чистий шум, а в русі він краще за розрив.
 */
export const WEAK_ACCURACY_M = 100;

/** Нижче цієї швидкості прилад вважає, що стоїть. */
export const STANDING_KMH = 3;

/**
 * Швидкість, яку стрибок мусив би розвинути, щоб бути справжнім рухом.
 *
 * Дрейф серед забудови: сигнал відбивається від будинків, приймач упевнено
 * каже «похибка 25 м» і кидає позицію на пів кілометра. 03.09 у Ігоря за дві
 * години стоянки такі стрибки сягали 539, 374 і 858 метрів — усі при нульовій
 * швидкості й чесній похибці.
 */
export const DRIFT_KMH = 10;

/** Поки не зрушили на стільки — пишемо не частіше, ніж раз на хвилину. */
export const MOVE_M = 25;
export const IDLE_WRITE_MS = 60_000;

export type GateFix = {
  /** Час фікса, мс. */
  at: number;
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** Швидкість, яку звітує прилад; null — не звітує. */
  kmh: number | null;
};

export type LastWritten = { at: number; lat: number; lng: number } | null;

/**
 * Лічильники за життя контексту — відповідь на «куди поділися фікси».
 *
 * Без них 14.09 довелося виводити причину з інтервалів між точками. Тепер
 * пульс каже прямо, скільки фіксів прийшло і скільки з них відсіяв кожен фільтр.
 */
export type GateCounters = {
  /** Прийшло від системи. */
  seen: number;
  /** Пішло в буфер. */
  written: number;
  /** Гірше за MAX_ACCURACY_M. */
  accuracy: number;
  /** Слабкий фікс на місці. */
  weak: number;
  /** Не зрушили й не минула хвилина. */
  idle: number;
  /** Притримано як підозру на дрейф. */
  held: number;
  /** З притриманих — підтверджено як вус і відкинуто. */
  spur: number;
};

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type FixGate<T extends GateFix> = {
  /**
   * Приймає черговий фікс і каже, що записати — у порядку запису.
   *
   * Може повернути два фікси (притриманий, який виявився рухом, і поточний),
   * один або жодного. Після запису кожного викликач мусить оновити «останню
   * записану» — від неї рахується наступне рішення.
   */
  decide(fix: T, last: LastWritten): T[];
  counters(): GateCounters;
};

export function createFixGate<T extends GateFix>(): FixGate<T> {
  let pending: T | null = null;
  const c: GateCounters = { seen: 0, written: 0, accuracy: 0, weak: 0, idle: 0, held: 0, spur: 0 };

  function decide(fix: T, last: LastWritten): T[] {
    c.seen++;

    if (fix.accuracyM != null && fix.accuracyM > MAX_ACCURACY_M) {
      c.accuracy++;
      return [];
    }
    if (
      fix.accuracyM != null &&
      fix.accuracyM > WEAK_ACCURACY_M &&
      (fix.kmh === null || fix.kmh < STANDING_KMH)
    ) {
      c.weak++;
      return [];
    }

    const out: T[] = [];
    let base: LastWritten = last;

    /**
     * Спершу — долю притриманого, бо від неї залежить, від чого рахувати цей.
     *
     * Вус: поточний фікс ближче до останньої записаної, ніж до притриманого —
     * слід повернувся. Рух: слід пішов від притриманого далі або лишився біля
     * нього (машина доїхала й стала).
     */
    if (pending) {
      const held = pending;
      pending = null;
      const fromBase = base ? haversineM(base.lat, base.lng, fix.lat, fix.lng) : Infinity;
      const fromHeld = haversineM(held.lat, held.lng, fix.lat, fix.lng);
      if (base && fromBase < fromHeld) {
        c.spur++;
      } else {
        out.push(held);
        base = held;
      }
    }

    const movedM = base ? haversineM(base.lat, base.lng, fix.lat, fix.lng) : Infinity;
    const waitedMs = base ? fix.at - base.at : Infinity;

    if (movedM < MOVE_M && waitedMs < IDLE_WRITE_MS) {
      c.idle++;
      c.written += out.length;
      return out;
    }

    /**
     * Прилад каже «стою», а точка вимагає руху — не віримо жодному з двох,
     * поки не побачимо наступний фікс.
     */
    if (base && fix.kmh != null && fix.kmh < STANDING_KMH && waitedMs > 0) {
      const impliedKmh = movedM / 1000 / (waitedMs / 3_600_000);
      if (impliedKmh > DRIFT_KMH) {
        pending = fix;
        c.held++;
        c.written += out.length;
        return out;
      }
    }

    out.push(fix);
    c.written += out.length;
    return out;
  }

  return { decide, counters: () => ({ ...c }) };
}

/** Фікс, як його бачить записувач: разом із тим, що піде в точку. */
export type RecordedFix = GateFix & { heading: number | null; speed: number | null };

/**
 * Одна заслінка на контекст JS.
 *
 * Модульна змінна навмисно — як і лічильники пачок у state.ts: притриманий фікс
 * і лічильники мусять жити рівно стільки, скільки живе контекст, і пульс читає
 * їх звідси, не імпортуючи записувач (той сам імпортує пульс).
 */
export const contextGate = createFixGate<RecordedFix>();

/** Короткий рядок для пульсу: сервер обрізає статус. */
export function describeCounters(k: GateCounters): string {
  return `фікси ${k.seen}→${k.written} (стоянка ${k.idle}, слабкі ${k.accuracy + k.weak}, притримано ${k.held}, вусів ${k.spur})`;
}
