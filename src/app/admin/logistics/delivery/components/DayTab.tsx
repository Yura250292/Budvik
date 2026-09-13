"use client";

/**
 * День логіста: усе, що їде або поїде цієї доби.
 *
 * Один список замість двох екранів: маршрути сайту (будь-якого стану) і
 * листи 1С, з яких маршруту ще не зробили. Порядок — за роботою, а не за
 * алфавітом: спершу те, що в дорозі й передане, потім чернетки й свіжі
 * листи, і аж у кінці завершене та скасоване.
 *
 * Розгорнута рівно одна картка — та, з якою працюють. Решта згорнуті до
 * шапки зі смугою кроків, і день видно цілком.
 */

import { useMemo, useState } from "react";
import DayNav from "@/components/ui/DayNav";
import { Card, EmptyState } from "@/components/ui/Card";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { useApi } from "@/components/ui/useApi";
import RouteCard from "./RouteCard";
import SheetCard from "./SheetCard";
import RouteCreateForm from "./RouteCreateForm";
import type { DayResponse, FreeOrder, RouteItem, SheetItem } from "./types";

/** Порядок роботи: що робиться зараз — вище; історія — внизу. */
const RANK: Record<string, number> = {
  IN_PROGRESS: 0,
  ASSIGNED: 1,
  PLANNED: 2,
  SHEET: 3,
  COMPLETED: 4,
  CANCELLED: 5,
};

function rankOf(item: RouteItem | SheetItem): number {
  return item.kind === "sheet" ? RANK.SHEET : (RANK[item.status] ?? 9);
}

/** «2026-09-04» → «04.09» для заголовків і порожніх станів. */
function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  return d && m ? `${d}.${m}` : day;
}

export default function DayTab({
  day,
  driverId,
  openId,
  onDayChange,
  onDriverChange,
  onOpenChange,
  onOpenMap,
}: {
  day: string;
  driverId: string | null;
  openId: string | null;
  onDayChange: (day: string) => void;
  onDriverChange: (driverId: string | null) => void;
  onOpenChange: (id: string | null) => void;
  /** Відкрити цей маршрут у вкладці «Карта» */
  onOpenMap: (routeId: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  /**
   * Логіст згорнув ту картку, яку ми розгорнули за нього.
   *
   * Без цього прапорця клік по авторозгорнутій картці нічого не давав:
   * ?routeId ставав порожнім, і та сама картка знову ставала «першою, де є
   * що робити». Скидається при зміні дня — там свій «перший».
   */
  const [collapsedAuto, setCollapsedAuto] = useState(false);
  // Скидання під час рендера, а не в ефекті: ефект із setState дає зайвий
  // прохід рендера, і eslint справедливо на це свариться.
  const scope = `${day}|${driverId ?? ""}`;
  const [lastScope, setLastScope] = useState(scope);
  if (scope !== lastScope) {
    setLastScope(scope);
    setCollapsedAuto(false);
  }

  const query = `/api/erp/delivery-routes/day?day=${day}${driverId ? `&driverId=${driverId}` : ""}`;
  const { data, loading, error, reload } = useApi<DayResponse>(query);
  // Замовлення потрібні лише формі й редактору точок, але список маленький
  // і кешується SWR — окремий ледачий запит тут нічого б не виграв.
  const { data: orders } = useApi<FreeOrder[]>("/api/erp/sales?status=CONFIRMED");

  const items = useMemo(() => {
    const list = [...(data?.items ?? [])];
    list.sort((a, b) => {
      const byRank = rankOf(a) - rankOf(b);
      if (byRank !== 0) return byRank;
      const nameA = a.kind === "route" ? (a.driver?.name ?? "яя") : (a.driverName ?? a.driverName1C ?? "яя");
      const nameB = b.kind === "route" ? (b.driver?.name ?? "яя") : (b.driverName ?? b.driverName1C ?? "яя");
      return nameA.localeCompare(nameB, "uk") || a.number.localeCompare(b.number, "uk");
    });
    return list;
  }, [data]);

  /**
   * Вільні замовлення: одна накладна живе рівно в одному маршруті, тож
   * пропонувати зайняті — значить ловити 409. Перевіряємо по маршрутах цього
   * дня; від дублів у сусідні дні страхує @unique на самій накладній.
   */
  const freeOrders = useMemo(() => {
    const taken = new Set(
      items.flatMap((i) => (i.kind === "route" ? i.stops.map((s) => s.salesDocument?.id) : [])).filter(Boolean)
    );
    return (orders ?? []).filter((o) => !taken.has(o.id));
  }, [items, orders]);

  /** Розгорнута картка: обрана в URL, інакше перша, де ще є що робити. */
  const autoId =
    items.find((i) => i.kind === "route" && !i.progress.closed && i.progress.current !== null)?.id ?? null;
  const expandedId = openId ?? (collapsedAuto ? null : autoId);

  const toggle = (id: string) => {
    if (expandedId === id) {
      setCollapsedAuto(true);
      onOpenChange(null);
    } else {
      setCollapsedAuto(false);
      onOpenChange(id);
    }
  };

  const drivers = data?.drivers ?? [];
  const today = data?.today ?? day;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DayNav
          day={day}
          onDayChange={onDayChange}
          driverId={driverId}
          drivers={drivers}
          onDriverChange={onDriverChange}
        />
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="min-h-[38px] cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-4 text-[13px] font-semibold text-bk transition-colors hover:bg-g50"
          >
            + Скласти маршрут
          </button>
        )}
      </div>

      {creating && (
        <RouteCreateForm
          day={day}
          driverId={driverId}
          drivers={drivers}
          freeOrders={freeOrders}
          onCreated={(id) => {
            setCreating(false);
            onOpenChange(id);
            reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {error && <ErrorBox message="Не вдалося завантажити день" onRetry={reload} />}

      {loading && !data ? (
        <>
          <CardSkeleton rows={2} title />
          <CardSkeleton rows={2} title />
        </>
      ) : items.length === 0 && !creating ? (
        <Card>
          <EmptyState
            title={
              driverId
                ? `У цього водія на ${shortDay(day)} нічого немає`
                : `На ${shortDay(day)} маршрутів немає`
            }
            hint={
              day < today
                ? "Того дня маршрутів не складали."
                : "Листи 1С зʼявляються після обміну — зазвичай на завтрашній день доставки. Або складіть маршрут самі, знайшовши клієнтів у базі."
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) =>
            item.kind === "route" ? (
              <RouteCard
                key={item.id}
                route={item}
                drivers={drivers}
                freeOrders={freeOrders}
                expanded={expandedId === item.id}
                onToggle={() => toggle(item.id)}
                onChanged={reload}
                onOpenMap={() => onOpenMap(item.id)}
              />
            ) : (
              <SheetCard
                key={item.id}
                sheet={item}
                today={today}
                expanded={expandedId === item.id}
                onToggle={() => toggle(item.id)}
                onConverted={(routeId) => {
                  if (routeId) onOpenChange(routeId);
                  reload();
                }}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
