"use client";

/**
 * Мікрофон у браузері й у WebView робочої збірки.
 *
 * Спільне для голосового питання помічникові (useVoiceInput.ts) і запису
 * наради (components/meetings/MeetingRecordingProvider.tsx). Уся наука про
 * те, як Android віддає мікрофон і що казати людині, коли не віддає, живе
 * тут в одному екземплярі — інакше друга копія розійшлася б із першою на
 * першому ж виправленні.
 */

export const recorderSupported = (): boolean =>
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof MediaRecorder !== "undefined";

/**
 * Відкрити мікрофон, з повторною спробою на «зайнято».
 *
 * Система віддає пристрій не миттєво: після того, як попередній потік
 * зупинено, наступний запит ще частку секунди може отримати NotReadableError.
 * Одна пауза перетворює «мікрофон зайнятий» на робочу кнопку; якщо його
 * справді тримає хтось інший, друга спроба провалиться так само, і людина
 * побачить чесний текст.
 *
 * `audio` — побажання до звуку (моно, шумодав). Пристрій, що їх не вміє,
 * відповідає OverconstrainedError — тоді просимо просто «будь-який мікрофон».
 */
export async function openMic(audio: MediaTrackConstraints | true = true): Promise<MediaStream> {
  const busy = (e: unknown) => {
    const name = e instanceof Error ? e.name : "";
    return name === "NotReadableError" || name === "AbortError";
  };
  const overconstrained = (e: unknown) => e instanceof Error && e.name === "OverconstrainedError";

  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (first) {
    if (overconstrained(first) && audio !== true) return openMic(true);
    if (!busy(first)) throw first;

    await new Promise((r) => setTimeout(r, 400));
    try {
      return await navigator.mediaDevices.getUserMedia({ audio });
    } catch (second) {
      if (!busy(second)) throw second;

      /**
       * Остання спроба — без обробки звуку.
       *
       * `{audio:true}` у Chromium означає ще й приглушення луни, шумодав і
       * автопідсилення, а це окремий шлях усередині Android: він уміє
       * відмовляти сам по собі, і тоді сторінка бачить те саме «зайнято»,
       * хоча мікрофон вільний. Без обробки якість трохи гірша, але запис
       * важливіший за ідеальний звук.
       */
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    }
  }
}

/**
 * Що система думає про мікрофон, коли ми всередині застосунку.
 *
 * Браузер про це не знає нічого: він бачить лише свій дозвіл сторінці, а
 * дозвіл САМОМУ застосунку лежить рівнем нижче. Тому питаємо застосунок.
 * Поза застосунком і в старих збірках — "unknown", і тоді нічого не
 * стверджуємо.
 */
function appMicPermission(): "granted" | "denied" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  try {
    return window.BudvikApp?.micPermission?.() ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Що сказати людині, коли мікрофон не відкрився.
 *
 * Кажемо, ЩО САМЕ сталося, а не «перевірте дозвіл». 07.09 власник оновив
 * застосунок, побачив «перевірте дозвіл», перевірив (дозвіл був) і лишився
 * без жодної підказки, що робити далі. Ім'я помилки розрізняє випадки, і
 * кожне має свою дію:
 *
 * - NotAllowedError / SecurityError — заборона на рівні сторінки;
 * - NotReadableError / AbortError — сторінці дозволили, а пристрій не
 *   відкрився. Тут ховаються ДВА різні стани, і браузер їх не розрізняє:
 *   дозволу немає в самого застосунку, або мікрофон справді хтось тримає.
 *   Розрізнити може лише застосунок, тому питаємо його;
 * - NotFoundError / OverconstrainedError — мікрофона немає.
 *
 * Головна помилка попередньої спроби була саме тут: NotReadableError
 * беззастережно списувався на «зайнятий іншим застосунком», і людина читала
 * звинувачення на адресу програми, якої не існувало.
 */
export function micErrorText(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  const bridge = typeof window !== "undefined" ? window.BudvikApp : undefined;
  const appPermission = appMicPermission();

  /**
   * Про кожну відмову дізнається сервер — інакше розбір знову буде здогадом.
   *
   * Скарга приходить словами («не працює мікрофон»), а різних станів під нею
   * щонайменше три, і ззовні вони нерозрізненні. Один рядок у журнал пристрою
   * (він уже їде разом із пульсом) робить їх видимими одразу по всіх
   * планшетах, а не по тому одному, чий екран нам показали.
   */
  bridge?.reportMic?.(`${name || "без імені"} · дозвіл=${appPermission}`);

  /* Застосунку мікрофон не дали — і саме це, а не «зайнято», треба лікувати. */
  if (appPermission === "denied") {
    bridge?.requestMic?.();
    return "Планшет не дав застосунку мікрофон. Дозвольте у вікні, що з'явиться, і натисніть ще раз";
  }

  if (name === "NotAllowedError" || name === "SecurityError") {
    if (bridge?.requestMic) {
      bridge.requestMic();
      return "Дозвольте мікрофон і натисніть ще раз";
    }
    return "Мікрофон заборонено — дозвольте його в налаштуваннях";
  }

  if (name === "NotReadableError" || name === "AbortError") {
    if (!bridge) return "Мікрофон не відкрився — його тримає інша вкладка або програма";

    /*
      Перевидання дозволу — єдине, що тут узагалі можна натиснути: якщо
      системи насправді дозволу не має, з'явиться діалог; якщо заборонено
      «назавжди», застосунок сам відкриє налаштування.
    */
    bridge.requestMic?.();

    /*
      «Не знаю» і «знаю, що дозвіл є» — РІЗНІ речі, і плутати їх не можна.
      Стверджувати можна лише те, що почули від застосунку.
    */
    return appPermission === "granted"
      ? "Планшет не віддає мікрофон, хоча дозвіл значиться виданим. Перевидайте його у вікні, що з'явиться, і натисніть ще раз"
      : "Планшет не віддає мікрофон. Перевидайте дозвіл у вікні, що з'явиться; якщо вікна немає — оновіть застосунок";
  }

  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Мікрофон не знайдено";
  }
  return `Мікрофон не запустився${name ? `: ${name}` : ""}`;
}
