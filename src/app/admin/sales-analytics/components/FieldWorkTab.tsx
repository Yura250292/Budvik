"use client";

/**
 * Польова робота: чи торгові уточнюють карту клієнтів.
 *
 * Звіт відповідає на три питання підряд, і порядок тут не косметичний.
 * Спершу СКІЛЬКИ ЩЕ ТРЕБА (покриття бази) — без знаменника будь-яка
 * кількість пінів звучить однаково. Далі ХТО ЩО ЗРОБИВ за період. І тільки
 * потім стрічка самих дій: лічильник не показує, чи людина справді стояла
 * біля магазину, а рядок «±8 м, 14:20, з фото» — показує.
 *
 * Головна колонка таблиці — не «уточнено», а «з них на місці»: пін, який
 * посунули пальцем по карті ввечері, коштує рівно стільки, скільки коштує
 * пам'ять про магазин, куди їздили торік.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { Badge } from "@/components/ui/Badge";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

type FieldWorkResponse = {
  period: { from: string; to: string; days: number };
  coverage: {
    total: number;
    exact: number;
    city: number;
    geocoded: number;
    failed: number;
    missing: number;
    shipped: number;
    shippedExact: number;
    shippedApprox: number;
    shippedMissing: number;
    unattributed: number;
    windowDays: number;
  };
  workers: Array<{
    userId: string;
    name: string;
    role: string;
    pins: number;
    pinsOnSite: number;
    photos: number;
    notes: number;
    notesWithPhoto: number;
    clients: number;
    pinsAllTime: number;
    photosAllTime: number;
    notesAllTime: number;
    lastAt: string | null;
  }>;
  backlog: Array<{
    repId: string | null;
    name: string;
    clients: number;
    exact: number;
    approx: number;
    missing: number;
    ready: number;
  }>;
  events: Array<{
    kind: "PIN" | "PHOTO" | "NOTE";
    clientId: string;
    clientName: string;
    userId: string | null;
    userName: string;
    at: string;
    accuracyM: number | null;
    text: string | null;
    hasPhoto: boolean;
  }>;
};

/**
 * Межа, за якою GPS перестає бути свідченням присутності.
 *
 * Сорок метрів — це вже не «біля дверей», а «десь у цьому кварталі»:
 * телефон у такому разі рахує позицію за вишками, а не за супутниками.
 * Той самий поріг, що в модалці водія.
 */
const ACCURACY_WATCH_M = 40;

/** Готовність карти: 90% точних пінів — робоча карта, нижче 50% — її нема. */
function readyStatus(percent: number) {
  if (percent >= 90) return "good" as const;
  if (percent >= 50) return "warn" as const;
  return "bad" as const;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "адмін",
  MANAGER: "керівник",
  SALES: "торговий",
  DRIVER: "водій",
  WAREHOUSE: "склад",
};

