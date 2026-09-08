/**
 * Міст `window.BudvikApp` для кабінету у WebView.
 *
 * Сайт визначає «я всередині застосунку» саме за наявністю цього об'єкта, а не
 * за User-Agent і не за кукою: міст не протухає, не чиститься разом із сесією і
 * не може випадково опинитися у звичайному браузері. Контракт описаний на боці
 * сайту (src/lib/useIsNativeApp.ts) і тут відтворюється один в один — його
 * зміна означала б, що старі збірки в полі втрачають кнопку зміни.
 *
 * Три методи — команди (їх виконує застосунок), три — довідки, і саме тому
 * останні мусять бути СИНХРОННИМИ: сайт викликає `shiftStateJson()` просто в
 * рендері. postMessage тут не годиться — він асинхронний, і повернути з нього
 * значення нічим. Тому стан інжектується разом зі скриптом, а при кожній зміні
 * переінжектується через `__set`.
 */

export type BridgeState = {
  /** Чи відкрита зміна — для жовтої крапки на вкладці «Зміна». */
  shiftOpen: boolean;
  /** Скільки точок чекає відправки — видно людині, коли зв'язку немає. */
  pending: number;
  version: string;
  versionCode: number;
  /**
   * Що система насправді думає про мікрофон: "granted" | "denied" | "unknown".
   *
   * Без цього поля сторінка не могла відрізнити два стани, які виглядають
   * однаково: «дозволу немає» і «дозвіл є, але пристрій не відкривається».
   * Обидва прилітали як NotReadableError, і людині лишалося читати
   * «мікрофон зайнятий іншим застосунком», коли жодного іншого не було.
   *
   * "unknown" — старі збірки в полі, де поля ще немає: сторінка тоді
   * поводиться як раніше й нічого не стверджує.
   */
  micPermission?: "granted" | "denied" | "unknown";
};

/** Повідомлення від сайту до застосунку. */
export type BridgeMessage =
  | { type: "openShift" }
  | { type: "openScanner" }
  | { type: "openDay"; route?: string }
  | { type: "requestMic" }
  | { type: "openAppSettings" }
  | { type: "reportMic"; detail?: string }
  | { type: "logout" }
  | { type: "downloadUpdate" };

export function bridgeScript(state: BridgeState): string {
  const json = JSON.stringify(state);
  /**
   * Ідемпотентний навмисно: скрипт вставляється і перед завантаженням
   * документа, і після — на Android перший гачок інколи пропускає навігацію,
   * і без другого міст зникав би посеред роботи. Повторний запуск не створює
   * об'єкт наново, а лише оновлює стан.
   */
  return `(function () {
  if (window.BudvikApp && window.BudvikApp.__set) { window.BudvikApp.__set(${json}); return; }
  var s = ${json};
  function send(type, extra) {
    if (window.ReactNativeWebView) {
      var msg = { type: type };
      if (extra) { for (var k in extra) { if (extra[k]) msg[k] = extra[k]; } }
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }
  window.BudvikApp = {
    openShift: function () { send("openShift"); },
    /**
     * Сканер накладних складу.
     *
     * Через міст, а не посиланням: перехоплення адрес на Android працює лише
     * для СПРАВЖНЬОЇ навігації (shouldOverrideUrlLoading), а кабінет ходить
     * м'якими переходами Next — тобто дотик по кнопці відкривав би веб-сторінку
     * з полем файлу замість камери.
     */
    openScanner: function () { send("openScanner"); },
    /**
     * День водія — теж через міст, і з тієї самої причини, що й сканер.
     *
     * Досі він тримався лише на перехопленні адреси /driver/tablet, а воно
     * на Android спрацьовує тільки на СПРАВЖНІЙ навігації. Кнопка «Мій день»
     * у кабінеті — звичайний Link Next, тобто м'який перехід: перехоплення
     * мовчало, і водій відкривав веб-версію дня. Різниця не косметична —
     * саме в нативному екрані відмітка візиту лягає в чергу й переживає
     * відсутність зв'язку, а у WebView вона просто падає.
     */
    openDay: function (route) { send("openDay", { route: route }); },
    /**
     * Дозвіл на мікрофон просить САМ застосунок.
     *
     * WebView уміє питати його сам (RNCWebChromeClient.onPermissionRequest),
     * але на практиці діалог з'являється не завжди, і людина бачить
     * «мікрофон недоступний» при виданому в налаштуваннях дозволі. Тут
     * питаємо напряму через PermissionsAndroid — це ядро RN, без нових
     * нативних модулів, тож доїжджає повітрям.
     */
    requestMic: function () { send("requestMic"); },
    /**
     * Останній щабель: дозвіл заборонено «назавжди», і системний діалог уже
     * не з'явиться ніколи. Тоді єдиний шлях — екран налаштувань застосунку,
     * і відкрити його має застосунок, бо посилання туди з веба немає.
     */
    openAppSettings: function () { send("openAppSettings"); },
    /**
     * Сторінка розповідає, чим скінчилася спроба взяти мікрофон.
     *
     * Команда, а не довідка: відповідь тут не потрібна, потрібен слід. Рядок
     * лягає в журнал пристрою й доїжджає з пульсом, тож розбір бачить усі
     * планшети одразу, а не той один, чий екран нам показали.
     */
    reportMic: function (detail) { send("reportMic", { detail: String(detail || "") }); },
    logout: function () { send("logout"); },
    downloadUpdate: function () { send("downloadUpdate"); },
    shiftStateJson: function () {
      return JSON.stringify({ open: s.shiftOpen, pending: s.pending });
    },
    appVersion: function () { return s.version; },
    appVersionCode: function () { return s.versionCode; },
    /**
     * Довідка, а не команда: сторінка питає її в мить помилки, синхронно, і
     * саме тому відповідь мусить уже лежати в стані.
     */
    micPermission: function () { return s.micPermission || "unknown"; },
    __set: function (next) { for (var k in next) { s[k] = next[k]; } }
  };
})(); true;`;
}

/** Розбір того, що прийшло з WebView. Чуже або зіпсоване — просто ігноруємо. */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  try {
    const data = JSON.parse(raw) as { type?: string };
    if (
      data.type === "openShift" ||
      data.type === "openScanner" ||
      data.type === "openDay" ||
      data.type === "requestMic" ||
      data.type === "openAppSettings" ||
      data.type === "reportMic" ||
      data.type === "logout" ||
      data.type === "downloadUpdate"
    ) {
      // `route` несемо далі: без нього «Мій день» показав би не той
      // маршрутний лист, коли їх на добу два.
      const route = typeof (data as { route?: unknown }).route === "string"
        ? ((data as { route: string }).route)
        : undefined;
      if (data.type === "openDay") return { type: "openDay", route };
      if (data.type === "reportMic") {
        const detail = (data as { detail?: unknown }).detail;
        return { type: "reportMic", detail: typeof detail === "string" ? detail : undefined };
      }
      return { type: data.type } as BridgeMessage;
    }
  } catch {
    // Сторінка може слати власні повідомлення — це не помилка.
  }
  return null;
}
