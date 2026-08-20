"use client";

/**
 * Огляд: скільки людей заходило, звідки, з чого й куди дивилися.
 *
 * Порядок блоків — від питання «скільки» до питання «хто»: спершу
 * лічильник «зараз на сайті» й показники періоду, потім динаміка, і аж
 * тоді розрізи (сторінки, пристрої, джерела, міста).
 */

import dynamic from "next/dynamic";
import useSWR from "swr";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, num } from "@/components/ui/Stat";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { CardSkeleton, StatCardSkeleton } from "@/components/ui/Skeleton";
import { useApi } from "@/components/ui/useApi";
import { CATEGORICAL, NEUTRAL } from "@/lib/analytics/colors";
import type { Period } from "@/components/ui/PeriodPicker";

const VisitorsChart = dynamic(() => import("./VisitorsChart"), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-[var(--radius-card)] bg-g100 motion-reduce:animate-none" />,
});

interface Overview {
  totals: {
    visitors: number;
    sessions: number;
    pageViews: number;
    productViews: number;
    searches: number;
    addToCarts: number;
    orders: number;
    phoneClicks: number;
    conversion: number;
  };
  timeline: Array<{ day: string; visitors: number; pageViews: number; orders: number }>;
  pages: Array<{ path: string; views: number; visitors: number }>;
  devices: Array<{ device: string; visitors: number }>;
  browsers: Array<{ browser: string; visitors: number }>;
  referrers: Array<{ referrer: string; sessions: number }>;
  cities: Array<{ city: string; visitors: number }>;
  refCodes: Array<{ code: string; name: string | null; visitors: number }>;
}

interface Live {
  online: number;
  windowMinutes: number;
  pages: Array<{ path: string; visitors: number }>;
}

const DEVICE_LABELS: Record<string, string> = {
  mobile: "Телефон",
  desktop: "Комп'ютер",
  unknown: "Невідомо",
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Не вдалося завантажити");
  return res.json();
};