const KIND_LABEL: Record<FieldWorkResponse["events"][number]["kind"], string> = {
  PIN: "точка",
  PHOTO: "фото магазину",
  NOTE: "нотатка",
};

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function FieldWorkTab({ period }: { period: Period }) {
  const router = useRouter();
  const { data, loading, error, reload } = useApi<FieldWorkResponse>(
    `/api/admin/sales-analytics/field-work?from=${period.from}&to=${period.to}`
  );

  const coverage = data?.coverage;

  /**
   * Готовність рахуємо по тих, кому реально возять, а не по всій базі:
   * серед 3 700 контрагентів є постачальники, разові покупці й давно
   * померлі точки — вимагати для них пін означає ставити недосяжну ціль
   * і знецінювати реальну роботу.
   */
  const ready = useMemo(() => {
    if (!coverage || coverage.shipped === 0) return 0;
    return (coverage.shippedExact / coverage.shipped) * 100;
  }, [coverage]);

  const totals = useMemo(() => {
    const w = data?.workers ?? [];
    return {
      pins: w.reduce((s, r) => s + r.pins, 0),
      onSite: w.reduce((s, r) => s + r.pinsOnSite, 0),
      photos: w.reduce((s, r) => s + r.photos, 0),
      notes: w.reduce((s, r) => s + r.notes, 0),
      active: w.filter((r) => r.pins + r.photos + r.notes > 0).length,
    };
  }, [data]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading) return <TableSkeleton rows={8} />;
  if (!data || !coverage) return null;

  const workers = data.workers.filter((w) => w.pins + w.photos + w.notes > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Уточнено точок"
          value={num(totals.pins)}
          hint={`з них на місці по GPS — ${num(totals.onSite)}`}
          tone={totals.pins > 0 ? "good" : "neutral"}
        />
        <StatCard
          label="Фото магазинів"
          value={num(totals.photos)}
          hint="знято за період"
          tone={totals.photos > 0 ? "good" : "neutral"}
        />
        <StatCard
          label="Нотаток про клієнта"
          value={num(totals.notes)}
          hint="що знає торговий, а не цифри"
          tone={totals.notes > 0 ? "good" : "neutral"}
        />
        <StatCard
          label="Людей у полі"
          value={num(totals.active)}
          hint="хто зробив хоч одну дію"
          tone={totals.active > 0 ? "info" : "bad"}
        />
      </div>

      <Card>
        <CardHeader
          title="Скільки карти вже готово"
          hint={`Рахуємо по клієнтах, яким возили за останні ${coverage.windowDays} днів: решта бази маршрутів не бачить.`}
        />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-semibold tabular-nums tracking-tight text-bk">
            {num(ready, 0)}%
          </span>
          <Badge status={readyStatus(ready)} dot>
            {num(coverage.shippedExact)} з {num(coverage.shipped)} точні
          </Badge>
        </div>
        {/* Смуга навмисно трикольорова: «приблизно» і «немає взагалі» — різні
            біди. Перше псує маршрут тихо, друге видно одразу. */}
        <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-g100">
          <span
            className="h-full"
            style={{ width: `${(coverage.shippedExact / Math.max(1, coverage.shipped)) * 100}%`, background: "#059669" }}
          />
          <span
            className="h-full"
            style={{ width: `${(coverage.shippedApprox / Math.max(1, coverage.shipped)) * 100}%`, background: "#D97706" }}
          />
          <span
            className="h-full"
            style={{ width: `${(coverage.shippedMissing / Math.max(1, coverage.shipped)) * 100}%`, background: "#DC2626" }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-g600 sm:grid-cols-4">
          <div>
            <p className="font-semibold tabular-nums text-emerald-700">{num(coverage.shippedExact)}</p>
            <p>уточнені руками</p>
          </div>
          <div>
            <p className="font-semibold tabular-nums text-amber-600">{num(coverage.shippedApprox)}</p>
            <p>пін від геокодера</p>
          </div>
          <div>
            <p className="font-semibold tabular-nums text-red-600">{num(coverage.shippedMissing)}</p>
            <p>точки немає взагалі</p>
          </div>
          <div>
            <p className="font-semibold tabular-nums text-g600">{num(coverage.city)}</p>
            <p>стоять «десь у місті» (по всій базі)</p>
          </div>
        </div>
        {coverage.unattributed > 0 && (
          <p className="mt-3 rounded-[var(--radius-card)] border border-g200 bg-g50 px-3 py-2 text-xs text-g600">
            {num(coverage.unattributed)} точок уточнили ще до того, як база почала запам&apos;ятовувати
            автора — вони лічаться в покритті, але в таблиці нижче їх немає й не буде: відновити,
            хто їх поставив, нізвідки.
          </p>
        )}
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Хто працює в полі"
            hint="«На місці» — пін поставлено кнопкою «Я зараз тут» із живим GPS. Решту посунули пальцем по карті."
          />
        </div>
        {workers.length === 0 ? (
          <EmptyState
            title="За цей період карту ніхто не чіпав"
            hint={`З ${data.period.from} по ${data.period.to} жодної уточненої точки, фото чи нотатки. Якщо період свіжий — можливо, просто ще не встигли.`}
          />
        ) : (
          <TableScroll stickyHeader minWidth={720}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Хто</th>
                  <th className="px-4 py-2.5 text-right">Точок</th>
                  <th className="px-4 py-2.5 text-right">З них на місці</th>
                  <th className="px-4 py-2.5 text-right">Фото</th>
                  <th className="px-4 py-2.5 text-right">Нотаток</th>
                  <th className="px-4 py-2.5 text-right">Клієнтів</th>
                  <th className="px-4 py-2.5 text-right">Остання дія</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {workers.map((w) => (
                  <tr
                    key={w.userId}
                    onClick={
                      w.role === "SALES"
                        ? () =>
                            router.push(
                              `/admin/sales-analytics/${w.userId}?from=${period.from}&to=${period.to}`
                            )
                        : undefined
                    }
                    className={w.role === "SALES" ? "cursor-pointer transition-colors hover:bg-g50" : ""}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-bk">{w.name}</span>
                      <span className="ml-2 text-xs text-g500">{ROLE_LABEL[w.role] ?? w.role}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                      {num(w.pins)}
                      {w.pinsAllTime > w.pins && (
                        <span className="ml-1 text-xs font-normal text-g500">/ {num(w.pinsAllTime)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {w.pins > 0 ? (
                        <Badge status={w.pinsOnSite === w.pins ? "good" : w.pinsOnSite > 0 ? "warn" : "neutral"}>
                          {num(w.pinsOnSite)}
                        </Badge>
                      ) : (
                        <span className="text-g400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(w.photos)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">
                      {num(w.notes)}
                      {w.notesWithPhoto > 0 && (
                        <span className="ml-1 text-xs text-g500">({num(w.notesWithPhoto)} з фото)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(w.clients)}</td>
                    <td className="px-4 py-3 text-right text-xs text-g500">{formatDay(w.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Скільки кому ще лишилось"
            hint={`Клієнти з відвантаженням за ${coverage.windowDays} днів, за торговим із останньої реалізації. Стан «зараз», не за період.`}
          />
        </div>
        <TableScroll stickyHeader minWidth={620}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Торговий</th>
                <th className="px-4 py-2.5 text-right">Клієнтів</th>
                <th className="px-4 py-2.5 text-right">Точні</th>
                <th className="px-4 py-2.5 text-right">Приблизні</th>
                <th className="px-4 py-2.5 text-right">Без точки</th>
                <th className="px-4 py-2.5 text-right">Готово</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {data.backlog.map((r) => (
                <tr
                  key={r.repId ?? "none"}
                  onClick={
                    r.repId
                      ? () =>
                          router.push(
                            `/admin/sales-analytics/${r.repId}?from=${period.from}&to=${period.to}`
                          )
                      : undefined
                  }
                  className={r.repId ? "cursor-pointer transition-colors hover:bg-g50" : ""}
                >
                  <td className="px-4 py-3 font-medium text-bk">{r.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">{num(r.clients)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                    {num(r.exact)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-600">{num(r.approx)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-600">{num(r.missing)}</td>
                  <td className="px-4 py-3 text-right">
                    <Badge status={readyStatus(r.ready)}>{num(r.ready, 0)}%</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Що робили останнім часом"
            hint="Останні 40 дій за період. Точність ±м видно лише там, де пін ставили по GPS."
          />
        </div>
        {data.events.length === 0 ? (
          <EmptyState title="Дій за період немає" />
        ) : (
          <ul className="divide-y divide-g100">
            {data.events.map((e, i) => (
              <li key={`${e.kind}-${e.clientId}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3">
                <Badge status={e.kind === "PIN" ? "info" : e.kind === "PHOTO" ? "good" : "neutral"}>
                  {KIND_LABEL[e.kind]}
                </Badge>
                <span className="font-medium text-bk">{e.clientName}</span>
                <span className="text-xs text-g500">{e.userName}</span>
                <span className="text-xs text-g400">{formatMoment(e.at)}</span>
                {e.kind === "PIN" && (
                  <span
                    className="text-xs"
                    style={{
                      color:
                        e.accuracyM == null
                          ? "#94A3B8"
                          : e.accuracyM > ACCURACY_WATCH_M
                            ? "#D97706"
                            : "#059669",
                    }}
                  >
                    {e.accuracyM == null ? "поставлено рукою на карті" : `на місці, ±${num(e.accuracyM)} м`}
                  </span>
                )}
                {e.kind === "NOTE" && e.hasPhoto && <span className="text-xs text-emerald-700">з фото</span>}
                {e.text && <span className="w-full text-xs text-g600">{e.text}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
