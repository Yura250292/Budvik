"use client";

/**
 * Картка маршрутного листа 1С у дні логіста.
 *
 * Лист сам по собі водієві не доїде: планшет і зарплата працюють з
 * маршрутами сайту, тому лист спершу стає маршрутом. Досі це робилося в
 * зовсім іншому розділі (Водії → Маршрутні листи), і між «прийшов лист» та
 * «водій поїхав» був перехід між екранами.
 *
 * Тут лист стоїть поряд із маршрутами того ж дня й має одну дію — «Взяти в
 * роботу». Після неї сервер віддає вже маршрут, і на тому самому місці
 * зʼявляється звичайна картка маршруту.
 */

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { formatPrice } from "@/lib/utils";
import { ROUTE_STATUS_LABELS, type SheetItem } from "./types";

export default function SheetCard({
  sheet,
  today,
  expanded,
  onToggle,
  onConverted,
}: {
  sheet: SheetItem;
  today: string;
  expanded: boolean;
  onToggle: () => void;
  onConverted: (routeId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayTag =
    sheet.day > today ? (sheet.day === nextDay(today) ? "на завтра" : "наперед") : sheet.day < today ? "минулий день" : null;

  const convert = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/drivers/route-sheets/to-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId: sheet.id }),
      });
      const data = await res.json().catch(() => ({}));
      // alreadyExists — теж успіх: маршрут за цим листом уже є, покажемо його.
      if (!res.ok) setError(data.error || "Не вдалося зробити маршрут");
      else onConverted(data.route?.id);
    } catch {
      setError("Немає зв'язку — спробуйте ще раз");
    }
    setBusy(false);
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="min-h-[44px] flex-1 cursor-pointer text-left">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold text-bk">Лист 1С №{sheet.number}</span>
            <Badge status="neutral">1С</Badge>
            {dayTag && <Badge status="info">{dayTag}</Badge>}
            {!sheet.posted && <Badge status="warn">не проведено</Badge>}
            {sheet.blocker === "NO_DRIVER" && <Badge status="warn">водія не привʼязано</Badge>}
          </span>
          <span className="mt-1 block text-[13px] text-g500">
            {sheet.driverName ?? sheet.driverName1C ?? "Водій не вказаний"} · {sheet.stopsCount} точок
            {sheet.ordersTotal > 0 && ` · ${formatPrice(sheet.ordersTotal)} замовлень`}
            {sheet.debtsTotal > 0 && ` · борги ${formatPrice(sheet.debtsTotal)}`}
            {sheet.vehicle && ` · ${sheet.vehicle}`}
            {sheet.distanceKm > 0 && ` · ${sheet.distanceKm} км`}
          </span>
        </button>

        {sheet.blocker === null && (
          <button
            type="button"
            onClick={convert}
            disabled={busy}
            className="min-h-[44px] flex-shrink-0 cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 text-[13px] font-bold text-bk transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {busy ? "Створюю маршрут…" : "Взяти в роботу"}
          </button>
        )}
      </div>

      {/* Чому дію не показано — словами, а не сірою кнопкою. */}
      {sheet.blocker === "NO_DRIVER" && (
        <div className="border-t border-g100 px-4 py-2.5 text-[12.5px] text-g600 sm:px-5">
          У 1С лист виписано на «{sheet.driverName1C ?? "—"}», але цього водія не привʼязано до акаунта.{" "}
          <Link href="/admin/drivers?tab=settings" className="underline underline-offset-2 hover:text-bk">
            Привʼязати водія →
          </Link>
        </div>
      )}
      {sheet.blocker === "NO_STOPS" && (
        <div className="border-t border-g100 px-4 py-2.5 text-[12.5px] text-g500 sm:px-5">
          Точок ще немає — обмін їх не привіз. Зазвичай зʼявляються протягом дня.
        </div>
      )}
      {!sheet.posted && sheet.blocker === null && (
        <div className="border-t border-g100 px-4 py-2.5 text-[12.5px] text-g500 sm:px-5">
          Лист ще не проведено в 1С — склад точок може змінитися. Після «Взяти в роботу» маршрут за листом
          більше не оновлюється.
        </div>
      )}
      {sheet.existingRoute && (
        <div className="border-t border-g100 px-4 py-2.5 text-[12.5px] text-g600 sm:px-5">
          У цього водія на день уже є маршрут <b>{sheet.existingRoute.number}</b> (
          {ROUTE_STATUS_LABELS[sheet.existingRoute.status] ?? sheet.existingRoute.status}). Планшет показує
          один маршрут на день.
        </div>
      )}

      {error && (
        <div className="px-4 pb-3 sm:px-5">
          <ErrorBox message={error} />
        </div>
      )}

      {expanded && sheet.stops.length > 0 && (
        <div className="border-t border-g100">
          {sheet.stops.map((s) => (
            <div key={s.id} className="flex items-start gap-3 border-b border-g50 px-4 py-2 last:border-b-0 sm:px-5">
              <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-g100 text-[11px] font-bold text-g600">
                {s.sequence}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] text-bk">{s.name}</p>
                {s.address && <p className="truncate text-[12px] text-g500">{s.address}</p>}
              </div>
              {/* Пін вирішує, чи потрапить точка в посилання водієві. */}
              <span
                className="mt-0.5 flex-shrink-0 rounded-[5px] px-2 py-0.5 text-[11px] font-semibold"
                style={
                  !s.hasCoords
                    ? { background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA" }
                    : s.geoSource === "MANUAL"
                      ? { background: "#F0FDF4", color: "#166534", border: "1px solid #BBF7D0" }
                      : { background: "#FFFBEB", color: "#92400E", border: "1px solid #FCD34D" }
                }
              >
                {!s.hasCoords ? "немає точки" : s.geoSource === "MANUAL" ? "точка уточнена" : "пін приблизний"}
              </span>
              {s.amount > 0 && (
                <span className="mt-0.5 flex-shrink-0 text-[12.5px] font-semibold tabular-nums text-bk">
                  {formatPrice(s.amount)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Наступна доба рядком — щоб не тягнути сюди PeriodPicker заради одного тега. */
function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
