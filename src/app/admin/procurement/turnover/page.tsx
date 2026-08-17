"use client";

/**
 * Оборотність складу: що лежить без руху.
 *
 * Зворотний бік сторінки закупівель — там «чого бракує», тут «чого забагато».
 * Порядок екрана відповідає порядку рішень: спершу скільки грошей стоїть,
 * далі в яких напрямках, далі давність, і лише потім конкретні позиції,
 * з яких починають розпродаж.
 *
 * Усі суми — в цінах ПРОДАЖУ, бо собівартості обмін з 1С не передає. Це
 * сказано на екрані прямо: інакше «14,5 млн мертвого запасу» прочитали б як
 * вкладені гроші, хоча цифра завищена на маржу.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableScroll } from "@/components/ui/TableScroll";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { TurnoverReport } from "@/lib/analytics/turnover";
import { VELOCITY_OPTIONS, parseVelocityDays } from "@/lib/analytics/velocity-window";

type Brand = { id: string; name: string; products: number };

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });

/**
 * Скільки оборотів на рік вважати нормою.
 *
 * Не норматив із 1С, а орієнтир для інструменту: менше двох оборотів —
 * запас лежить понад пів року, і гроші в ньому працюють гірше, ніж могли б.
 */
const TURNS_WATCH = 2;

function turnsTone(turns: number | null): "good" | "warn" | "bad" | "neutral" {
  if (turns === null) return "bad";
  if (turns >= 4) return "good";
  if (turns >= TURNS_WATCH) return "warn";
  return "bad";
}

/**
 * Сторінка читає ?brandId= і ?days= з адреси, а не лише зі свого стану:
 * з АІ-аналізу фірми сюди «провалюються» посиланням на конкретний бренд
 * («SIGMA — 2,3 млн без руху, показати»), і без цього людина потрапляла б
 * на весь склад і шукала той бренд руками.
 */
export default function TurnoverPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-g500">Завантаження…</div>}>
      <TurnoverView />
    </Suspense>
  );
}

