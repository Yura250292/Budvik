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
};

/** Повідомлення від сайту до застосунку. */
export type BridgeMessage =
  | { type: "openShift" }
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
  function send(type) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: type }));
    }
  }
  window.BudvikApp = {
    openShift: function () { send("openShift"); },
    logout: function () { send("logout"); },
    downloadUpdate: function () { send("downloadUpdate"); },
    shiftStateJson: function () {
      return JSON.stringify({ open: s.shiftOpen, pending: s.pending });
    },
    appVersion: function () { return s.version; },
    appVersionCode: function () { return s.versionCode; },
    __set: function (next) { for (var k in next) { s[k] = next[k]; } }
  };
})(); true;`;
}

/** Розбір того, що прийшло з WebView. Чуже або зіпсоване — просто ігноруємо. */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  try {
    const data = JSON.parse(raw) as { type?: string };
    if (data.type === "openShift" || data.type === "logout" || data.type === "downloadUpdate") {
      return { type: data.type };
    }
  } catch {
    // Сторінка може слати власні повідомлення — це не помилка.
  }
  return null;
}
