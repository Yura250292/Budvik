import { Suspense } from "react";
import { SiteAnalyticsShell } from "./components/SiteAnalyticsShell";

/**
 * «Відвідуваність сайту»: хто заходить у магазин, що дивиться, що шукає
 * і де сходить з дистанції.
 *
 * Сусідній розділ /admin/sales-analytics — про те, що вже продано через
 * 1С. Цей — про тих, хто ще нічого не купив: без нього видно лише
 * замовлення й невидно, скільки людей до них не дійшло.
 *
 * Suspense обов'язковий: оболонка читає useSearchParams.
 */
export default function SiteAnalyticsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-g300 border-t-bk motion-reduce:animate-none" />
        </div>
      }
    >
      <SiteAnalyticsShell />
    </Suspense>
  );
}
