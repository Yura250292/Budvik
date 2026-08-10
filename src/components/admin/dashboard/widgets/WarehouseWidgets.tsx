"use client";

import { money, num } from "@/components/ui/Stat";
import { categoricalColor, STATUS } from "@/lib/analytics/colors";
import { useDashboardData } from "../DashboardData";
import { Bar, Metric, WidgetBody } from "./parts";

const WAREHOUSE = "/admin/warehouse-reports";

/** KPI складу за період: накладні, сума, позиції, зміни. */
export function WarehouseTotals() {
  const { warehouse } = useDashboardData();
  const k = warehouse.data?.kpis;

  return (
    <WidgetBody
      title="Склад за період"
      hint="Накладні, розпізнані з фото"
      href={WAREHOUSE}
      loading={warehouse.loading}
      error={warehouse.error}
      empty={!!warehouse.data && k?.totalReports === 0}
    >
      {k && (
        <div className="flex h-full flex-col justify-between gap-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Metric label="Накладних" value={num(k.totalReports)} />
            <Metric label="Сума" value={`${money(k.totalAmount)} ₴`} />
            <Metric label="Позицій" value={num(k.totalItems)} />
            <Metric label="Годин" value={num(k.totalHours, 1)} sub={`${num(k.totalShifts)} змін`} />
          </div>
          {(k.pending > 0 || k.failed > 0) && (
            <div className="flex flex-wrap gap-2">
              {k.pending > 0 && (
                <span className="rounded-full bg-[#FFF6E0] px-2.5 py-1 text-[11px] font-medium text-[#C77700]">
                  Обробляється: {num(k.pending)}
                </span>
              )}
              {k.failed > 0 && (
                <span className="rounded-full bg-[#FFEAEA] px-2.5 py-1 text-[11px] font-medium text-[#C62828]">
                  Не розпізнано: {num(k.failed)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </WidgetBody>
  );
}

/** Хто зараз на зміні — найкорисніше «прямо зараз» на складі. */
export function WarehouseShifts() {
  const { warehouse } = useDashboardData();
  const open = (warehouse.data?.workers ?? []).filter((w) => w.openShift);

  const timeFmt = new Intl.DateTimeFormat("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Kyiv",
  });

  return (
    <WidgetBody
      title="Зараз на зміні"
      hint="Відкриті зміни складовщиків"
      href={WAREHOUSE}
      loading={warehouse.loading}
      error={warehouse.error}
      empty={!!warehouse.data && open.length === 0}
      emptyText="Відкритих змін немає"
    >
      <ul className="h-full overflow-y-auto">
        {open.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-bk">{w.name}</span>
              <span className="block truncate text-[11px] text-g500">
                {w.openShift?.openAddress || "Місце не вказано"}
              </span>
            </span>
            <span className="flex-shrink-0 text-[12px] font-semibold tabular-nums text-g600">
              з {timeFmt.format(new Date(w.openShift!.openedAt))}
            </span>
          </li>
        ))}
      </ul>
    </WidgetBody>
  );
}

/**
 * Продуктивність складовщиків у позиціях за годину.
 * Порівняння з командним середнім — те, заради чого існує вкладка
 * «Продуктивність»: саме воно показує, хто просів.
 */
export function WarehouseProductivity() {
  const { warehouse } = useDashboardData();
  const avg = warehouse.data?.teamAvg.itemsPerHour ?? 0;
  const rows = (warehouse.data?.workers ?? [])
    .filter((w) => w.doneCount > 0 && w.itemsPerHour > 0)
    .sort((a, b) => b.itemsPerHour - a.itemsPerHour)
    .slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.itemsPerHour));

  return (
    <WidgetBody
      title="Продуктивність складу"
      hint={avg > 0 ? `Командне середнє — ${num(avg, 1)} поз./год` : "Позицій за годину"}
      href={WAREHOUSE}
      loading={warehouse.loading}
      error={warehouse.error}
      empty={!!warehouse.data && rows.length === 0}
    >
      <div className="h-full overflow-y-auto">
        {rows.map((w, i) => {
          const delta = avg > 0 ? (w.itemsPerHour / avg - 1) * 100 : 0;
          return (
            <Bar
              key={w.id}
              label={w.name}
              value={w.itemsPerHour}
              max={max}
              display={num(w.itemsPerHour, 1)}
              suffix={avg > 0 ? `${delta >= 0 ? "+" : ""}${num(delta)}%` : "поз./год"}
              color={avg > 0 && delta < -15 ? STATUS.warn.mark : categoricalColor(i)}
            />
          );
        })}
      </div>
    </WidgetBody>
  );
}

/** Топ номенклатури, що проходила через склад. */
export function WarehouseNomenclature() {
  const { warehouse } = useDashboardData();
  const rows = (warehouse.data?.nomenclature ?? []).slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.totalSum));

  return (
    <WidgetBody
      title="Номенклатура складу"
      hint="За сумою в накладних"
      href={WAREHOUSE}
      loading={warehouse.loading}
      error={warehouse.error}
      empty={!!warehouse.data && rows.length === 0}
    >
      <div className="h-full overflow-y-auto">
        {rows.map((n) => (
          <Bar
            key={`${n.name}-${n.sku}`}
            label={n.name}
            value={n.totalSum}
            max={max}
            display={money(n.totalSum)}
            suffix={`${num(n.quantity)} шт.`}
            color="var(--color-g400)"
          />
        ))}
      </div>
    </WidgetBody>
  );
}
