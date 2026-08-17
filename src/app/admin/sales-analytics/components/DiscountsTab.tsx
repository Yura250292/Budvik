"use client";

/**
 * Знижки: скільки маржі віддано і кому.
 *
 * Порядок екрана — від «скільки це взагалі» до «з кого починати розмову»:
 * підсумок, потім торгові (у кого відсоток вибивається), потім клієнти й
 * товари. Розрахунок на сервері (lib/analytics/discounts.ts).
 */

import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { Period } from "@/components/ui/PeriodPicker";

type Response = {
  totals: {
    revenue: number;
    explicit: number;
    explicitDocs: number;
    hidden: number;
    hiddenLines: number;
    totalPct: number;
    gross: number;
  };
  byRep: Array<{
    repId: string;
    repName: string;
    revenue: number;
    explicit: number;
    hidden: number;
    total: number;
    pctOfRevenue: number;
    gross: number;
    grossPct: number;
  }>;
  byClient: Array<{
    counterpartyId: string;
    name: string;
    repName: string | null;
    revenue: number;
    total: number;
    pctOfRevenue: number;
    gross: number;
    grossPct: number;
    docs: number;
  }>;
  byProduct: Array<{
    productId: string;
    name: string;
    brandName: string | null;
    medianPrice: number;
    avgSoldPrice: number;
    lines: number;
    qty: number;
    lost: number;
  }>;
  minSalesForMedian: number;
};

/** Знижка понад 8% від обороту — привід питати, чому. */
const HIGH_DISCOUNT_PCT = 8;

