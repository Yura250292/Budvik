"use client";

import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { BrandGauge } from "@/components/ui/Gauge";
import { money, num } from "@/components/ui/Stat";
import { STATUS } from "@/lib/analytics/colors";
import type { PlanBrand } from "./useSalesAnalytics";

/**
 * Кільця по фірмах: план, факт і зароблене з кожної.
 *
 * Фірми БЕЗ плану винесені окремою секцією, а не показані сірими
 * кільцями в загальній сітці. Сіре кільце в ряду кольорових читається як
 * «провалено», хоча насправді це «цілі не ставили» — різниця принципова
 * для розмови з керівником.
 */

function EarnedFooter({ brand }: { brand: PlanBrand }) {
  if (brand.earned === null) {
    return (
      <span className="text-center text-[10px] leading-tight text-cab-t3">
        окремих правил немає
      </span>
    );
  }
  return (
    <span className="text-center text-[11px] font-semibold tabular-nums" style={{ color: STATUS.good.fg }}>
      +{money(brand.earned)} ₴
    </span>
  );
}

export function BrandPlanList({ brands }: { brands: PlanBrand[] }) {
  const planned = brands.filter((b) => b.target > 0);
  const unplanned = brands.filter((b) => b.target <= 0);

  if (brands.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Планів на цей місяць не задано"
          hint="План на місяць по фірмах ставить керівник у розділі «КПІ та плани». Без нього кільця показувати нема від чого."
        />
      </Card>
    );
  }

  return (
    <>
      {planned.length > 0 ? (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="План по фірмах"
              hint="Кільце — виконання місячного плану. Зелене число під ним — скільки ви заробили саме з цієї фірми за обраний період."
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {planned.map((b) => (
                <BrandGauge
                  key={b.brandId}
                  name={b.brandName}
                  percent={b.attainment}
                  color={b.color}
                  hasTarget
                  caption={`${money(b.actual)} / ${money(b.target)}`}
                  footer={<EarnedFooter brand={b} />}
                />
              ))}
            </div>
          </div>

          {/*
            Ті самі числа текстом: кільце показує «як», рядки — «скільки».

            Списком, а не таблицею. П'ять колонок на телефоні не вміщалися:
            блок їхав горизонтальною прокруткою, і «Заробіток» — єдина колонка,
            заради якої сюди й заходять, — опинявся за краєм екрана.
          */}
          <div className="border-t border-cab-line">
            {planned.map((b) => (
              <div key={b.brandId} className="border-b border-[#F1F1EF] px-4 py-3 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: b.color }}
                    />
                    <span className="truncate text-sm font-semibold text-bk">{b.brandName}</span>
                  </span>
                  {b.earned === null ? (
                    <span className="shrink-0 text-sm text-cab-t3">—</span>
                  ) : (
                    <span
                      className="shrink-0 text-sm font-bold tabular-nums"
                      style={{ color: STATUS.good.fg }}
                    >
                      {money(b.earned)} ₴
                    </span>
                  )}
                </div>

                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  <span className="flex flex-col">
                    <span className="text-[11px] text-cab-t3">План</span>
                    <span className="text-[13px] font-semibold tabular-nums text-cab-t2">
                      {money(b.target)}
                    </span>
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[11px] text-cab-t3">Виконано</span>
                    <span className="text-[13px] font-semibold tabular-nums text-bk">
                      {money(b.actual)}
                      <span className="ml-1 font-normal text-cab-t3">{num(b.attainment)}%</span>
                    </span>
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[11px] text-cab-t3">Зібрано</span>
                    <span className="text-[13px] font-semibold tabular-nums text-cab-t2">
                      {money(b.collected)}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            title="Планів по фірмах не задано"
            hint="Продажі по фірмах є, але цілей на місяць немає — попросіть керівника задати їх у «КПІ та плани»."
          />
        </Card>
      )}

      {unplanned.length > 0 && (
        <Card className="mt-3">
          <CardHeader
            title="Фірми без плану"
            hint="Продажі є, цілі на місяць немає — тож і відсотка виконання бути не може."
          />
          <ul className="divide-y divide-[#F1F1EF] text-sm">
            {unplanned.map((b) => (
              <li key={b.brandId} className="flex items-baseline justify-between gap-3 py-2">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: b.color }}
                  />
                  <span className="truncate text-bk">{b.brandName}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-semibold tabular-nums text-bk">{money(b.actual)} ₴</span>
                  {b.earned !== null && b.earned > 0 && (
                    <span
                      className="ml-2 text-xs font-semibold tabular-nums"
                      style={{ color: STATUS.good.fg }}
                    >
                      +{money(b.earned)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
