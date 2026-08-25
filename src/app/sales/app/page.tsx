"use client";

import { useAppUpdate, useIsNativeApp } from "@/lib/useIsNativeApp";
import { SalesHeader } from "@/components/sales/SalesHeader";

/**
 * Сторінка встановлення застосунку.
 *
 * Планшети отримують APK файлом: свого магазину в компанії немає, а Play
 * Market вимагав би релізний ключ і окреме обґрунтування фонової
 * геолокації. Роздавати збірку через локальну мережу теж не вийшло —
 * торговий у полі до неї не дістанеться.
 *
 * Сторінка живе за входом, і файл теж: /api/app/download перевіряє роль,
 * бо застосунок ходить у бойову базу.
 *
 * Кроки нумеровані навмисно: «Невідомі джерела» — місце, де людина
 * найчастіше застрягає, і без підказки повертається з питанням «пише, що
 * заборонено».
 */

const STEPS = [
  {
    title: "Завантажте файл",
    body: "Натисніть кнопку нижче. Android попередить, що такі файли можуть шкодити — це стандартне попередження для будь-якого APK поза Play Market.",
  },
  {
    title: "Дозвольте встановлення",
    body: "Якщо система скаже «заборонено з цього джерела», відкрийте Налаштування → Дозволити з цього джерела і поверніться назад. Питає один раз.",
  },
  {
    title: "Дозволи після входу",
    body: "Застосунок попросить геолокацію, сповіщення і роботу без обмежень батареї. Усі три потрібні: без них маршрут перестає писатися, щойно екран гасне.",
  },
  {
    title: "Дозвольте «Завжди»",
    body: "На кроці з місцезнаходженням оберіть саме «Дозволяти завжди». Варіант «Тільки під час використання» зупиняє запис, коли планшет у кишені.",
  },
];

export default function SalesAppPage() {
  const isApp = useIsNativeApp();
  const update = useAppUpdate();

  /*
   * Кнопку завантаження ховаємо у двох випадках, і з різних причин.
   *
   * Версія найсвіжіша — качати нема чого. А якщо збірка застаріла, але
   * не вміє оновлюватись сама (viaBridge = false), то в її WebView
   * немає DownloadListener: кнопка мовчки нічого б не зробила, і людина
   * вирішила б, що зламався застосунок. Там замість неї — інструкція
   * вище.
   */
  const hideDownload = isApp && (!update.available || !update.viaBridge);

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <SalesHeader title="Застосунок" subtitle="Встановлення" backTo="/sales" />

      <div className="mx-auto px-4" style={{ maxWidth: "480px", paddingTop: "20px", paddingBottom: "40px" }}>
        {isApp && update.available && (
          update.viaBridge ? (
            /* Збірка вміє оновитись сама — кнопка нижче спрацює. */
            <div
              className="rounded-2xl p-4"
              style={{ background: "#FFF9DB", border: "1px solid #FFE066", marginBottom: "16px" }}
            >
              <p style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>
                Доступна нова версія
              </p>
              <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "4px", lineHeight: 1.5 }}>
                Цього разу Android скаже «пакет конфліктує»: у застосунку
                змінився ключ підпису. Видаліть старий застосунок і поставте
                новий — відмітки й трек від цього не постраждають, вони на
                сервері. Наступні оновлення ставитимуться поверх самі.
              </p>
            </div>
          ) : (
            /*
              Стара збірка: завантаження всередині неї не працює взагалі
              (у WebView немає DownloadListener). Кнопку тут не малюємо —
              вона мовчки нічого б не зробила, і людина вирішила б, що
              зламався застосунок. Замість неї — що робити руками.
            */
            <div
              className="rounded-2xl p-4"
              style={{ background: "#FFF9DB", border: "1px solid #FFE066", marginBottom: "16px" }}
            >
              <p style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>
                Доступна нова версія
              </p>
              <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "8px", lineHeight: 1.6 }}>
                Цю версію треба поставити один раз вручну — саме вона
                навчає застосунок оновлюватися самостійно.
              </p>
              {/* Номери власними значками: маркери <ol> у вузькій
                  плашці зрізаються, і кроки читаються як суцільний
                  список без порядку. */}
              <div style={{ marginTop: "12px" }}>
                {[
                  <>Відкрийте на планшеті браузер Chrome</>,
                  <>
                    Введіть <span style={{ fontWeight: 700 }}>budvik27.com/sales/app</span>
                  </>,
                  <>Увійдіть і натисніть «Завантажити APK»</>,
                  <>Відкрийте файл і підтвердіть «Оновити»</>,
                ].map((step, i) => (
                  <div key={i} className="flex gap-2.5" style={{ marginBottom: "8px" }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: "20px",
                        height: "20px",
                        borderRadius: "9999px",
                        background: "#FFD600",
                        color: "#0A0A0A",
                        fontSize: "12px",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ fontSize: "13px", color: "#0A0A0A", lineHeight: 1.55 }}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "10px", lineHeight: 1.5 }}>
                Далі оновлення приходитимуть прямо сюди — без браузера.
              </p>
            </div>
          )
        )}

        {hideDownload ? (
          // Картку «вже встановлено» показуємо лише коли справді нема що
          // оновлювати; при застарілій збірці все сказано в плашці вище.
          !update.available && (
            <div
              className="rounded-2xl bg-white p-5"
              style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
            >
              <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}>
                Застосунок уже встановлено
              </p>
              <p style={{ fontSize: "14px", color: "#6B7280", marginTop: "6px" }}>
                Ви читаєте це всередині нього, і версія найсвіжіша. Сторінка
                потрібна, коли треба поставити застосунок на новий планшет.
              </p>
            </div>
          )
        ) : (
          <>
            <div
              className="rounded-2xl bg-white p-5"
              style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
            >
              <p style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }}>
                Budvik Tracker для Android
              </p>
              <p style={{ fontSize: "14px", color: "#6B7280", marginTop: "6px", lineHeight: 1.5 }}>
                Кабінет і запис маршруту в одному застосунку. Трек пишеться у
                фоні — навіть коли екран вимкнено.
              </p>

              <a
                href="/api/app/download"
                style={{
                  display: "block",
                  marginTop: "18px",
                  padding: "14px",
                  borderRadius: "12px",
                  background: "#FFD600",
                  color: "#0A0A0A",
                  fontWeight: 700,
                  fontSize: "15px",
                  textAlign: "center",
                }}
              >
                Завантажити APK
              </a>

              <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "10px", textAlign: "center" }}>
                Тільки для Android. На iPhone застосунок не встановиться —
                там кабінет відкривається у браузері.
              </p>
            </div>

            <div style={{ marginTop: "20px" }}>
              <p
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#9CA3AF",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: "10px",
                }}
              >
                Як встановити
              </p>

              <div className="space-y-3">
                {STEPS.map((step, i) => (
                  <div
                    key={step.title}
                    className="flex gap-3 rounded-2xl bg-white p-4"
                    style={{ border: "1px solid #EFEFEF" }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: "26px",
                        height: "26px",
                        borderRadius: "9999px",
                        background: "#FFD600",
                        color: "#0A0A0A",
                        fontSize: "13px",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
                        {step.title}
                      </p>
                      <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "3px", lineHeight: 1.5 }}>
                        {step.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p
              style={{
                fontSize: "12px",
                color: "#9CA3AF",
                marginTop: "18px",
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              Застосунок записує ваше місцезнаходження в робочий час, поки
              відкрита зміна. Питання — до керівника.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
