/**
 * Чому трек не йде — однією фразою.
 *
 * Живе окремо, бо той самий висновок потрібен у трьох місцях: на карті
 * «На маршруті», у сповіщенні в Telegram і в картці самоперевірки. Якщо
 * писати його щоразу заново, вони почнуть розходитися — і найгірше саме
 * те, що розходження помітять не одразу: карта казатиме «немає зв'язку»,
 * а сповіщення «дозвіл не виданий», і людину пошлють перевіряти не те.
 *
 * Порядок перевірок — від причини до наслідку, і він тут головне.
 * Немає застосунку → немає пульсу → служба стоїть → немає дозволу →
 * батарея → вимкнена локація → немає неба → немає зв'язку. Кожна
 * наступна перевірка має сенс лише тоді, коли попередня пройшла.
 */

/** Скільки хвилин без пульсу означає, що застосунок не працює. */
export const HEARTBEAT_WINDOW_MIN = 10;

/** Скільки хвилин без свіжого фікса означає, що GPS не бачить неба. */
export const FIX_WINDOW_MIN = 10;

/** Точок у буфері, після яких зв'язок — уже проблема, а не пауза. */
export const BUFFER_ALARM = 50;

export type DeviceBeat = {
  /** Хвилин тому прийшов останній пульс. */
  minutesAgo: number | null;
  tracking: boolean;
  buffered: number;
  /** Хвилин тому був останній фікс GPS. */
  lastFixMinutesAgo: number | null;
  locationPermission: string | null;
  locationMode: string | null;
  batteryOptimized: boolean | null;
};

export type DiagnosisInput = {
  /** Чи зареєстрований хоч один планшет. */
  hasDevice: boolean;
  /** Чи відкрита зміна просто зараз. */
  shiftOpen: boolean;
  /** Останній пульс або null, якщо його не було зовсім. */
  beat: DeviceBeat | null;
};

/**
 * Повертає готову фразу для людини або null, якщо все гаразд.
 *
 * Мовчання при закритій зміні — не проблема: планшет має право спати.
 */
export function diagnose({ hasDevice, shiftOpen, beat }: DiagnosisInput): string | null {
  if (!hasDevice) return "Планшет не зареєстрований";

  if (!beat) {
    // Пульсу немає взагалі: або на планшеті збірка до 1.3, або
    // застосунок не запускався. Розрізнити зможемо, коли всі оновляться.
    return shiftOpen ? "Пульсу немає: стара збірка або застосунок не працює" : null;
  }

  if (beat.minutesAgo != null && beat.minutesAgo > HEARTBEAT_WINDOW_MIN) {
    return `Застосунок мовчить ${beat.minutesAgo} хв`;
  }

  if (!beat.tracking && shiftOpen) return "Запис вимкнено при відкритій зміні";

  if (beat.locationPermission && beat.locationPermission !== "ALWAYS") {
    return beat.locationPermission === "DENIED"
      ? "Дозвіл на локацію не виданий"
      : "Дозвіл лише «поки застосунок відкрито»";
  }

  if (beat.batteryOptimized === true) {
    return "Увімкнена економія батареї — Android глушить службу";
  }

  if (beat.locationMode === "OFF") {
    return "Геолокація вимкнена в налаштуваннях планшета";
  }

  if (beat.lastFixMinutesAgo != null && beat.lastFixMinutesAgo > FIX_WINDOW_MIN) {
    return `GPS не дає координат ${beat.lastFixMinutesAgo} хв`;
  }

  if (beat.buffered > BUFFER_ALARM) {
    return `Немає зв'язку: ${beat.buffered} точок чекають у планшеті`;
  }

  return null;
}
