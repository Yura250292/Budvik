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
const VERSION = "1.6.4";

/**
 * Під який runtime публікувати оновлення повітрям.
 *
 * За замовчуванням — під свій, і це правильна поведінка в 99 випадках зі ста.
 * Але поле майже ніколи не буває одноверсійним: APK ставиться руками, а руки
 * доходять не до всіх одночасно. `runtimeVersion` прив'язаний до версії, тож
 * оновлення, опубліковане з дерева, доїжджає РІВНО до тих планшетів, у яких
 * нативна оболонка тієї самої версії. Решта лишаються на бандлі, з яким їх
 * колись установили, — і жодне виправлення до них не доходить узагалі.
 *
 * 09.09.2026 це коштувало нам поля: шість планшетів із восьми сиділи на JS
 * від 1.5.1 і 1.6.0, тобто без усього, що писалося два тижні. Ручний прийом
 * «підмінити VERSION, опублікувати, повернути» існував, але саме тому й не
 * робився — його треба пам'ятати, а забути його нічого не коштує до вечора.
 *
 * Тепер підміна робиться змінною, а хто і під які версії публікує — вирішує
 * `scripts/publish-staff-ota.mts` за живими пульсами з бази.
 *
 * ЗАПОБІЖНИК: у справжній збірці змінна ігнорується. Інакше одна забута змінна
 * оточення дала б APK, який називає себе чужою версією, — а це вже не
 * «оновлення не приїхало», а планшет, у який нічого більше не приїде ніколи.
 */
const RUNTIME_OVERRIDE = process.env.EAS_BUILD === "true" ? undefined : process.env.STAFF_OTA_RUNTIME;
const RUNTIME_VERSION = RUNTIME_OVERRIDE ?? VERSION;
const versionCode = (() => {
  const [major, minor, patch] = VERSION.split(".").map(Number);
  return major * 10000 + minor * 100 + patch;
})();

const MIC_REASON =
  "Мікрофон потрібен, щоб ставити питання помічнику голосом — коли руки зайняті кермом.";
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
  runtimeVersion: `${FLAVOR}-${RUNTIME_VERSION}`,
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
  /**
   * Фон вікна під усім застосунком.
   *
   * У робочій збірці чорний: саме його видно між нативним сплешем і першим
   * кадром JS та під час перезапуску після оновлення повітрям, а білий там
   * блимав перед чорною заставкою (ui/BootScreen.tsx). Це нативний ресурс —
   * повітрям не їде, лише з новим APK; до того фон фарбує SystemUI у
   * кореневому _layout.
   */
  backgroundColor: isStaff ? "#0A0A0A" : "#FFFFFF",
  primaryColor: "#FFD600",
  owner: "sdirols",

  ios: {
    bundleIdentifier: isStaff ? "ua.budvik.staff" : "ua.budvik.shop",
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: CAMERA_REASON,
      ...(isStaff ? { NSMicrophoneUsageDescription: MIC_REASON } : {}),
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: isStaff ? "ua.budvik.staff" : "ua.budvik.shop",
    versionCode,
    /**
     * Ключі Firebase — без них сповіщення неможливі в принципі.
     *
     * 08.09 знайшлося, що в базі НУЛЬ push-токенів за весь час: ні в
     * торгових, ні в покупців. Планшет сказав причину дослівно, щойно ми
     * навчили його скаржитися: «Default FirebaseApp is not initialized».
     * Тобто expo-notifications тягне за собою FCM, а конфігурації для нього
     * не було ніколи — токен видати нічим.
     *
     * Ціна цієї тиші більша, ніж здається. Без пушів планшет, у якого помер
     * трек, не може попередити навіть сам себе: його застосунок мертвий, і
     * розбудити його ззовні може ЛИШЕ сповіщення.
     *
     * Файл лише для робочої збірки: у ньому зареєстровано `ua.budvik.staff`,
     * і підсунути його магазинній збірці з іншим іменем пакета не можна —
     * Gradle звалить складання на розбіжності. Для покупця потрібен окремий
     * застосунок у тому самому проєкті Firebase; його заведемо, коли пуші
     * знадобляться й там.
     *
     * У git він лежить свідомо: EAS збирає з того, що відстежує git, і
     * незакомічений файл просто не потрапив би в збірку. Секрету в ньому
     * немає — ключ прив'язаний до імені пакета й підпису застосунку.
     */
    ...(isStaff ? { googleServicesFile: "./google-services.json" } : {}),
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
          /**
           * Мікрофон — щоб питати помічника голосом за кермом.
           *
           * Дозвіл потрібен саме застосунку, а не сторінці: кабінет
           * відкривається у WebView, і запис бере мікрофон через нього.
           */
          "android.permission.RECORD_AUDIO",
          "android.permission.ACCESS_COARSE_LOCATION",
          "android.permission.ACCESS_FINE_LOCATION",
          "android.permission.ACCESS_BACKGROUND_LOCATION",
          "android.permission.FOREGROUND_SERVICE",
          "android.permission.FOREGROUND_SERVICE_LOCATION",
          "android.permission.POST_NOTIFICATIONS",
          "android.permission.WAKE_LOCK",
          "android.permission.RECEIVE_BOOT_COMPLETED",
          /**
           * Точний будильник — сторож, якого оболонка не може відкласти.
           *
           * USE_EXACT_ALARM, а не SCHEDULE_EXACT_ALARM: перший видається при
           * встановленні й не питає людину, другий від Android 14 вимагає
           * окремого перемикача в налаштуваннях — тобто на п'яти планшетах
           * його довелося б вмикати руками, а на шостому забули б.
           *
           * У Play такий дозвіл вимагає обґрунтування, але робоча збірка в
           * Play не публікується — вона роздається файлом із сайту. Той самий
           * виняток, що вже зроблено для REQUEST_INSTALL_PACKAGES.
           *
           * Заради чого. WorkManager — це прохання, і оболонки Lenovo
           * відкладають його на години: 08.09 планшет доповів одне пробудження
           * сторожа за чотири години відкритої зміни. А ще спрацювання ТОЧНОГО
           * будильника — один із небагатьох дозволених приводів підняти службу
           * переднього плану з фону, тобто єдина мить, коли вбитий запис можна
           * оживити без людини.
           */
          "android.permission.USE_EXACT_ALARM",
          "android.permission.SCHEDULE_EXACT_ALARM",
          /** Робоча збірка ставить собі оновлення сама — файлом із сайту. */
          "android.permission.REQUEST_INSTALL_PACKAGES",
          /**
           * Дозволяє показати системний діалог «дозволити працювати у фоні?»
           * одним дотиком, замість блукань по налаштуваннях.
           *
           * Це не косметика. Без нього людина йде в налаштування батареї сама,
           * а на оболонці Lenovo перемикач у загальному списку оптимізації
           * рухається й НІЧОГО не змінює: планшет далі присипляє службу, трек
           * рветься на години, і виглядає це як «людина припинила працювати».
           * Перевірено на живому пристрої: після того перемикача прапорець
           * batteryOptimized лишався true.
           *
           * У Play такий дозвіл вимагає окремого обґрунтування, але робоча
           * збірка в Play і не публікується — вона роздається файлом із сайту.
           */
          "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
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
