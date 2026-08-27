/**
 * Яка це збірка: магазин чи робоча.
 *
 * Код спільний, а конфігурації дві (див. app.config.ts). Різниця не
 * косметична: у сторовій збірці немає модулів локації взагалі, і кабінет
 * працівника там не відкривається — інакше рецензент Apple, отримавши
 * демо-акаунт, потрапляв би в ERP-панель усередині «застосунку магазину».
 */

import Constants from "expo-constants";
import * as Application from "expo-application";

export type Flavor = "shop" | "staff";

/**
 * Ім'я пакета — головне джерело, `extra.flavor` — запасне.
 *
 * `extra.flavor` приходить із маніфеста оновлення, тобто його може принести
 * публікація «повітрям». Опублікувати без APP_FLAVOR=staff — і робоча збірка
 * вирішила б, що вона магазин, та сховала кабінет у людини в полі. Ім'я пакета
 * зашите в APK і жодним оновленням не змінюється, тож воно й вирішує.
 *
 * (Другий запобіжник — flavor усередині runtimeVersion: така публікація просто
 * не збігається з установленою збіркою. Але покладатися на один замок там, де
 * ціна помилки — непрацездатний застосунок на цілий день, не варто.)
 */
const PACKAGE_FLAVOR: Flavor | null =
  Application.applicationId === "ua.budvik.staff"
    ? "staff"
    : Application.applicationId === "ua.budvik.shop"
      ? "shop"
      : null;

export const FLAVOR: Flavor =
  PACKAGE_FLAVOR ?? (Constants.expoConfig?.extra?.flavor as Flavor | undefined) ?? "shop";

/** Робоча збірка: кабінет торгового й водія, фоновий трек. Роздається файлом. */
export const IS_STAFF_BUILD = FLAVOR === "staff";