function TurnoverView() {
  const params = useSearchParams();
  const [brandId, setBrandId] = useState(() => params.get("brandId") ?? "");
  const [days, setDays] = useState(() => parseVelocityDays(params.get("days")));

  const { data: brandsData } = useSWR<{ brands: Brand[] }>("/api/admin/procurement/brands", fetcher);
  const { data, error, isLoading } = useSWR<{ report: TurnoverReport }>(
    `/api/admin/procurement/turnover?days=${days}${brandId ? `&brandId=${brandId}` : ""}`,
    fetcher,
    { keepPreviousData: true }
  );

  const report = data?.report;
  const t = report?.totals;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-bk">Оборотність складу</h1>
          <p className="mt-0.5 text-sm text-g500">
            Що лежить без руху{report ? ` понад ${report.velocityDays} днів` : ""} і скільки в цьому грошей
          </p>
        </div>
        <Link
          href="/admin/procurement"
          className="cursor-pointer rounded-[var(--radius-btn)] bg-g100 px-3.5 py-2 text-[13px] font-medium text-g600 transition-colors hover:bg-g200 hover:text-bk"
        >
          До закупівель
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
          className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-sm text-bk"
          aria-label="Бренд"
        >
          <option value="">Усі бренди</option>
          {brandsData?.brands?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        {/*
          Період — це вікно, за яким визначається «рухається / стоїть»:
          коротше вікно суворіше (більше позицій виглядають мертвими),
          довше — м'якше. Кнопки замість селекта: варіантів чотири, і між
          ними порівнюють, а не шукають у списку.
        */}
        <div className="flex overflow-hidden rounded-[var(--radius-btn)] border border-g200">
          {VELOCITY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`h-[38px] cursor-pointer px-3 text-sm transition-colors ${
                days === d ? "bg-bk text-white" : "bg-white text-g600 hover:bg-g50"
              }`}
            >
              {d} дн.
            </button>
          ))}
        </div>
        <span className="text-xs text-g400">рух рахується за цей період</span>
      </div>

      {error && <ErrorBox message={String(error.message ?? error)} />}
      {isLoading && !report && <TableSkeleton rows={8} />}

      {report && t && t.items === 0 && (
        <Card>
          <EmptyState title="Порожній склад" hint="За обраним фільтром немає позицій із залишком." />
        </Card>
      )}

      {report && t && t.items > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Запас на складі"
              value={money(t.stockValue)}
              unit="₴"
              hint={`${num(t.items)} позицій у цінах продажу`}
            />
            <StatCard
              label="Лежить без руху"
              value={money(t.staleValue)}
              unit="₴"
              tone={t.staleShare >= 40 ? "bad" : t.staleShare >= 20 ? "warn" : "neutral"}
              hint={`${num(t.stale)} позицій — ${num(t.staleShare, 0)}% складу`}
            />
            <StatCard
              label="Надлишок"
              value={money(t.overstockValue)}
              unit="₴"
              tone={t.overstock > 0 ? "warn" : "neutral"}
              hint={`${num(t.overstock)} позицій: продаються, але запасу понад пів року`}
            />
            <StatCard
              label="Оборотів на рік"
              value={t.turns === null ? "—" : num(t.turns, 1)}
              tone={turnsTone(t.turns)}
              hint={`у темпі останніх ${report.velocityDays} днів`}
            />
          </div>

          <p className="text-xs text-g500">
            {t.costKnownItems > 0 ? (
              <>
                Запас оцінено за <b>собівартістю</b> для {num(t.costKnownItems)} позицій
                ({money(t.costKnownValue)} ₴) — це реальні вкладені гроші. Решта{" "}
                {money(t.priceOnlyValue)} ₴ — товар, який ще не продавався, тож оцінений за
                прайсом і завищений на маржу.
              </>
            ) : (
              <>
                Суми — в цінах продажу: собівартість із 1С ще не приїхала, тому вартість
                запасу завищена на маржу.
              </>
            )}
          </p>

          {report.byBucket.length > 0 && (
            <Card padded={false}>
              <div className="p-4 sm:p-5">
                <CardHeader
                  title="Давність останнього продажу"
                  hint="Чим давніший продаж, тим менше шансів, що товар поїде сам"
                />
              </div>
              <TableScroll minWidth={420}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                      <th className="px-4 py-2.5">Останній продаж</th>
                      <th className="px-4 py-2.5 text-right">Позицій</th>
                      <th className="px-4 py-2.5 text-right">Сума, грн</th>
                      <th className="px-4 py-2.5 text-right">Частка складу</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-g100">
                    {report.byBucket.map((b) => (
                      <tr key={b.bucket}>
                        <td className="px-4 py-3 text-bk">{b.label}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-g600">{num(b.items)}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-bk">
                          {money(b.value)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-g500">
                          {num(t.stockValue > 0 ? (b.value / t.stockValue) * 100 : 0, 1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Card>
          )}

          {!brandId && report.byBrand.length > 1 && (
            <Card padded={false}>
              <div className="p-4 sm:p-5">
                <CardHeader
                  title="За брендами"
                  hint="Відсортовано за сумою мертвого запасу — з чого починати розбір"
                />
              </div>
              <TableScroll minWidth={760} stickyHeader>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                      <th className="px-4 py-2.5">Бренд</th>
                      <th className="px-4 py-2.5 text-right">Позицій</th>
                      <th className="px-4 py-2.5 text-right">Запас, грн</th>
                      <th className="px-4 py-2.5 text-right">Без руху, грн</th>
                      <th className="px-4 py-2.5 text-right">Днів запасу</th>
                      <th className="px-4 py-2.5 text-right">Оборотів/рік</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-g100">
                    {report.byBrand.slice(0, 40).map((b) => (
                      <tr key={b.brandId ?? "—"} className="transition-colors hover:bg-g50">
                        <td className="px-4 py-3 text-bk">{b.brandName}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-g600">
                          {num(b.items)}
                          {b.stale > 0 && (
                            <span className="ml-1 text-[11px] text-g400">({num(b.stale)} стоять)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-g600">
                          {money(b.stockValue)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-bk">
                          {money(b.staleValue)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-g600">
                          {b.daysOfStock === null ? "—" : num(Math.round(b.daysOfStock))}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge status={turnsTone(b.turns)}>
                            {b.turns === null ? "не рухається" : num(b.turns, 1)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Card>
          )}

          {report.worst.length > 0 && (
            <Card padded={false}>
              <div className="p-4 sm:p-5">
                <CardHeader
                  title="Найдорожчий мертвий запас"
                  hint={`Позиції без жодного продажу за ${report.velocityDays} днів, найдорожчі зверху`}
                />
              </div>
              <TableScroll minWidth={720} stickyHeader>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                      <th className="px-4 py-2.5">Товар</th>
                      <th className="px-4 py-2.5 text-right">Залишок</th>
                      <th className="px-4 py-2.5 text-right">Ціна, грн</th>
                      <th className="px-4 py-2.5 text-right">Сума, грн</th>
                      <th className="px-4 py-2.5 text-right">Не продається</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-g100">
                    {report.worst.map((i) => (
                      <tr key={i.id} className="transition-colors hover:bg-g50">
                        <td className="px-4 py-3">
                          <span className="text-bk">{i.name}</span>
                          <span className="block text-[11px] text-g400">
                            {i.brandName}
                            {i.sku ? ` · ${i.sku}` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-g600">{num(i.stock)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-g600">{money(i.price)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                          {money(i.value)}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-g500">
                          {i.daysSinceSale === null
                            ? "жодного продажу"
                            : `${num(i.daysSinceSale)} дн.`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
