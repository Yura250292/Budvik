/**
 * Диспетчер віддає події, а цей контекст JS не отримує жодної — перезапустити.
 *
 * ЩО ЦЕ ЗА СТАН. У процесі може існувати кілька екземплярів внутрішнього
 * модуля expo-task-manager (свій на кожен реєстр модулів). Диспетчер тримає
 * ОСТАННІЙ зареєстрований, а JS підписується на той, що дістався його
 * AppContext. Коли це різні екземпляри, події — координати, сторож, пуші —
 * лягають у чергу в пам'яті того, кого ніхто не читає, і лишаються там до
 * смерті процесу. Служба при цьому в передньому плані, приймач дає фікси,
 * дозволи на місці, застосунок вважає, що пише.
 *
 * Планшет Передрія прожив так п'ять днів (17–22.09.2026): 8619 відданих подій,
 * жодної обробленої, чотири зміни без жодної точки. Джумага того ж тижня провів
 * так ніч, і вилікувало його те, що людина вранці відкрила застосунок і
 * контекст JS піднявся заново.
 *
 * ЧОМУ РЕСТАРТ ЛІКУЄ. `Updates.reloadAsync` створює новий ReactInstance, а з
 * ним новий реєстр модулів і новий екземпляр — саме той, на який JS одразу й
 * підпишеться. Нативна служба локації при цьому живе далі, її ніхто не чіпає.
 *
 * ЧОМУ САМЕ З ПЕРЕДНЬОГО ПЛАНУ (на відміну від `unstick.ts`, який навпаки
 * відмовляється діяти при активному екрані). Після рестарту застосунок мусить
 * підняти запис, а Android від 12-ї версії не дає стартувати службу переднього
 * плану з фону. У фоні це був би рестарт без відновлення — тобто гірше, ніж
 * нічого.
 *
 * Запобіжники, кожен — проти конкретної біди:
 *   • стан мусить протриматися CONFIRM_MS і два спостереження — щоб рестарт не
 *     стався в першу секунду після того, як людина відкрила застосунок, і не
 *     забрав із собою недороблену дію (фото одометра, нотатку);
 *   • лише при відкритій зміні в режимі SHIFT — поза зміною втрачати нічого;
 *   • контекст старший за MIN_CONTEXT_AGE_MS: перші події приходять не миттєво;
 *   • лічильники беремо ВІД ПОЧАТКУ ЦЬОГО контексту, а не від старту процесу:
 *     вони процесні й переживають рестарт JS, тож абсолютне число після
 *     першого ж лікування вже нічого не означало б;
 *   • не частіше RELOAD_EVERY_MS, мітка спільна з `unstick.ts`.
 */

import { AppState } from "react-native";
import * as Updates from "expo-updates";
import { diagSnapshot } from "@modules/track-guard";
import { within } from "@/lib/within";
import { contextStats, contextTaskEvents, getMode, isShiftOpen } from "./state";
import { getMeta, logEvent, setMeta } from "./db";
import { heartbeat } from "./uploader";
import { RELOAD_EVERY_MS, RELOAD_KEY } from "./unstick";

/** Молодший контекст не чіпаємо: перша подія приходить не в першу секунду. */
const MIN_CONTEXT_AGE_MS = 15 * 60_000;
/** Скільки подій мусить піти повз нас, щоб це не було збігом. */
const DELIVERED_MIN = 5;
/** Скільки стан мусить протриматися на очах, перш ніж рвати контекст. */
const CONFIRM_MS = 90_000;

type Counters = { direct: number; finished: number };

/** Лічильники диспетчера на момент, коли цей контекст JS почав дивитися. */
let base: Counters | null = null;
let deafSince = 0;

export type DeafResult =
  | "не-зміна"
  | "екран-не-активний"
  | "немає-знімка"
  | "зарано"
  | "події-доходять"
  | "чекаємо-підтвердження"
  | "нещодавно"
  | "перезавантажую"
  | "не-вдалося";

/** Лічильники диспетчера з нативного знімка; null — збірка їх не вміє. */
function counters(): Counters | null {
  const snap = diagSnapshot();
  const ts = snap?.taskService as { execDirect?: number; finished?: number } | undefined;
  if (!ts || typeof ts !== "object" || typeof ts.execDirect !== "number") return null;
  return { direct: ts.execDirect, finished: ts.finished ?? 0 };
}

export async function reloadIfDeaf(source: string): Promise<DeafResult> {
  /**
   * Лічильники читаємо ПЕРШИМИ й завжди: базу треба встигнути зняти навіть у
   * тих проходах, які далі відмовляються діяти, — інакше перший придатний
   * прохід не мав би з чим порівнювати.
   */
  const now = counters();
  if (!now) return "немає-знімка";
  if (!base) base = now;

  if (AppState.currentState !== "active") return "екран-не-активний";

  const [mode, open] = await Promise.all([getMode(), isShiftOpen()]);
  if (mode !== "SHIFT" || !open) return "не-зміна";

  const stats = contextStats();
  if (Date.now() - stats.startedAt < MIN_CONTEXT_AGE_MS) return "зарано";

  const delivered = now.direct - base.direct;
  const closed = now.finished - base.finished;
  const channels = contextTaskEvents();
  const heard = Object.values(channels).some((c) => c.n > 0);

  /**
   * Три докази того самого, і потрібні всі: диспетчер віддавав події, жодної не
   * закрито, і сам застосунок жодної не бачив. Поодинці кожен має невинне
   * пояснення — затримка доставки, довга робота, тиха доба.
   */
  if (heard || delivered < DELIVERED_MIN || closed > 0) {
    deafSince = 0;
    return "події-доходять";
  }

  if (!deafSince) {
    deafSince = Date.now();
    return "чекаємо-підтвердження";
  }
  if (Date.now() - deafSince < CONFIRM_MS) return "чекаємо-підтвердження";

  const last = Number(await getMeta(RELOAD_KEY).catch(() => null)) || 0;
  if (Date.now() - last < RELOAD_EVERY_MS) return "нещодавно";
  await setMeta(RELOAD_KEY, String(Date.now())).catch(() => {});

  await logEvent(
    "reload",
    `${source}: диспетчер віддав ${delivered} подій, застосунок не отримав жодної`.slice(0, 180)
  );
  // Сервер мусить побачити рішення ДО рестарту: після нього цей контекст німий.
  await within(heartbeat(true), 10_000, null).catch(() => {});

  try {
    await Updates.reloadAsync();
    return "перезавантажую";
  } catch (e) {
    await logEvent(
      "reload",
      `глухий диспетчер, не вдалося: ${e instanceof Error ? e.message : String(e)}`.slice(0, 180)
    );
    return "не-вдалося";
  }
}
