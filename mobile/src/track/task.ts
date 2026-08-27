/**
 * Оголошення фонових завдань.
 *
 * Мусить виконатися на верхньому рівні модуля і ДО того, як застосунок покаже
 * перший екран: Android піднімає процес заради самого завдання, без жодного
 * інтерфейсу, і якщо на той момент defineTask ще не викликано, система вважає
 * завдання неіснуючим і більше його не будить. Тому цей файл — перший імпорт
 * у кореневому layout.
 *
 * Оголошення живуть лише в робочій збірці: у магазині модулі локації хоч і
 * прилінковані, але дозволів немає, і завдання там — мертвий код.
 */

import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import type { LocationObject } from "expo-location";
import { IS_STAFF_BUILD } from "@/lib/flavor";
import { TRACK_TASK, WATCHDOG_TASK } from "./task-name";
import { onLocations } from "./recorder";
import { runWatchdog } from "./watchdog";

if (IS_STAFF_BUILD) {
  TaskManager.defineTask<{ locations: LocationObject[] }>(
    TRACK_TASK,
    async ({ data, error }) => {
      if (error) return;
      const locations = data?.locations ?? [];
      if (locations.length === 0) return;
      try {
        await onLocations(locations);
      } catch {
        /**
         * Виняток тут гасимо навмисно. Завдання, яке кинуло помилку, Android
         * може перестати будити — тобто одна невдала відправка коштувала б
         * усього подальшого дня. Причина осідає в lastError і їде з пульсом.
         */
      }
    }
  );

  TaskManager.defineTask(WATCHDOG_TASK, async () => {
    try {
      await runWatchdog();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}
