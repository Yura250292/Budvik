"use client";

import { useAppUpdate, useIsNativeApp } from "@/lib/useIsNativeApp";
import { StaffBuildCard } from "@/components/app-install/StaffBuildCard";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Button, Card, CardTitle, Eyebrow, Note, Page } from "@/components/cabinet/ui";

/**
 * Сторінка встановлення застосунку для водія.
 *
 * Той самий APK, що й у торгового: після входу застосунок сам відкриває
 * потрібний кабінет за роллю. Окрема сторінка потрібна не заради іншого
 * файлу, а заради інших слів — водієві важливий фоновий трек під час
 * поїздки в Google Maps, а не зміна з фото одометра.
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
    title: "Обовʼязково «Дозволяти завжди»",
    body: "На кроці з місцезнаходженням оберіть саме «Дозволяти завжди». З варіантом «Тільки під час використання» трек обірветься, щойно ви перейдете в Google Maps — а саме тоді ви і їдете.",
  },
];

/** Крок із номером у жовтому кружку: маркери <ol> у вузькій плашці зрізаються. */
function Step({ n, title, children }: { n: number; title?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-bk">
        {n}
      </span>
      <div className="min-w-0">
        {!!title && <p className="text-sm font-semibold text-bk">{title}</p>}
        <p className="text-[13px] leading-relaxed text-cab-t2">{children}</p>
      </div>
    </div>
  );
}

export default function DriverAppPage() {
  const isApp = useIsNativeApp();
  const update = useAppUpdate();

  /*
   * Кнопку завантаження ховаємо у двох випадках, і з різних причин.
   *
   * Версія найсвіжіша — качати нема чого. А якщо збірка застаріла, але
   * не вміє оновлюватись сама (viaBridge = false), то в її WebView
   * немає DownloadListener: кнопка мовчки нічого б не зробила, і людина
   * вирішила б, що зламався застосунок. Там замість неї — інструкція.
   */
  const hideDownload = isApp && (!update.available || !update.viaBridge);

  return (
    <>
      <CabinetHeader
        title="Застосунок"
        subtitle="Встановлення на планшет або телефон"
        backTo="/driver/profile"
      />

      <Page>
        <StaffBuildCard />

        {isApp &&
          update.available &&
          (update.viaBridge ? (
            /* Збірка вміє оновитись сама — кнопка нижче спрацює. */
            <Card tone="brand" className="flex flex-col gap-1.5">
              <CardTitle>Доступна нова версія</CardTitle>
              <Body>
                Цього разу Android скаже «пакет конфліктує»: у застосунку змінився ключ підпису.
                Видаліть старий застосунок і поставте новий — відмітки й трек від цього не
                постраждають, вони на сервері. Наступні оновлення ставитимуться поверх самі.
              </Body>
            </Card>
          ) : (
            /*
              Стара збірка: завантаження всередині неї не працює взагалі (у
              WebView немає DownloadListener). Кнопку тут не малюємо — вона
              мовчки нічого б не зробила. Замість неї — що робити руками.
            */
            <Card tone="brand" className="flex flex-col gap-2">
              <CardTitle>Доступна нова версія</CardTitle>
              <Body>
                Цю версію треба поставити один раз вручну — саме вона навчає застосунок
                оновлюватися самостійно.
              </Body>
              <Step n={1}>Відкрийте на пристрої браузер Chrome</Step>
              <Step n={2}>
                Введіть <span className="font-bold">budvik27.com/driver/app</span>
              </Step>
              <Step n={3}>Увійдіть і натисніть «Завантажити APK»</Step>
              <Step n={4}>Відкрийте файл і підтвердіть «Оновити»</Step>
              <Note>Далі оновлення приходитимуть прямо сюди — без браузера.</Note>
            </Card>
          ))}

        {hideDownload ? (
          // Картку «вже встановлено» показуємо лише коли справді нема що
          // оновлювати; при застарілій збірці все сказано в плашці вище.
          !update.available && (
            <Card className="flex flex-col gap-1.5">
              <CardTitle>Застосунок уже встановлено</CardTitle>
              <Body>
                Ви читаєте це всередині нього, і версія найсвіжіша. Сторінка потрібна, коли треба
                поставити застосунок на новий пристрій.
              </Body>
            </Card>
          )
        ) : (
          <>
            {/*
              Другої кнопки завантаження тут більше немає. Раніше сторінка
              пропонувала дві: угорі нову збірку, нижче — помітнішу, яка ставила
              СТАРИЙ трекер. Людина тиснула нижню, бо вона більша, і поверталася
              з тим самим застосунком, від якого її й переводили.
            */}
            <Eyebrow>Як встановити</Eyebrow>
            {STEPS.map((step, i) => (
              <Card key={step.title}>
                <Step n={i + 1} title={step.title}>
                  {step.body}
                </Step>
              </Card>
            ))}

            <Note>
              Тільки для Android. На iPhone застосунок не встановиться — там кабінет відкривається у
              браузері. Застосунок записує ваше місцезнаходження в робочий час. Питання — до
              керівника.
            </Note>

            {/* Старий трекер лишається доступним на випадок відкату — але
                дрібним посиланням, а не кнопкою поруч із новою збіркою. */}
            <a href="/api/app/download" className="py-2 text-center text-xs text-cab-t3 underline">
              Завантажити старий Budvik Tracker
            </a>
          </>
        )}

        <Button tone="outline" small href="/driver/profile" className="w-full">
          Назад в акаунт
        </Button>
      </Page>
    </>
  );
}
