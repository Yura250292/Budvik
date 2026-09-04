"use client";

/**
 * День обраної людини: звірка трьох джерел, план і відмітки.
 *
 * Маршрутний лист 1С каже, скільки кілометрів і боргів планували, трек —
 * скільки проїхали насправді, відмітки — скільки грошей забрали. Раніше ці
 * цифри були розкидані по колонках спільної таблиці й читалися лише для
 * того рядка, на який щойно клікнули; тепер вони зібрані під картою для
 * однієї людини, про яку зараз ідеться.
 */

import type { ReactNode } from "react";
// Пороги епізоду — з того самого модуля, що й рахує: підпис під
// відхиленнями не має розходитися з логікою.
import { EXCURSION_MIN_MINUTES, EXCURSION_MIN_KM } from "@/lib/sales/deviation";
import { Card } from "@/components/ui/Card";
import { TrackHealthCard } from "./TrackHealthCard";
import type { DayDetail } from "./LiveTrackTab";

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Час епізоду в «14:05» за Києвом. */
function kyivClock(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Колір замовлення на карті — дублюємо в легенді, щоб підпис не збрехав. */
const ORDER_COLOR = "#7C3AED";

function MiniStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "bad" | "muted";
}) {
  const valueColor =
    tone === "bad" ? "text-red-600" : tone === "muted" ? "text-g500" : "text-bk";
  return (
    <div>
      <p className="text-xs text-g500">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-g400">{hint}</p>}
    </div>
  );
}

