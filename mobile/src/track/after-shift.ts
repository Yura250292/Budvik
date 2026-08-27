/**
 * Спостереження за рухом після закриття зміни.
 *
 * Постійний запис після роботи не потрібен нікому: він з'їдає батарею за ніч і
 * пише, як планшет лежить у дворі. Тому навколо точки, де зміна закрилася,
 * ставиться геозона на кілометр — і застосунок засинає повністю. Обслуговує її
 * системний провайдер, тож наш процес може бути вивантажений із пам'яті.
 *
 * Щойно машина вийшла за це коло — вмикається розріджений запис, і він триває,
 * поки не відкриється нова зміна. Саме це відповідає на питання «чи не таксував
 * після роботи», і саме так це працювало в Kotlin-трекері (AfterShiftWatcher).
 *
 * Перший підхід тут був простіший — просто писати трек раз на три хвилини до
 * півночі. Він давав ту саму відповідь, але ціною нічного розряду батареї й
 * кілометрів «дрейфу» на стоянці, які потім довелося б відрізняти від поїздок.
 */

import * as Location from "expo-location";
import { AFTER_SHIFT_TASK } from "./task-name";
import { getMeta, setMeta } from "./db";

/** Радіус, з якого рух вважається поїздкою, а не дрейфом GPS на стоянці. */
export const RADIUS_M = 1000;

const REGION_ID = "budvik-after-shift";
const KEY = "afterShiftArmed";

/** Чи стоїть зараз геозона (тобто чекаємо на виїзд). */
export async function isArmed(): Promise<boolean> {
  return (await getMeta(KEY)) === "1";
}

/**
 * Ставить коло навколо місця, де закінчилася зміна.
 *
 * Без координати нічого не робимо: геозона без центру неможлива, а вигадувати
 * центр — гірше, ніж не ставити нічого (застосунок «прокидався» б у випадковому
 * місці й писав чужий трек).
 */
export async function armAfterShift(center: { lat: number; lng: number } | null): Promise<void> {
  if (!center) return;

  const perms = await Location.getBackgroundPermissionsAsync().catch(() => null);
  // Без фонового дозволу геозона не працює — система просто не буде будити.
  if (!perms?.granted) return;

  try {
    await Location.startGeofencingAsync(AFTER_SHIFT_TASK, [
      {
        identifier: REGION_ID,
        latitude: center.lat,
        longitude: center.lng,
        radius: RADIUS_M,
        // Вхід нас не цікавить: ми вже всередині кола, коли його ставимо.
        notifyOnEnter: false,
        notifyOnExit: true,
      },
    ]);
    await setMeta(KEY, "1");
  } catch {
    // Геозона — це підстраховка, а не робота. Не вдалося поставити — день уже
    // записаний, і людину цим турбувати немає за що.
  }
}

/** Знімає коло — коли відкрилася нова зміна або людина вийшла з акаунта. */
export async function disarmAfterShift(): Promise<void> {
  await setMeta(KEY, "0");
  const started = await Location.hasStartedGeofencingAsync(AFTER_SHIFT_TASK).catch(() => false);
  if (started) await Location.stopGeofencingAsync(AFTER_SHIFT_TASK).catch(() => {});
}
