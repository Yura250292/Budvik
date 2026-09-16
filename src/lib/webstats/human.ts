/**
 * Людина чи бот — за поведінкою в браузері.
 *
 * Хвиля 01–13.09.2026 (1661 «відвідувач» з Індії, Бангладеш, Бразилії)
 * пройшла і JS-челендж Vercel, і перевірку User-Agent: це справжні браузери
 * на чужих машинах. Зате поводились вони однаково — завантажили сторінку й
 * пішли, не поворухнувши мишею. Тому «людина» — це не заголовок запиту, а
 * те, що відвідувач зробив:
 *
 *   input — справжнє введення (миша, колесо, дотик, клавіша), і вкладка
 *           при цьому була видима хоча б 3 с;
 *   nav   — відкрив ІНШУ сторінку (боти з хвилі перезавантажували ту саму
 *           через 11–12 с);
 *   dwell — 30 с видимої вкладки без жодного руху: читач, що не торкається.
 *
 * Рішення — чисті функції, їх перевіряє scripts/check-human-signals.mts без
 * браузера. watchHuman лише збирає ознаки й кличе рішення.
 */

export type HumanVerdict = "input" | "nav" | "dwell";

export interface HumanSignals {
  /** Скільки мілісекунд вкладка була видима. */
  visibleMs: number;
  /** Було справжнє введення. */
  input: boolean;
  /** Скільки різних адрес відкрито за життя сторінки. */
  distinctPaths: number;
  /** Браузер видає себе як автомат. */
  automated: boolean;
}

export interface BrowserTraits {
  webdriver: boolean;
  languages: number;
  userAgent: string;
  hasChromeObject: boolean;
}

/** Менше — це «клацнув і пішов», доказом не рахується навіть із рухом. */
export const MIN_VISIBLE_MS = 3_000;
/** Затримка без руху, після якої віримо, що це читач. Боти з хвилі тримали 12 с. */
export const DWELL_ONLY_MS = 30_000;

export function humanVerdict(s: HumanSignals): HumanVerdict | null {
  if (s.automated) return null;
  if (s.visibleMs < MIN_VISIBLE_MS) return null;
  if (s.input) return "input";
  if (s.distinctPaths >= 2) return "nav";
  if (s.visibleMs >= DWELL_ONLY_MS) return "dwell";
  return null;
}

export function isAutomated(b: BrowserTraits): boolean {
  if (b.webdriver) return true;
  // Справжній браузер завжди знає хоча б одну мову; порожній список — старий
  // headless.
  if (b.languages === 0) return true;
  // Chrome на комп'ютері завжди має window.chrome; без нього — headless або
  // підроблений User-Agent. Телефони, WebView (Instagram, Facebook) і Chrome на
  // iPhone його не мають законно — їх не чіпаємо, інакше загубили б людей,
  // що прийшли за посиланням із соцмереж.
  const desktopChrome =
    /Chrome\//.test(b.userAgent) &&
    !/Mobile|Android|\bwv\b|CriOS|EdgiOS|SamsungBrowser|OPR\//.test(b.userAgent);
  return desktopChrome && !b.hasChromeObject;
}

/**
 * Події, яких скрипт на сторінці не підробить: isTrusted ставить сам браузер.
 * scroll навмисно немає — він trusted і тоді, коли сторінку гортає скрипт.
 */
const INPUT_EVENTS = ["pointermove", "pointerdown", "wheel", "touchstart", "keydown"] as const;

/** Як часто перераховувати видимий час, поки рішення не прийнято. */
const TICK_MS = 1_000;

/**
 * Стежить за відвідувачем і кличе onHuman, щойно той доведе, що людина.
 *
 * Кличе повторно на кожен тік — дедуплікацію по сесії робить той, хто
 * підписався (client.ts), бо сесія може змінитися, поки вкладка відкрита.
 */
export function watchHuman(onHuman: (verdict: HumanVerdict, visibleMs: number) => void) {
  const nav = window.navigator;
  const automated = isAutomated({
    webdriver: Boolean(nav.webdriver),
    languages: nav.languages ? nav.languages.length : 1,
    userAgent: nav.userAgent || "",
    hasChromeObject: "chrome" in window,
  });
  if (automated) return { notePath: () => {} };

  let input = false;
  let visibleMs = 0;
  let lastTick = Date.now();
  const paths = new Set<string>();

  const decide = () => {
    const now = Date.now();
    if (document.visibilityState === "visible") visibleMs += now - lastTick;
    lastTick = now;
    const verdict = humanVerdict({ visibleMs, input, distinctPaths: paths.size, automated });
    if (verdict) onHuman(verdict, visibleMs);
  };

  const onInput = (e: Event) => {
    if (!e.isTrusted || input) return;
    input = true;
    decide();
  };
  for (const type of INPUT_EVENTS) {
    window.addEventListener(type, onInput, { passive: true, capture: true });
  }
  setInterval(decide, TICK_MS);

  return {
    notePath(path: string) {
      paths.add(path);
      decide();
    },
  };
}
