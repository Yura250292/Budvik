/**
 * Яка це збірка: магазин чи робоча.
 *
 * Код спільний, а конфігурації дві (див. app.config.ts). Різниця не
 * косметична: у сторовій збірці немає модулів локації взагалі, і кабінет
 * працівника там не відкривається — інакше рецензент Apple, отримавши
 * демо-акаунт, потрапляв би в ERP-панель усередині «застосунку магазину».
 */

import Constants from "expo-constants";

export type Flavor = "shop" | "staff";

export const FLAVOR: Flavor =
  (Constants.expoConfig?.extra?.flavor as Flavor | undefined) ?? "shop";

/** Робоча збірка: кабінет торгового й водія, фоновий трек. Роздається файлом. */
export const IS_STAFF_BUILD = FLAVOR === "staff";