export function DiscountsTab({ period, rep }: { period: Period; rep: string }) {
  const qs = new URLSearchParams({ from: period.from, to: period.to });
  if (rep) qs.set("rep", rep);
  const { data, loading, error, reload } = useApi<Response>(
    `/api/admin/sales-analytics/discounts?${qs}`
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={10} />;
  if (!data) return null;

  const t = data.totals;
  const given = t.explicit + t.hidden;
  // Скільки валу було б без знижок — найпереконливіше число на екрані.
  const shareOfGross = t.gross > 0 ? (given / t.gross) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Віддано знижками"
          value={money(given)}
          unit="грн"
          tone={t.totalPct > 3 ? "warn" : "neutral"}
          hint={`${num(t.totalPct, 2)}% обороту за період`}
        />
        <StatCard
          label="Це від валу"
          value={num(shareOfGross, 0)}
          unit="%"
          tone={shareOfGross > 20 ? "bad" : shareOfGross > 10 ? "warn" : "good"}
          hint={`вал ${money(t.gross)} ₴ — стільки лишилось після знижок`}
        />
        <StatCard
          label="Явна знижка"
          value={money(t.explicit)}
          unit="грн"
          hint={`${num(t.explicitDocs)} документів зі знижкою в шапці`}
        />
        <StatCard
          label="Прихована"
          value={money(t.hidden)}
          unit="грн"
          tone={t.hidden > t.explicit ? "warn" : "neutral"}
          hint={`${num(t.hiddenLines)} рядків продано нижче звичайної ціни`}
        />
      </div>

      <p className="text-xs text-g500">
        <b>Явна</b> знижка — різниця між сумою позицій і сумою документа (менеджер
        поставив «−5%»). <b>Прихована</b> — рядок проданий дешевше, ніж цей товар
        зазвичай їде: у документі знижки немає, ціна просто набрана нижча. За
        «звичайну» беремо медіанну ціну продажу товару (мінімум{" "}
        {data.minSalesForMedian} продажів), а не прайс: прайс — це роздріб, а
        торгові возять опт. Валютні документи виключені — там ціна в валюті
        договору, і будь-яке порівняння з гривневою медіаною безглузде.
      </p>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="По торгових"
            hint="Порівнювати треба відсоток від власного обороту, а не суму: у кого більший оборот, у того й знижок більше в гривнях."
          />
        </div>
        <TableScroll minWidth={860}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Торговий</th>
                <th className="px-4 py-2.5 text-right">Оборот, грн</th>
                <th className="px-4 py-2.5 text-right">Явна</th>
                <th className="px-4 py-2.5 text-right">Прихована</th>
                <th className="px-4 py-2.5 text-right">Разом знижки</th>
                <th className="px-4 py-2.5 text-right">% обороту</th>
                <th className="px-4 py-2.5 text-right">Вал, грн</th>
                <th className="px-4 py-2.5 text-right">Рент.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {data.byRep.map((r) => (
                <tr key={r.repId} className="transition-colors hover:bg-g50">
                  <td className="px-4 py-3 font-medium text-bk">{r.repName}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.revenue)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">
                    {r.explicit > 0 ? money(r.explicit) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">
                    {r.hidden > 0 ? money(r.hidden) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                    {money(r.total)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span
                      className={
                        r.pctOfRevenue >= HIGH_DISCOUNT_PCT
                          ? "font-semibold text-red-600"
                          : "text-g600"
                      }
                    >
                      {num(r.pctOfRevenue, 1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.gross)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">
                    {num(r.grossPct, 1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      {data.byClient.length === 0 ? (
        <Card>
          <EmptyState title="Знижок не знайдено" hint="За цей період усе продано за звичайними цінами." />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Кому даємо найбільше"
              hint="Дивитись разом із рентабельністю: клієнт зі знижкою 12% і маржею 5% коштує дорожче, ніж приносить."
            />
          </div>
          <TableScroll minWidth={800}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Клієнт</th>
                  <th className="px-4 py-2.5">Торговий</th>
                  <th className="px-4 py-2.5 text-right">Оборот</th>
                  <th className="px-4 py-2.5 text-right">Знижки</th>
                  <th className="px-4 py-2.5 text-right">% обороту</th>
                  <th className="px-4 py-2.5 text-right">Вал</th>
                  <th className="px-4 py-2.5 text-right">Рент.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {data.byClient.map((c) => (
                  <tr key={c.counterpartyId} className="transition-colors hover:bg-g50">
                    <td className="px-4 py-3 text-bk">
                      {c.name}
                      <span className="block text-[11px] text-g400">{num(c.docs)} накладних</span>
                    </td>
                    <td className="px-4 py-3 text-g600">{c.repName ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{money(c.revenue)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                      {money(c.total)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span
                        className={
                          c.pctOfRevenue >= HIGH_DISCOUNT_PCT
                            ? "font-semibold text-red-600"
                            : "text-g600"
                        }
                      >
                        {num(c.pctOfRevenue, 1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{money(c.gross)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {/* Рентабельність нижча за 8% при знижці — саме той
                          випадок, коли клієнт працює в нуль. */}
                      <span className={c.grossPct < 8 ? "font-semibold text-red-600" : "text-g600"}>
                        {num(c.grossPct, 1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {data.byProduct.length > 0 && (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="На яких товарах втрачаємо"
              hint="Медіанна ціна проти фактичної. Якщо розрив стабільний — можливо, медіана застаріла і прайс варто переглянути."
            />
          </div>
          <TableScroll minWidth={760}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Товар</th>
                  <th className="px-4 py-2.5">Бренд</th>
                  <th className="px-4 py-2.5 text-right">Звичайна ціна</th>
                  <th className="px-4 py-2.5 text-right">Продано по</th>
                  <th className="px-4 py-2.5 text-right">Різниця</th>
                  <th className="px-4 py-2.5 text-right">Рядків</th>
                  <th className="px-4 py-2.5 text-right">Втрачено</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {data.byProduct.map((p) => {
                  const gap =
                    p.medianPrice > 0 ? ((p.medianPrice - p.avgSoldPrice) / p.medianPrice) * 100 : 0;
                  return (
                    <tr key={p.productId} className="transition-colors hover:bg-g50">
                      <td className="px-4 py-3 text-bk">{p.name}</td>
                      <td className="px-4 py-3 text-g600">{p.brandName ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">
                        {money(p.medianPrice)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">
                        {money(p.avgSoldPrice)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={gap >= 15 ? "font-semibold text-red-600" : "text-g600"}>
                          −{num(gap, 1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">{num(p.lines)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                        {money(p.lost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}
    </div>
  );
}
