"use client";

/**
 * Картка маршруту в дні логіста.
 *
 * Головна ідея — смуга кроків і ОДНА жовта дія. Досі картка показувала все
 * одразу: передачу водієві, оптимізатор, посилання, редактор точок — і на
 * десятку маршрутів це була стіна, у якій «що робити далі» доводилося
 * шукати очима. Тепер стан рахує сервер (lib/routes/progress.ts), а картка
 * показує рівно наступний крок; решта дій лишається, але нижче й тихіше.
 *
 * Розгорнута одна картка — та, з якою працюють. Інші згорнуті до шапки зі
 * смугою: день видно цілком, не гортаючи.
 */

import { useState } from "react";
import AssignDriverBar from "@/components/routes/AssignDriverBar";
import RoutePlanPanel from "@/components/routes/RoutePlanPanel";
import { Badge } from "@/components/ui/Badge";
import { formatPrice } from "@/lib/utils";
import { STEP_LABELS, type StepNumber, type StepState } from "@/lib/routes/progress";
import { points } from "@/lib/routes/driver-message";
import type { StatusKey } from "@/lib/analytics/colors";
import { ROUTE_STATUS_LABELS, type DayDriver, type FreeOrder, type RouteItem } from "./types";

const STATUS_BADGE: Record<string, StatusKey> = {
  PLANNED: "neutral",
  ASSIGNED: "info",
  IN_PROGRESS: "warn",
  COMPLETED: "good",
  CANCELLED: "bad",
};

/** Точки можна правити, поки водій не поїхав (дзеркало lib/routes/editable.ts) */
const EDITABLE = ["PLANNED", "ASSIGNED"];

/** Підказка під смугою, коли крок є, а зробити його не можна. */
const BLOCKER_HINT: Record<string, string> = {
  NO_DRIVER: "Спершу оберіть водія — без нього нема для кого рахувати день",
  NO_COORDS: "Потрібно щонайменше дві точки з координатами — уточніть піни нижче",
};

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <svg className="h-3.5 w-3.5 text-[#16A34A]" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (state === "current") return <span className="h-2.5 w-2.5 rounded-full bg-primary-dark" />;
  if (state === "skipped") return <span className="h-px w-3 bg-g300" />;
  return <span className="h-2.5 w-2.5 rounded-full border border-g300" />;
}

