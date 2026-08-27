import type { ExpoConfig } from "expo/config";

/**
 * Дві збірки з одного коду.
 *
 * Магазин і робочий кабінет — це один продукт і один код, але не один
 * опублікований застосунок, і це не питання зручності. Збірка працівника
 * пише фонову геолокацію: Apple вимагає пояснити, навіщо це публічному
 * застосунку, і не приймає відповіді «ми стежимо за своїми», а Play вимагає
 * окрему декларацію з відеодемонстрацією. Сховати кабінет за логіном теж не
 * вийде — рецензент отримує демо-акаунт і перевіряє все, що за ним.
 *
 * Тому в магазини їде збірка без жодного модуля локації, а працівники
 * отримують свою файлом із сайту — рівно так, як вони вже отримують трекер.
 *
 * Обирається змінною APP_FLAVOR (див. eas.json). За замовчуванням — магазин:
 * помилка в бік «зайвий дозвіл у сторовій збірці» дорожча за помилку в бік
 * «працівник отримав збірку без GPS і одразу це помітив».
 */
const FLAVOR = process.env.APP_FLAVOR === "staff" ? "staff" : "shop";
const isStaff = FLAVOR === "staff";

/**
 * Версія — одна на обидві збірки, номер складання рахується з неї.
 *
 * Android ставить оновлення поверх, тільки якщо versionCode ЗРОСТАЄ; сама
 * «версія» його не цікавить. Формула major*10000 + minor*100 + patch дає
 * зростаюче число, яке видно в дифі поруч зі STAFF_APK_VERSION_CODE у
 * src/lib/app-builds.ts — а звірка цих двох чисел і є те, що вирішує, чи
 * побачить людина кнопку «Оновити».
 *
 * autoIncrement у eas.json свідомо не використовуємо: EAS не вміє записати
 * збільшене число назад у динамічний app.config.ts, тож лічильник мовчки
 * стояв би на місці.
 */
const VERSION = "1.2.0";
const versionCode = (() => {
  const [major, minor, patch] = VERSION.split(".").map(Number);
  return major * 10000 + minor * 100 + patch;
})();

const CAMERA_REASON =
  "Камера потрібна, щоб знайти інструмент за штрихкодом або QR-кодом із цінника.";

const ODOMETER_REASON =
  "Камера потрібна, щоб зняти показник одометра на початку і в кінці зміни.";

const LOCATION_REASON =
  "Маршрут пишеться, поки триває зміна — зокрема коли телефон у кишені, а екран вимкнено. Поза зміною запис не ведеться.";

