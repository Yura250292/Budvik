/**
 * Повна діагностика в пульсі — щоб «чому сьогодні не пише» мало відповідь з бази.
 *
 * 15.09.2026 причину місячної біди знайшли не з пульсу, а статистикою по
 * дванадцяти днях: диспетчер фонових завдань expo «забував» живий контекст JS, і
 * координати складалися в чергу без читача. Жодне поле пульсу цього не
 * показувало. Тут зібрано те, що показує:
 *
 *   • хто будив ЦЕЙ контекст — окремо координати, сторож, пуш, геозона;
 *   • чи тримаємо відкритим перше завдання (патч expo-task-manager);
 *   • куди поділися фікси у записувачі;
 *   • нативний знімок track-guard (з 1.6.6): стан диспетчера, служби, процесу,
 *     причини смерті попередніх процесів.
 *
 * Сервер кладе останній знімок у SyncState (`app:staff:diag:<userId>`), а
 * історію дає нативний маяк — він шле свій знімок сам, без JS, тобто і тоді,
 * коли застосунок заморожений (див. modules/track-guard NativeBeacon.kt).
 */

import { AppState } from "react-native";
import { configureBeacon, diagSnapshot } from "@modules/track-guard";
import { API_BASE } from "@/api/client";
import { APP_BUILD } from "@/lib/app-version";
import { getToken } from "@/lib/auth-store";
import { logEvent } from "./db";
import { contextGate } from "./fix-gate";
import { contextStats, contextTaskEvents } from "./state";

type DispatchApp = { fg?: string; headless?: string; queued?: number };

let dispatchLostLogged = false;

export function collectDiag(taskRegistered: boolean | null): Record<string, unknown> {
  const native = diagSnapshot();
  const held = (globalThis as { __budvikTaskHold?: unknown }).__budvikTaskHold ?? null;

  /**
   * Контекст JS живий (ми ж виконуємося), а диспетчер його не бачить.
   *
   * Буває лише тоді, коли код іде з екрана: через завдання сюди в такому стані
   * не дістатися — жодне завдання не доходить. Раз на контекст, бо стан не
   * лікується сам, і повтори лише засмічували б журнал.
   */
  const apps = (native?.taskService as { state?: { apps?: Record<string, DispatchApp> } } | undefined)
    ?.state?.apps;
  if (apps && !dispatchLostLogged) {
    const lost = Object.values(apps).find((a) => a.fg !== "live" && a.headless !== "live");
    if (lost) {
      dispatchLostLogged = true;
      void logEvent("dispatch_lost", `диспетчер не бачить контексту JS, у черзі ${lost.queued ?? "?"}`);
    }
  }

  return {
    v: 1,
    at: Date.now(),
    appState: AppState.currentState,
    ctx: { ...contextStats(), channels: contextTaskEvents(), firstEventHeld: held },
    gate: contextGate.counters(),
    taskRegistered,
    native,
  };
}

/**
 * Дати нативному маяку адресу й токен.
 *
 * Токен живе в JS-сховищі, а маяк мусить працювати без JS — тож копію кладемо
 * в нативні налаштування на кожному пульсі. Дешево: це один запис у prefs, а
 * вихід з акаунта чи новий токен доїжджають самі.
 */
export async function armNativeBeacon(): Promise<void> {
  const token = await getToken().catch(() => null);
  if (token) configureBeacon(`${API_BASE}/api/track/native-beacon`, token, APP_BUILD);
}
