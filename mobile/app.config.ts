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

const CAMERA_REASON =
  "Камера потрібна, щоб знайти інструмент за штрихкодом або QR-кодом із цінника.";

const config: ExpoConfig = {
  name: isStaff ? "Будвік27 Робота" : "Будвік27",
  slug: "budvik27",
  version: "1.0.0",
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
    adaptiveIcon: {
      backgroundColor: "#0A0A0A",
      foregroundImage: "./assets/images/android-icon-foreground.png",
    },
    predictiveBackGestureEnabled: false,
    permissions: ["android.permission.CAMERA"],
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
        cameraPermission: CAMERA_REASON,
        /**
         * Мікрофон сканеру не потрібен, а плагін просить його за
         * замовчуванням. Зайвий дозвіл у списку — це питання на рев'ю, на
         * яке немає доброї відповіді.
         */
        recordAudioAndroid: false,
      },
    ],
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
