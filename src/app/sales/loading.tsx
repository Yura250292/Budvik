import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Що видно в ту мить, коли торговий тапнув по вкладці.
 *
 * До цього файлу в секції не було жодної межі завантаження, і Next тримав
 * на екрані попередню сторінку, поки їде наступна. Тобто тап по «Клієнтах»
 * не змінював рівно нічого — саме на це й скаржилися торгові: «натискаю, а
 * воно не перемикається». Секунда без відгуку на телефоні читається як
 * зависання, і людина тисне ще раз, і ще.
 *
 * Один файл на всю секцію, а не свій під кожен екран: у всіх однаковий
 * кістяк — темна шапка, під нею картки, — а різницю все одно домальовує
 * сама сторінка через частку секунди. Екрану, якому знадобиться власна
 * заглушка, достатньо покласти свій loading.tsx поруч зі своїм page.tsx.
 *
 * Заглушка, а не спінер: спінер нічого не займає, тож при появі даних
 * висота стрибає й палець промахується повз картку.
 */
export default function SalesLoading() {
  return (
    <div className="min-h-screen bg-background">
      {/* Та сама шапка, що в SalesHeader: темний градієнт із золотою
          лінією поверху. Без неї перехід блимав би білим. */}
      <div
        style={{
          background: "linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: "12px",
        }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4">
          <div className="h-9 w-9 shrink-0 rounded-full bg-white/10" />
          <div className="h-5 w-32 rounded bg-white/10" />
          <div className="ml-auto h-9 w-9 shrink-0 rounded-xl bg-white/10" />
        </div>
      </div>

      <div className="mx-auto max-w-lg space-y-2 px-4 pt-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-g200 bg-white p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
