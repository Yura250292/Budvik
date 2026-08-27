/**
 * Версія збірки й мітка, якою застосунок називає себе серверу.
 *
 * Окремим модулем, бо потрібна двом шарам API — покупецькому (src/api/client.ts)
 * і робочому (src/api/staff.ts). Якби вона жила в одному з них, другий тягнув
 * би його за собою, і вийшов би цикл імпортів.
 */

import Constants from "expo-constants";

export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
export const APP_VERSION_CODE = Number(Constants.expoConfig?.android?.versionCode ?? 0);

/**
 * Заголовок x-budvik-app.
 *
 * Дві ролі, обидві невидимі з коду: правило пропуску у фаєрволі сайту навішене
 * саме на нього (без цього нативні запити отримують 429 на проді й працюють
 * локально), а вхід із ним гасить інші робочі токени людини — тобто зупиняє
 * старий Kotlin-трекер.
 */
export const STAFF_APP_HEADER = `staff/${APP_VERSION_CODE}`;
