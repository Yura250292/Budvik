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
import * as Location from "expo-location";
import type { LocationObject } from "expo-location";
import { IS_STAFF_BUILD } from "@/lib/flavor";
import { AFTER_SHIFT_TASK, TRACK_TASK, WATCHDOG_TASK } from "./task-name";
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

  /**
   * Машина виїхала з кола навколо місця, де закрилася зміна.
   *
   * Це і є момент, заради якого геозона ставилася: до нього процес спав, і
   * батарея за ніч не витрачалася. Тепер вмикаємо розріджений запис — саме він
   * відповідає на питання «чи не таксував після роботи».
   */
  TaskManager.defineTask<{ eventType: Location.LocationGeofencingEventType }>(
    AFTER_SHIFT_TASK,
    async ({ data, error }) => {
      if (error) return;
      if (data?.eventType !== Location.LocationGeofencingEventType.Exit) return;
      try {
        const { startTracking } = await import("./controller");
        const { disarmAfterShift } = await import("./after-shift");
        // Коло більше не потрібне: ми вже виїхали, і друге спрацювання нічого
        // не додасть, зате може перезапустити запис посеред дороги.
        await disarmAfterShift();
        await startTracking("AFTER_SHIFT");
      } catch {
        // Мовчки: завдання, що кинуло помилку, Android може перестати будити.
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
