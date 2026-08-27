/**
 * Стан пристрою для пульсу.
 *
 * Ці поля не потрібні застосунку — вони потрібні офісу, коли трек обірвався і
 * треба відповісти чому. Без них у журналі лишається саме мовчання, і
 * «планшет вимкнули», «дозвіл збили на "лише під час використання"» та
 * «система приспала службу заради батареї» виглядають однаково.
 *
 * Значення навмисно ті самі рядки, що шле Kotlin-трекер (DeviceState.kt):
 * поки в полі співіснують обидва застосунки, адмінка має показувати одну
 * шкалу, а не дві.
 */

import * as Location from "expo-location";
import * as Battery from "expo-battery";

export type DeviceState = {
  /** DENIED | WHILE_USING | ALWAYS — як у Kotlin-трекері. */
  locationPermission: string;
  /** GPS | NETWORK | OFF. */
  locationMode: string;
  batteryPct: number | null;
  /**
   * Чи має система право приспати застосунок заради батареї.
   *
   * `true` — має, і це найгірший стан із можливих: саме він ховається за
   * «трек обірвався серед дня і сам відновився через пів години». За даними
   * пульсів станом на 27.08 він увімкнений на ВСІХ планшетах, і саме звідси
   * розриви по кілька годин у маршрутах.
   */
  batteryOptimized: boolean | null;
};

export async function readDeviceState(): Promise<DeviceState> {
  const [fg, bg, provider, pct, optimized] = await Promise.all([
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
    Location.getProviderStatusAsync().catch(() => null),
    Battery.getBatteryLevelAsync().catch(() => -1),
    // Полярність та сама, що в Kotlin: true = система МОЖЕ приспати застосунок.
    Battery.isBatteryOptimizationEnabledAsync().catch(() => null),
  ]);

  const locationPermission = !fg?.granted ? "DENIED" : bg?.granted ? "ALWAYS" : "WHILE_USING";

  const locationMode = !provider?.locationServicesEnabled
    ? "OFF"
    : provider.gpsAvailable
      ? "GPS"
      : provider.networkAvailable
        ? "NETWORK"
        : "OFF";

  return {
    locationPermission,
    locationMode,
    // getBatteryLevelAsync віддає частку 0..1 або -1, коли система мовчить.
    batteryPct: pct != null && pct >= 0 ? Math.round(pct * 100) : null,
    batteryOptimized: optimized,
  };
}