/** Проста таблиця-рейтинг: підпис, смуга, число. */
function RankList({
  rows,
  emptyTitle,
  emptyHint,
  unit,
}: {
  rows: Array<{ key: string; label: string; value: number; color?: string }>;
  emptyTitle: string;
  emptyHint?: string;
  unit?: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-bk" title={r.label}>
              {r.label}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-bk">
              {num(r.value)}
              {unit && <span className="ml-1 text-xs font-normal text-g500">{unit}</span>}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-g100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(1.5, (r.value / max) * 100)}%`,
                backgroundColor: r.color ?? CATEGORICAL[0],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OverviewTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<Overview>(
    `/api/admin/site-analytics/overview?from=${period.from}&to=${period.to}`
  );

  // Лічильник «зараз» живе окремо від решти вкладки: у нього своє вікно
  // (5 хвилин) і власне оновлення раз на півхвилини, тоді як звіт за
  // період перечитувати так часто нема сенсу.
  const { data: live } = useSWR<Live>("/api/admin/site-analytics/live", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  if (error) return <ErrorBox message={error} onRetry={reload} />;

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <CardSkeleton rows={6} />
      </div>
    );
  }

  if (!data) return null;

  const t = data.totals;
  const hasData = t.pageViews > 0 || t.visitors > 0;

  return (
    <div className="space-y-4">
      {/* Зараз на сайті — єдиний блок, який дивляться «між справами», тож
          стоїть найвище й не залежить від обраного періоду. */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              {(live?.online ?? 0) > 0 && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1baf7a] opacity-60 motion-reduce:animate-none" />
              )}
              <span
                className="relative inline-flex h-3 w-3 rounded-full"
                style={{ backgroundColor: (live?.online ?? 0) > 0 ? "#1baf7a" : "var(--color-g300)" }}
              />
            </span>
            <div>
              <p className="text-xs font-medium text-g500">Зараз на сайті</p>
              <p className="text-2xl font-semibold tabular-nums text-bk">
                {live ? num(live.online) : "—"}
                <span className="ml-1.5 text-sm font-normal text-g500">
                  {live ? `за останні ${live.windowMinutes} хв` : ""}
                </span>
              </p>
            </div>
          </div>
          {live && live.pages.length > 0 && (
            <div className="min-w-0 flex-1 sm:max-w-md">
              <p className="mb-1 text-xs font-medium text-g500">Дивляться</p>
              <div className="flex flex-wrap gap-1.5">
                {live.pages.slice(0, 5).map((p) => (
                  <span
                    key={p.path}
                    className="max-w-full truncate rounded-[var(--radius-badge)] border border-g200 px-2 py-0.5 text-xs text-g600"
                    title={p.path}
                  >
                    {p.path} · {p.visitors}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {!hasData ? (
        <Card>
          <EmptyState
            title="За цей період даних ще немає"
            hint="Збір почався з моменту встановлення лічильника. Оберіть свіжіший період або зачекайте, поки накопичаться перші візити."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Відвідувачі"
              value={num(t.visitors)}
              hint="Унікальні пристрої"
              accent={CATEGORICAL[0]}
            />
            <StatCard label="Візити" value={num(t.sessions)} hint="Сесії до 30 хв паузи" />
            <StatCard label="Перегляди сторінок" value={num(t.pageViews)} />
            <StatCard label="Перегляди товарів" value={num(t.productViews)} />
            <StatCard
              label="Пошуки"
              value={num(t.searches)}
              accent={CATEGORICAL[2]}
            />
            <StatCard label="Додали в кошик" value={num(t.addToCarts)} />
            <StatCard label="Кліки по контактах" value={num(t.phoneClicks)} hint="Телефон, пошта, месенджери" />
            <StatCard
              label="Замовлення"
              value={num(t.orders)}
              hint={`Конверсія ${t.conversion.toFixed(1).replace(".", ",")}% візитів`}
              accent={CATEGORICAL[5]}
            />
          </div>

          <Card>
            <CardHeader title="Динаміка" hint="Відвідувачі та перегляди сторінок по днях" />
            <VisitorsChart data={data.timeline} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Найпопулярніші сторінки" hint="За кількістю переглядів" />
              <RankList
                rows={data.pages.map((p) => ({
                  key: p.path,
                  label: p.path,
                  value: p.views,
                }))}
                emptyTitle="Переглядів ще не було"
              />
            </Card>

            <Card>
              <CardHeader title="З чого заходять" hint="Пристрої та браузери, за унікальними відвідувачами" />
              <RankList
                rows={data.devices.map((d, i) => ({
                  key: d.device,
                  label: DEVICE_LABELS[d.device] ?? d.device,
                  value: d.visitors,
                  color: d.device === "unknown" ? NEUTRAL : CATEGORICAL[i],
                }))}
                emptyTitle="Немає даних про пристрої"
              />
              <div className="mt-4 border-t border-g200 pt-3">
                <RankList
                  rows={data.browsers.map((b, i) => ({
                    key: b.browser,
                    label: b.browser,
                    value: b.visitors,
                    color: b.browser === "інше" ? NEUTRAL : CATEGORICAL[i],
                  }))}
                  emptyTitle="Немає даних про браузери"
                />
              </div>
            </Card>

            <Card>
              <CardHeader title="Звідки приходять" hint="Сайт, з якого перейшли на перший екран візиту" />
              <RankList
                rows={data.referrers.map((r) => ({
                  key: r.referrer,
                  label: r.referrer,
                  value: r.sessions,
                }))}
                emptyTitle="Переходів з інших сайтів не було"
                emptyHint="Люди заходять напряму: за адресою, із закладок або з месенджера, який не передає джерело."
                unit="візитів"
              />
              {data.refCodes.length > 0 && (
                <div className="mt-4 border-t border-g200 pt-3">
                  <p className="mb-2 text-xs font-medium text-g500">За QR торгових</p>
                  <RankList
                    rows={data.refCodes.map((r) => ({
                      key: r.code,
                      label: r.name ?? r.code,
                      value: r.visitors,
                      color: CATEGORICAL[3],
                    }))}
                    emptyTitle="QR-переходів не було"
                  />
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Географія" hint="Міста за унікальними відвідувачами" />
              <RankList
                rows={data.cities.map((c) => ({
                  key: c.city,
                  label: c.city,
                  value: c.visitors,
                  color: CATEGORICAL[1],
                }))}
                emptyTitle="Міст поки не видно"
                emptyHint="Місто визначається на боці Vercel і з'являється лише на бойовому домені."
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