const config: ExpoConfig = {
  name: isStaff ? "Будвік27 Робота" : "Будвік27",
  slug: "budvik27",
  version: VERSION,

  /**
   * Оновлення «повітрям» (EAS Update) — для змін у JS; новий APK потрібен лише
   * тоді, коли додається нативний модуль або дозвіл.
   *
   * runtimeVersion рядком, а не політикою `appVersion`, і саме з flavor
   * усередині. Причина: `extra.flavor` запікається в маніфест оновлення в мить
   * публікації, тож `eas update` без APP_FLAVOR=staff змусив би робочу збірку
   * вважати себе магазином і сховати кабінет. З flavor у runtimeVersion така
   * публікація просто не збігається з установленою збіркою — тобто помилка
   * призводить до «оновлення не приїхало», а не до зламаного застосунку.
   */
  runtimeVersion: `${FLAVOR}-${VERSION}`,
  updates: {
    url: "https://u.expo.dev/fa529659-11f1-4969-ba64-08a9b96e2463",
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
  },
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  /**
   * Різні схеми навмисно: на планшеті можуть стояти обидві збірки, і спільна
   * схема означала б, що посилання відкриває навмання одну з них.
   */
  scheme: isStaff ? "budvik27staff" : "budvik27",
  userInterfaceStyle: "light",
  backgroundColor: "#FFFFFF",
  primaryColor: "#FFD600",
  owner: "sdirols",

  ios: {
    bundleIdentifier: isStaff ? "ua.budvik.staff" : "ua.budvik.shop",
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: CAMERA_REASON,
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: isStaff ? "ua.budvik.staff" : "ua.budvik.shop",
    versionCode,
    adaptiveIcon: {
      backgroundColor: "#0A0A0A",
      foregroundImage: "./assets/images/android-icon-foreground.png",
    },
    predictiveBackGestureEnabled: false,
    /**
     * Дозволи локації є ЛИШЕ в робочій збірці.
     *
     * Модулі після autolinking потрапляють в обидві, але рев'ю магазину
     * дивиться саме на список дозволів і на рядки-пояснення: застосунок
     * покупця, який просить фонову геолокацію, — це відмова публікації
     * (див. коментар угорі файла).
     */
    permissions: isStaff
      ? [
          "android.permission.CAMERA",
          "android.permission.ACCESS_COARSE_LOCATION",
          "android.permission.ACCESS_FINE_LOCATION",
          "android.permission.ACCESS_BACKGROUND_LOCATION",
          "android.permission.FOREGROUND_SERVICE",
          "android.permission.FOREGROUND_SERVICE_LOCATION",
          "android.permission.POST_NOTIFICATIONS",
          "android.permission.WAKE_LOCK",
          "android.permission.RECEIVE_BOOT_COMPLETED",
          /** Робоча збірка ставить собі оновлення сама — файлом із сайту. */
          "android.permission.REQUEST_INSTALL_PACKAGES",
        ]
      : ["android.permission.CAMERA"],
    /**
     * Посилання на товар відкриваються в застосунку — але лише в
     * покупецькому. Робоча збірка не має перехоплювати вітрину: працівник
     * відкриває товар клієнту з кабінету, а не з картки магазину.
     *
     * Обидва домени, бо голий budvik27.com 308-редіректить на www, а
     * перевірка App Links редіректу не переживає.
     */
    intentFilters: isStaff
      ? []
      : [
          {
            action: "VIEW",
            autoVerify: true,
            data: [
              { scheme: "https", host: "www.budvik27.com", pathPrefix: "/catalog" },
              { scheme: "https", host: "budvik27.com", pathPrefix: "/catalog" },
            ],
            category: ["BROWSABLE", "DEFAULT"],
          },
        ],
  },

  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#0A0A0A",
        image: "./assets/images/splash-icon.png",
        imageWidth: 180,
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: isStaff ? ODOMETER_REASON : CAMERA_REASON,
        /**
         * Мікрофон сканеру не потрібен, а плагін просить його за
         * замовчуванням. Зайвий дозвіл у списку — це питання на рев'ю, на
         * яке немає доброї відповіді.
         */
        recordAudioAndroid: false,
      },
    ],
    "expo-sqlite",
    "expo-background-task",
    /**
     * Локація — тільки в робочій збірці, і тільки тут вмикається фоновий
     * режим із службою переднього плану. Служба обов'язкова: без неї Android
     * присипляє процес за кілька хвилин після згасання екрана, і трек
     * обривається саме тоді, коли людина їде.
     */
    ...(isStaff
      ? [
          [
            "expo-location",
            {
              isAndroidBackgroundLocationEnabled: true,
              isAndroidForegroundServiceEnabled: true,
              locationAlwaysAndWhenInUsePermission: LOCATION_REASON,
              locationAlwaysPermission: LOCATION_REASON,
              locationWhenInUsePermission: LOCATION_REASON,
            },
          ] as [string, Record<string, unknown>],
        ]
      : []),
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },

  extra: {
    router: {},
    eas: { projectId: "fa529659-11f1-4969-ba64-08a9b96e2463" },
    /** Читається в застосунку через expo-constants — див. src/lib/flavor.ts. */
    flavor: FLAVOR,
  },
};

export default config;