function ProgressStrip({ steps }: { steps: Record<StepNumber, StepState> }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Що лишилося зробити">
      {([1, 2, 3, 4] as StepNumber[]).map((n) => {
        const state = steps[n];
        return (
          <li
            key={n}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center gap-1.5"
          >
            <StepDot state={state} />
            <span
              className={`text-[12px] ${
                state === "current"
                  ? "font-semibold text-bk"
                  : state === "done"
                    ? "text-g500"
                    : "text-g400"
              }`}
            >
              {STEP_LABELS[n]}
              {state === "skipped" && " (пропущено)"}
            </span>
            {n < 4 && <span className="ml-1 hidden h-px w-4 bg-g200 sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}

export default function RouteCard({
  route,
  drivers,
  freeOrders,
  expanded,
  onToggle,
  onChanged,
  onOpenMap,
}: {
  route: RouteItem;
  drivers: DayDriver[];
  freeOrders: FreeOrder[];
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onOpenMap: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { progress } = route;
  const editable = EDITABLE.includes(route.status);
  const delivered = route.stops.filter((s) => s.status === "DELIVERED").length;

  /**
   * Жовта кнопка робить одне: розгортає картку на потрібному місці.
   * Саму дію виконують компоненти всередині — дублювати їхні запити тут
   * означало б мати два шляхи до одного результату.
   *
   * Тому в розгорнутій картці її немає: справжня кнопка вже на екрані, а
   * дві однакові «Надіслати водію» за десять сантиметрів одна від одної —
   * це питання «а яка з них справжня», а не підказка.
   */
  const CTA_LABEL: Record<string, string> = {
    ADD_STOPS: "Додати точки",
    ORDER: "Прокласти маршрут",
    ASSIGN: "Передати водію",
    SEND: "Надіслати водію",
    RESEND: "Надіслати ще раз",
  };

  const setDriver = async (driverId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/erp/delivery-routes/${route.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white">
      {/* Шапка — вона ж кнопка розгортання. Жовта дія поруч, але окремо. */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="min-h-[44px] flex-1 cursor-pointer text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold text-bk">{route.number}</span>
            <Badge status={STATUS_BADGE[route.status] ?? "neutral"} dot={route.status === "IN_PROGRESS"}>
              {ROUTE_STATUS_LABELS[route.status] ?? route.status}
            </Badge>
            {route.sheet && (
              <span className="rounded-[5px] border border-g200 bg-g50 px-2 py-0.5 text-[11px] text-g500">
                з листа 1С №{route.sheet.number}
              </span>
            )}
            {!!route.sheet?.newStops.length && (
              <span
                className="rounded-[5px] px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: "#FFFBEB", color: "#92400E", border: "1px solid #FCD34D" }}
                title={route.sheet.newStops.map((s) => s.name).join(", ")}
              >
                лист 1С змінився: +{route.sheet.newStops.length}
              </span>
            )}
            {route.linkStale && (
              <span
                className="rounded-[5px] px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: "#FFFBEB", color: "#92400E", border: "1px solid #FCD34D" }}
              >
                змінено після надсилання
              </span>
            )}
          </span>

          <span className="mt-1 block text-[13px] text-g500">
            {route.driver?.name ?? "Водія не обрано"} · {points(progress.stopsTotal)}
            {progress.stopsTotal - progress.withCoords > 0 &&
              ` · ${progress.stopsTotal - progress.withCoords} без координат`}
            {route.vehicleInfo && ` · ${route.vehicleInfo}`}
            {route.totalDistanceKm ? ` · ≈${Math.round(route.totalDistanceKm)} км` : ""}
            {(route.status === "IN_PROGRESS" || route.status === "COMPLETED") &&
              ` · ${delivered}/${progress.stopsTotal} доставлено`}
          </span>
        </button>

        {progress.cta && !expanded && (
          <button
            type="button"
            onClick={() => {
              if (!expanded) onToggle();
            }}
            className="min-h-[44px] flex-shrink-0 cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 text-[13px] font-bold text-bk transition-colors hover:bg-primary-hover"
          >
            {CTA_LABEL[progress.cta]}
          </button>
        )}
      </div>

      {/* Смуга кроків. Для закритих маршрутів її немає: там нічого не лишилось. */}
      {!progress.closed && (
        <div className="border-t border-g100 px-4 py-2.5 sm:px-5">
          <ProgressStrip steps={progress.steps} />

          {progress.blocker === "NO_DRIVER" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-g500">{BLOCKER_HINT.NO_DRIVER}</span>
              <select
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && setDriver(e.target.value)}
                aria-label="Обрати водія"
                className="min-h-[32px] cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-2 text-[12.5px] text-bk"
              >
                <option value="">Обрати водія…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          ) : progress.blocker ? (
            <p className="mt-2 text-[12px] text-g500">{BLOCKER_HINT[progress.blocker]}</p>
          ) : null}
        </div>
      )}

      {route.dayConflict && (
        <div
          className="border-t px-4 py-2.5 text-[12.5px] sm:px-5"
          style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#B91C1C" }}
        >
          Конфлікт: у водія на цей день ще один переданий маршрут{" "}
          <b>{route.dayConflict.number}</b>. Планшет покаже лише один, а зарплата
          порахує обидва як дві ставки — зайвий варто відкликати.
        </div>
      )}

      {expanded && (
        <>
          <AssignDriverBar
            routeId={route.id}
            status={route.status}
            driverId={route.driverId}
            driverName={route.driver?.name ?? null}
            date={route.date}
            assignedAt={route.assignedAt}
            stopsCount={progress.stopsTotal}
            drivers={drivers}
            onChanged={onChanged}
          />
          <RoutePlanPanel
            routeId={route.id}
            number={route.number}
            driverId={route.driverId}
            driverName={route.driver?.name ?? null}
            date={route.date}
            stops={route.stops}
            editable={editable}
            availableOrders={freeOrders}
            onChanged={onChanged}
            canSend={route.status === "ASSIGNED" || route.status === "IN_PROGRESS"}
            hasTelegram={route.driver?.hasTelegram ?? false}
            sentAt={route.linkSentAt}
            sentVia={route.linkSentVia}
          />
          <div className="flex flex-wrap items-center gap-3 border-t border-g100 px-4 py-2.5 text-[12.5px] sm:px-5">
            {/* Перемикання вкладки, а не посилання: сторінка та сама, і
                Link не оновив би стан, зчитаний з URL при монтуванні. */}
            <button
              type="button"
              onClick={onOpenMap}
              className="cursor-pointer text-g500 underline-offset-2 hover:text-bk hover:underline"
            >
              Відкрити на карті
            </button>
            {route.actualKm != null && <span className="text-g500">факт {route.actualKm} км</span>}
            {route.notes && <span className="text-g400">{route.notes}</span>}
            {route.stops.some((s) => s.salesDocument) && (
              <span className="text-g500">
                на суму{" "}
                {formatPrice(
                  route.stops.reduce((sum, s) => sum + (s.salesDocument?.totalAmount ?? 0), 0)
                )}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
