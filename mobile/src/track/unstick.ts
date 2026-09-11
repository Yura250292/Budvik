/**
 * Застряглий контекст: служба жива, а застосунок її не чує — перезавантажити.
 *
 * ЩО ЦЕ ЗА СТАН. Служба локації працює нативно й збирає фікси, а JS-колбек у
 * цьому контексті не викликається — годинами. `fixBatches` стоїть, точок
 * немає, пульсу немає (його шле той самий колбек). Із сервера це виглядає як
 * мертвий планшет. А потім контекст перезапускається — і система віддає ВСЕ,
 * що назбирала, однією пачкою.
 *
 * Спостережено чотири рази за дві доби, і щоразу ліками був саме рестарт:
 *   10.09 Кулик — 3143 пачки за хвилину після OTA о 14:30, `fixBatches` до
 *         того стояв на 764 двадцять шість годин у живому контексті;
 *   11.09 Олександр — 83 хв тиші, 202 точки одразу після рестарту о 08:48;
 *   11.09 Ігор — `start_ok` о 08:22:29, 84 хв тиші, рестарт о 09:46 — і
 *         262 точки, записані з 08:22:27 до 09:46:08. На планшеті, де
 *         будильник б'є кожні 15 хвилин, тобто сторож приходив і нічого не міг.
 *
 * ЧОМУ НЕ ПЕРЕПІДПИСКА. `ensureFreshFixes` уже робить стоп + старт, і в цих
 * випадках воно не допомагало: `start_ok` лягав у журнал, колбек далі мовчав.
 * А старт із фону Android ще й відмовляє — тож перепідписка поза вікном
 * дозволу добиває трек. Рестарт контексту — інша дія: нативна служба живе
 * далі, новий контекст до неї чіпляється на холодному старті
 * (controller.ts: heartbeat → shouldTrack → startTracking(force)).
 *
 * ЧОМУ ЦЕ БЕЗПЕЧНО ЛИШЕ ЗА УМОВИ. 04.09 перезавантаження посеред зміни вбило
 * живий трек (див. use-auto-update.ts): служби вже не було, і новий контекст
 * не зміг її підняти з фону. Різниця з нашими чотирма випадками одна — там
 * служба була МЕРТВА, тут вона ЖИВА. Тому головний запобіжник — проба системи
 * з 1.6.3: перезавантажуємо, лише якщо `LocationTaskService` справді в списку
 * власних служб. У збірках без проби — наосліп, але з рештою запобіжників:
 * там трек однаково мертвий, і гірше не стане.
 *
 * Запобіжники, кожен — проти конкретної біди:
 *   • лише SHIFT при відкритій зміні — дорогу додому не чіпаємо;
 *   • пачки без руху ≥ STALL_MS і контекст старший за MIN_CONTEXT_AGE_MS —
 *     перший фікс приходить не миттєво;
 *   • екран не активний — людина не має втратити недонабране;
 *   • не частіше RELOAD_EVERY_MS, мітка в SQLite — переживає сам рестарт,
 *     інакше застосунок помер би по колу;
 *   • щойно перепідписались — дати їй хвилину, не рвати одразу.
 */

import { AppState } from "react-native";
import * as Updates from "expo-updates";
import { systemProbe } from "@modules/track-guard";
import { within } from "@/lib/within";
import { contextStats, getMode, isShiftOpen, setLastError } from "./state";
import { getMeta, logEvent, setMeta } from "./db";
import { heartbeat } from "./uploader";

/** Скільки пачки мають стояти на місці, щоб контекст вважати застряглим. */
const STALL_MS = 20 * 60_000;
/** Молодший контекст не чіпаємо: перший фікс і перша пачка приходять не одразу. */
const MIN_CONTEXT_AGE_MS = 15 * 60_000;
/** Не частіше — інакше планшет, якому рестарт не допомагає, крутився б по колу. */
const RELOAD_EVERY_MS = 30 * 60_000;
const RELOAD_KEY = "unstickReloadAt";

/** Ім'я служби expo-location у власному списку (зірочка — передній план). */
const SERVICE = "LocationTaskService";

let seenBatches = -1;
let seenAt = 0;

export type UnstickResult =
  | "не-зміна"
  | "рухається"
  | "зарано"
  | "перепідписались-щойно"
  | "екран-активний"
  | "служби-немає"
  | "нещодавно"
  | "перезавантажую"
  | "не-вдалося";

export async function reloadIfStuck(
  source: string,
  opts: { justResubscribed?: boolean } = {}
): Promise<UnstickResult> {
  const [mode, open] = await Promise.all([getMode(), isShiftOpen()]);
  if (mode !== "SHIFT" || !open) return "не-зміна";

  const stats = contextStats();
  const now = Date.now();

  /**
   * Перший погляд на контекст: якщо пачок нуль, застій рахуємо від його
   * народження — ми ЗНАЄМО, що з тієї миті нічого не прийшло. Інакше Ігор
   * втратив би ще пів години на «побачити двічі те саме число».
   */
  if (seenBatches === -1) {
    seenBatches = stats.batches;
    seenAt = stats.batches === 0 ? stats.startedAt : now;
  } else if (stats.batches !== seenBatches) {
    seenBatches = stats.batches;
    seenAt = now;
    return "рухається";
  }

  if (now - stats.startedAt < MIN_CONTEXT_AGE_MS || now - seenAt < STALL_MS) return "зарано";
  if (opts.justResubscribed) return "перепідписались-щойно";
  if (AppState.currentState === "active") return "екран-активний";

  const probe = systemProbe();
  const serviceAlive = probe.available
    ? (probe.services ?? []).some((s) => s.startsWith(SERVICE))
    : null;
  if (serviceAlive === false) {
    // Це випадок 04.09: служби немає, рестарт її не підніме. Лишаємо людині.
    await setLastError("контекст застряг, а служби немає — чекаємо переднього плану").catch(() => {});
    return "служби-немає";
  }

  const last = Number(await getMeta(RELOAD_KEY).catch(() => null)) || 0;
  if (now - last < RELOAD_EVERY_MS) return "нещодавно";
  await setMeta(RELOAD_KEY, String(now)).catch(() => {});

  const minutes = Math.round((now - seenAt) / 60_000);
  const why =
    `${source}: пачок ${stats.batches} без руху ${minutes} хв, ` +
    `служба ${serviceAlive === null ? "не питали" : "жива"}`;
  await logEvent("reload", why.slice(0, 180));
  // Сервер мусить побачити рішення ДО рестарту: після нього цей контекст німий.
  await within(heartbeat(true), 10_000, null).catch(() => {});

  try {
    await Updates.reloadAsync();
    return "перезавантажую";
  } catch (e) {
    await logEvent("reload", `не вдалося: ${e instanceof Error ? e.message : String(e)}`.slice(0, 180));
    return "не-вдалося";
  }
}