/** «4 год 10 хв» — час на екрані читають боком, а не рахують у хвилинах. */
function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} год ${m} хв` : `${m} хв`;
}

export function LivePersonDetail({
  detail,
  day,
  onClose,
}: {
  detail: DayDetail;
  day: string;
  onClose: () => void;
}) {
  const sheet = detail.sheet1C;
  const isDriver = detail.user.role === "DRIVER";
  /**
   * З чим порівнювати GPS.
   *
   * Маршрут сайту точніший за лист 1С: у ньому дорога порахована OSRM по
   * реальних адресах, а в 1С кілометраж заповнений у двох листів із сорока.
   * Тому план сайту головніший, а лист лишається запасним.
   */
  const plannedKm =
    detail.route.source === "DELIVERY_ROUTE" && (detail.route.plannedKm ?? 0) > 0
      ? (detail.route.plannedKm as number)
      : null;
  const basis = plannedKm ?? (sheet && sheet.distanceKm > 0 ? sheet.distanceKm : null);
  const deviation =
    basis != null ? Math.round(((detail.track.distanceKm - basis) / basis) * 100) : null;
  const move = detail.track.movement;

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-bk">
            {detail.user.name}
            <span className="ml-2 text-xs font-normal text-g400">
              {detail.user.role === "DRIVER" ? "водій" : "торговий"}
            </span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-xs text-g500 transition-colors hover:text-bk"
          >
            Зняти вибір
          </button>
        </div>

        <div
          className={`grid grid-cols-2 gap-3 ${isDriver ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-4"}`}
        >
          <MiniStat
            label="Трек (GPS)"
            value={`${detail.track.distanceKm} км`}
            hint={
              move ? `їзда ${move.DRIVE.km} км · ${detail.track.pointsCount} точок` : `${detail.track.pointsCount} точок`
            }
          />
          {/* Три різні відповіді на «скільки проїхав» стоять поруч
              навмисно: план — намір, GPS — вимір, одометр — те, за що
              платять. Раніше з них була видна лише одна. */}
          {isDriver && (
            <MiniStat
              label="План OSRM"
              value={plannedKm != null ? `${Math.round(plannedKm)} км` : "—"}
              hint={
                detail.route.number ? `маршрут ${detail.route.number}` : "маршруту сайту немає"
              }
            />
          )}
          {isDriver && (
            <MiniStat
              label="Одометр / вручну"
              value={detail.route.actualKm != null ? `${Math.round(detail.route.actualKm)} км` : "—"}
              hint={detail.route.actualKm != null ? "з журналу листів" : "не введено"}
            />
          )}
          <MiniStat
            label="Лист 1С"
            value={sheet ? `${sheet.distanceKm} км` : "—"}
            hint={sheet ? `№ ${sheet.number}` : "листа немає"}
          />
          <MiniStat
            label="Відхилення"
            value={deviation != null ? `${deviation > 0 ? "+" : ""}${deviation}%` : "—"}
            tone={deviation != null && deviation > 0 ? "bad" : "muted"}
            hint={
              basis == null
                ? "нема з чим порівняти"
                : plannedKm != null
                  ? "GPS проти плану OSRM"
                  : "GPS проти листа 1С"
            }
          />
          <MiniStat
            label="Зібрано"
            value={sheet ? money.format(sheet.collected) : "—"}
            hint={sheet ? `з ${money.format(sheet.debtsTotal)} грн боргу` : undefined}
          />
        </div>

        {/* Як саме склався пробіг: половина «зайвих» кілометрів у звітах —
            це насправді ходьба по двору бази й ринку. */}
        {!!move && detail.track.pointsCount > 0 && (
          <p className="mt-3 text-[13px] text-g600">
            їзда <b className="tabular-nums">{move.DRIVE.km} км</b> · {hm(move.DRIVE.minutes)}
            {move.WALK.km > 0 && (
              <>
                {" · пішки "}
                <b className="tabular-nums">{move.WALK.km} км</b> · {hm(move.WALK.minutes)}
              </>
            )}
            {move.STOP.minutes > 0 && <> · стоянки {hm(move.STOP.minutes)}</>}
          </p>
        )}
      </Card>

      {detail.plan && (
        <Card>
          <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-bold text-bk">План: {detail.plan.name}</span>
            <span className="text-xs text-g500">
              {detail.plan.source === "DATE" ? "разове призначення" : "постійний розклад"}
              {detail.plan.totalDistanceKm != null && ` · ${detail.plan.totalDistanceKm} км`}
              {` · ${detail.plan.stops.length} пунктів`}
            </span>
          </div>

          {/* Три цифри, які й відповідають на питання «чи їздив за планом» */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            <span>
              У коридорі:{" "}
              <b
                className={
                  detail.deviation?.onRouteRatio == null
                    ? "text-g500"
                    : detail.deviation.onRouteRatio < 0.6
                      ? "text-red-600"
                      : "text-green-700"
                }
              >
                {detail.deviation?.onRouteRatio == null
                  ? "—"
                  : `${Math.round(detail.deviation.onRouteRatio * 100)}%`}
              </b>
            </span>
            <span>
              Поза маршрутом:{" "}
              <b className={(detail.deviation?.offRouteKm ?? 0) > 0 ? "text-red-600" : "text-green-700"}>
                {detail.deviation?.offRouteKm ?? 0} км
              </b>
            </span>
            <span className="text-g500">
              Коридор: {Math.round(detail.corridorM / 100) / 10} км
            </span>
          </div>

          {detail.deviation && detail.deviation.excursions.length > 0 && (
            <div className="mt-3 rounded-[var(--radius-btn)] border border-red-200 bg-red-50 p-3">
              <p className="mb-1.5 text-[13px] font-bold text-red-900">
                Виїзди за межі маршруту: {detail.deviation.excursions.length}
              </p>
              <div className="space-y-1">
                {detail.deviation.excursions.map((e, i) => (
                  <p key={i} className="text-[13px] text-red-800">
                    {kyivClock(e.from)}—{kyivClock(e.to)} · {e.minutes} хв · {e.km} км · найдалі{" "}
                    {Math.round(e.maxDistanceM / 100) / 10} км від маршруту
                  </p>
                ))}
              </div>
              {/* Дисклеймер обов'язковий: цифри — привід спитати, а не доказ */}
              <p className="mt-2 text-xs leading-relaxed text-red-700">
                Корки й короткі об&apos;їзди сюди не потрапляють: епізод рахується від{" "}
                {EXCURSION_MIN_MINUTES} хв і {EXCURSION_MIN_KM} км поза коридором. Це привід
                уточнити в торгового, а не готовий висновок.
              </p>
            </div>
          )}

          {!detail.planFromGeometry && (
            <p className="mt-2.5 text-xs leading-relaxed text-g400">
              У цього напрямку немає збереженої геометрії доріг, тому план — прямі між
              пунктами, а коридор розширено вдвічі. Відхилення на вигинах траси тут не
              рахуються.
            </p>
          )}
        </Card>
      )}

      {/*
        Зупинки — головна відповідь на «де він був».
        Лінія відповідає на це погано за побудовою: між двома фіксами вона
        мусить щось намалювати, і це завжди здогад. Зупинка здогадів не
        потребує — це місце, з якого людина не виходила, і час у ньому.
      */}
      {detail.track.stops.length > 0 && (
        <Card>
          <p className="mb-2 text-sm font-bold text-bk">
            Зупинки довші за 5 хвилин: {detail.track.stops.length}
          </p>
          <div className="space-y-1.5">
            {detail.track.stops.map((s) => (
              <div key={s.seq} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <span
                  aria-hidden
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#111827] text-[11px] font-bold text-white"
                >
                  {s.seq}
                </span>
                <span className="tabular-nums text-g600">
                  {s.fromTime}–{s.toTime}
                </span>
                <span className="font-semibold tabular-nums text-bk">{s.minutes} хв</span>
                {s.counterpartyName ? (
                  <span className="text-bk">{s.counterpartyName}</span>
                ) : (
                  <span className="text-g400">клієнта поруч немає</span>
                )}
                {s.distanceM != null && (
                  <span className="text-g400">· {Math.round(s.distanceM)} м</span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-g400">
            Клієнта підставлено за близькістю (до 150 м) — це здогад, а не відмітка візиту.
          </p>
        </Card>
      )}

      {detail.visits.length > 0 && (
        <Card>
          <p className="mb-2 text-sm font-bold text-bk">Відмітки</p>
          <div className="space-y-1.5">
            {detail.visits.map((v) => (
              <div key={v.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <span
                  className={`font-bold ${v.status === "DONE" ? "text-green-700" : "text-red-600"}`}
                >
                  {v.status === "DONE" ? "✓" : "×"}
                </span>
                <span className="font-semibold text-bk">{v.counterparty.name}</span>
                {v.collectedAmount != null && v.collectedAmount > 0 && (
                  <span className="text-green-700">{money.format(v.collectedAmount)} грн</span>
                )}
                {v.comment && <span className="text-g500">— {v.comment}</span>}
                <span className="ml-auto text-xs text-g400">{kyivClock(v.markedAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Самоперевірка треку — згорнута, поки не знадобиться. На час
          обкатки застосунку це головна діагностика: чи писав пристрій
          рівно, чи половину дня спав. */}
      <TrackHealthCard userId={detail.user.id} day={day} />

      <div className="space-y-1 text-xs leading-relaxed text-g400">
        {detail.orders && detail.orders.total > 0 && (
          <p>
            <span
              aria-hidden
              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: ORDER_COLOR }}
            />
            Фіолетовим — {detail.orders.total} замовлень цього дня
            {detail.orders.unmapped > 0 &&
              `, з них ${detail.orders.unmapped} без координат клієнта`}
            . Порожнє кільце — документ ще не проведений в 1С; час у підказці — час
            документа, а не візиту.
          </p>
        )}
        {detail.track.hiddenPoints > 0 && (
          <p>
            На карті лише робочі години ({detail.track.workHours}). Ще{" "}
            {detail.track.hiddenPoints} точок цього дня записано поза вікном — вони
            збережені, але не показані.
          </p>
        )}
        <p>
          Пробіг GPS складається з відрізків між фіксами, а розриви добиті дорогою — на
          карті це видно як «По дорогах». Зрізи на поворотах усе одно трохи занижують
          його проти одометра, тож невелике від&apos;ємне відхилення нормальне. Питання
          викликає додатне: кілометри, яких немає в плані.
        </p>
      </div>
    </div>
  );
}
