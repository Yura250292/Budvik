"use client";

/**
 * Воронка й кліки: що люди роблять і де сходять з дистанції.
 *
 * Воронка стоїть першою, бо відповідає на головне питання власника —
 * «чому візитів багато, а замовлень мало». Кроки рахуються по візитах, а
 * частка — від початку воронки, щоб не перемножувати відсотки в голові.
 */

import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { num } from "@/components/ui/Stat";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useApi } from "@/components/ui/useApi";
import { CATEGORICAL, NEUTRAL } from "@/lib/analytics/colors";
import type { Period } from "@/components/ui/PeriodPicker";

interface EventsData {
  byType: Array<{ type: string; label: string; events: number; visitors: number }>;
  contacts: Array<{ label: string; clicks: number; visitors: number }>;
  funnel: Array<{ label: string; sessions: number; share: number }>;
}

export function EventsTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<EventsData>(
    `/api/admin/site-analytics/events?from=${period.from}&to=${period.to}`
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <CardSkeleton rows={8} />;
  if (!data) return null;

  const start = data.funnel[0]?.sessions ?? 0;

  if (start === 0) {
    return (
      <Card>
        <EmptyState
          title="Подій за цей період немає"
          hint="Тут з'явиться шлях покупця від візиту до замовлення й кліки по кнопках."
        />
      </Card>
    );
  }

  const maxEvents = Math.max(...data.byType.map((t) => t.events), 1);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Шлях покупця"
          hint="Скільки візитів дійшло до кожного кроку. Відсоток — від усіх візитів періоду"
        />
        <div className="space-y-3">
          {data.funnel.map((step, i) => {
            // Втрату рахуємо від ПОПЕРЕДНЬОГО кроку: саме там людина
            // пішла, і саме той екран треба лагодити.
            const prev = i > 0 ? data.funnel[i - 1].sessions : null;
            const lost = prev != null ? prev - step.sessions : null;
            const lostShare = prev && prev > 0 ? ((lost ?? 0) / prev) * 100 : 0;

            return (
              <div key={step.label}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-bk">{step.label}</span>
                  <span className="shrink-0 text-sm tabular-nums text-g600">
                    <span className="font-semibold text-bk">{num(step.sessions)}</span>
                    <span className="ml-2 text-xs">
                      {step.share.toFixed(1).replace(".", ",")}%
                    </span>
                  </span>
                </div>
                <div className="h-6 w-full overflow-hidden rounded-[var(--radius-badge)] bg-g100">
                  <div
                    className="h-full rounded-[var(--radius-badge)]"
                    style={{
                      width: `${Math.max(0.5, step.share)}%`,
                      backgroundColor: CATEGORICAL[i] ?? NEUTRAL,
                    }}
                  />
                </div>
                {lost != null && lost > 0 && (
                  <p className="mt-1 text-xs text-g500">
                    Не пішли далі: {num(lost)} ({lostShare.toFixed(0)}% від попереднього кроку)
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Усі дії" hint="Кількість подій і скільки різних людей їх зробили" />
          <ul className="space-y-2">
            {data.byType.map((t, i) => (
              <li key={t.type}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-bk">{t.label}</span>
                  <span className="shrink-0 text-sm tabular-nums">
                    <span className="font-semibold text-bk">{num(t.events)}</span>
                    <span className="ml-2 text-xs text-g500">{num(t.visitors)} людей</span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-g100">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(1.5, (t.events / maxEvents) * 100)}%`,
                      backgroundColor: CATEGORICAL[i % CATEGORICAL.length],
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Кліки по контактах"
            hint="Натискання на телефон, пошту й месенджери — звернення, яких немає в замовленнях"
          />
          {data.contacts.length === 0 ? (
            <EmptyState
              title="По контактах не клікали"
              hint="Або покупці дзвонять за номером із візитки, або кнопки контактів губляться на сторінці."
            />
          ) : (
            <ul className="divide-y divide-g100">
              {data.contacts.map((c) => (
                <li key={c.label} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="text-sm text-bk">{c.label}</span>
                  <span className="shrink-0 text-sm tabular-nums">
                    <span className="font-semibold text-bk">{num(c.clicks)}</span>
                    <span className="ml-2 text-xs text-g500">{num(c.visitors)} людей</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
