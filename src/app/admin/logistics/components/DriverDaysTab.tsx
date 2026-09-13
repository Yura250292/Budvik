"use client";

/**
 * «Зміни → Водії»: робочі дні водіїв.
 *
 * Водій зміни не відкриває, тому таблиця змін торгових його не бачила, і
 * виглядало це як «у логістиці є лише торгові». Тут рядок — не зміна, а
 * доба водія: скільки проїхав за треком, скільки за листом, скільки точок
 * закрив і скільки грошей забрав. Клік відкриває цей день на «Русі на карті» —
 * там уже є трек, зупинки, план і звірка з листом, дублювати їх тут нема чого.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import type { DriverDay, DriverDaysResult } from "@/lib/drivers/driver-days";
import { DayNav, Metric } from "./ShiftsTab";

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/**
 * Межі «Збігу» — ті самі, що в змінах торгових (лист чи одометр поділити на
 * трек): нижче — трек намалював більше, ніж проїхала машина; вище — кілометри
 * є, а треку до них немає.
 */
const RATIO_MIN = 0.8;
const RATIO_MAX = 1.3;

function clock(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(new Date(`${day}T12:00:00Z`));
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function liveHref(d: DriverDay): string {
  return `/admin/logistics/live?day=${d.day}&person=${d.driverId}&role=drivers`;
}

function ratioOf(d: DriverDay): number | null {
  const drive = d.track?.km?.driveKm ?? null;
  if (d.factKm == null || drive == null || drive <= 0) return null;
  return Math.round((d.factKm / drive) * 100) / 100;
}

function ratioTone(ratio: number | null): string {
  if (ratio == null) return "text-g400";
  return ratio < RATIO_MIN || ratio > RATIO_MAX ? "text-red-600" : "text-green-700";
}

function ratioHint(ratio: number | null): string {
  if (ratio == null) return "Нема з чим порівняти: немає або кілометрів у листі, або треку";
  if (ratio < RATIO_MIN) return "Трек довший за лист: шумний приймач або лист занижено";
  if (ratio > RATIO_MAX) return "Кілометри в листі є, а треку до них немає: запис уривався";
  return "У межах норми";
}

const th = "px-3 py-2 text-left text-xs font-semibold text-g500";
const thR = "px-3 py-2 text-right text-xs font-semibold text-g500";
const td = "px-3 py-2.5 align-top";
// Без переносу: «0 з 12» чи «не внесено» у вузькій колонці ламалися на два рядки.
const tdR = "whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums";
const sub = "block text-[11px] font-normal text-g400";

type LoadState = { key: string; data?: DriverDaysResult; error?: string };

export function DriverDaysTab({
  period,
  onPeriodChange,
}: {
  period: Period;
  /** Навігатор днів під перемикачем — як у змінах торгових. */
  onPeriodChange?: (p: Period) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<LoadState | null>(null);
  const key = `${period.from}|${period.to}`;

  useEffect(() => {
    let alive = true;
    const requested = `${period.from}|${period.to}`;
    (async () => {
      try {
        const q = new URLSearchParams({ from: period.from, to: period.to });
        const res = await fetch(`/api/admin/logistics/driver-days?${q.toString()}`);
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
        if (alive) setState({ key: requested, data: json as DriverDaysResult });
      } catch (e) {
        if (alive) {
          setState({ key: requested, error: e instanceof Error ? e.message : "Не вдалося завантажити" });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [period.from, period.to]);

  // Відповідь про попередній період не показуємо: поки йде новий запит,
  // таблиця за вчора під заголовком «сьогодні» збрехала б.
  const current = state?.key === key ? state : null;
  const days = useMemo(() => current?.data?.days ?? [], [current]);

  const groups = useMemo(() => {
    const map = new Map<string, DriverDay[]>();
    for (const d of days) map.set(d.day, [...(map.get(d.day) ?? []), d]);
    return [...map.entries()];
  }, [days]);

  const totals = useMemo(() => {
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      driveKm: round(days.reduce((s, d) => s + (d.track?.km?.driveKm ?? 0), 0)),
      factKm: round(days.reduce((s, d) => s + (d.factKm ?? 0), 0)),
      stops: days.reduce((s, d) => s + d.stops, 0),
      done: days.reduce((s, d) => s + d.visits.done, 0),
      missed: days.reduce((s, d) => s + d.visits.missed, 0),
      collected: days.reduce((s, d) => s + d.visits.collected, 0),
      noTrack: days.filter((d) => d.sheets.length > 0 && !d.track).length,
    };
  }, [days]);

  return (
    <div className="space-y-4">
      {onPeriodChange && <DayNav period={period} onChange={onPeriodChange} />}

      {current?.error && <ErrorBox message={current.error} />}

      {!current && <TableSkeleton rows={5} cols={6} />}

      {current?.data && days.length === 0 && (
        <Card>
          <EmptyState
            title="За цей період днів водіїв немає"
            hint="День з'являється, коли на водія є маршрут сайту чи лист 1С або коли він пише трек у робочій збірці застосунку."
          />
        </Card>
      )}

      {current?.data && days.length > 0 && (
        <>
          <div className="flex flex-wrap items-stretch gap-2">
            <Metric label="Днів" value={String(days.length)} />
            <Metric label="За треком" value={`${totals.driveKm} км`} hint="лише їзда" />
            <Metric label="За листами" value={`${totals.factKm} км`} hint="факт, внесений офісом або з 1С" />
            <Metric
              label="Точки"
              value={totals.stops > 0 ? `${totals.done} з ${totals.stops}` : String(totals.done)}
              hint={totals.missed > 0 ? `пропущено ${totals.missed}` : "відмічено водієм"}
              color={totals.missed > 0 ? "#DC2626" : undefined}
            />
            <Metric label="Зібрано" value={`${money.format(totals.collected)} ₴`} hint="інкасація з відміток" />
            {totals.noTrack > 0 && (
              <Metric
                label="Без треку"
                value={String(totals.noTrack)}
                hint="лист є, точок немає"
                color="#D97706"
              />
            )}
          </div>

          {current.data.truncated && (
            <p className="text-xs text-g500">
              Показано останні 31 день періоду — з {current.data.from}: кожен день тягне всі точки треку.
            </p>
          )}

          <TableScroll stickyHeader className="rounded-xl border border-g200 bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-g50">
                  <th className={th}>Водій</th>
                  <th className={th}>Лист</th>
                  <th className={th}>Час</th>
                  <th className={thR} title="Лише їзда в робочі години — та сама арифметика, що в змінах торгових">
                    За треком
                  </th>
                  <th className={thR} title="Факт, внесений офісом у журналі листів, або кілометраж листа 1С">
                    За листом
                  </th>
                  <th className={thR} title="Лист поділити на трек; норма — від 0,8 до 1,3">
                    Збіг
                  </th>
                  <th className={thR}>Точки</th>
                  <th className={thR}>Зібрано</th>
                </tr>
              </thead>
              {groups.map(([day, rows]) => {
                const dayKm = Math.round(rows.reduce((s, d) => s + (d.track?.km?.driveKm ?? 0), 0));
                return (
                  <tbody key={day}>
                    <tr>
                      <td colSpan={8} className="bg-white px-3 pb-1.5 pt-2.5">
                        <span className="text-[13px] font-bold text-bk">{dayLabel(day)}</span>
                        <span className="ml-2 text-xs text-g400">
                          {rows.length} {plural(rows.length, "водій", "водії", "водіїв")}
                          {dayKm > 0 && ` · ${dayKm} км за треком`}
                        </span>
                      </td>
                    </tr>
                    {rows.map((d) => {
                      const ratio = ratioOf(d);
                      const drive = d.track?.km?.driveKm ?? null;
                      return (
                        <tr
                          key={`${d.driverId}|${d.day}`}
                          onClick={() => router.push(liveHref(d))}
                          title="Відкрити цей день на карті руху"
                          className="cursor-pointer border-t border-g100 transition-colors hover:bg-g50"
                        >
                          <td className={td}>
                            <Link
                              href={liveHref(d)}
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-bk hover:underline"
                            >
                              {d.name}
                            </Link>
                          </td>

                          <td className={td}>
                            {d.sheets.length === 0 ? (
                              <span className="text-g400">без листа</span>
                            ) : (
                              d.sheets.map((s) => (
                                <span key={s.id} className="mr-1.5 inline-flex items-center gap-1 whitespace-nowrap">
                                  <span className="text-bk">№ {s.number}</span>
                                  <span
                                    className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
                                      s.source === "SITE" ? "bg-g100 text-g600" : "bg-amber-100 text-amber-800"
                                    }`}
                                  >
                                    {s.source === "SITE" ? "сайт" : "1С"}
                                  </span>
                                </span>
                              ))
                            )}
                          </td>

                          <td className={`${td} whitespace-nowrap`}>
                            {d.track ? (
                              <>
                                {clock(d.track.firstAt)} — {d.track.lastAt ? clock(d.track.lastAt) : "…"}
                              </>
                            ) : (
                              <span className="text-g400">—</span>
                            )}
                          </td>

                          <td className={tdR}>
                            <span className="font-semibold text-bk">{drive != null ? `${drive} км` : "—"}</span>
                            {d.track ? (
                              <span className={sub}>
                                {d.track.pointsCount} {plural(d.track.pointsCount, "точка", "точки", "точок")}
                                {d.track.km && d.track.km.gapKm >= 1 && ` · провал ${d.track.km.gapKm} км`}
                              </span>
                            ) : (
                              <span className={`${sub} ${d.sheets.length ? "!text-amber-700" : ""}`}>треку немає</span>
                            )}
                          </td>

                          <td className={tdR}>
                            {d.factKm != null ? (
                              <>
                                <span className="text-bk">{d.factKm} км</span>
                                <span className={sub}>факт</span>
                              </>
                            ) : d.plannedKm != null ? (
                              <>
                                <span className="text-g600">≈ {d.plannedKm} км</span>
                                <span className={sub}>план OSRM</span>
                              </>
                            ) : (
                              <span className="text-g400">{d.sheets.length ? "не внесено" : "—"}</span>
                            )}
                          </td>

                          <td className={`${tdR} font-semibold ${ratioTone(ratio)}`} title={ratioHint(ratio)}>
                            {ratio != null ? ratio.toFixed(2).replace(".", ",") : "—"}
                          </td>

                          <td className={tdR}>
                            {d.stops > 0 ? `${d.visits.done} з ${d.stops}` : d.visits.done || "—"}
                            {d.visits.missed > 0 && (
                              <span className={`${sub} !text-red-600`}>пропущено {d.visits.missed}</span>
                            )}
                          </td>

                          <td className={tdR}>
                            {d.visits.collected > 0 ? `${money.format(d.visits.collected)} ₴` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          </TableScroll>

          <p className="text-xs text-g400">
            «За треком» — лише їзда в робочі години 6:00–21:00: стоянки й ходьба в пробіг не йдуть, як і в змінах
            торгових. Клік по рядку відкриває день на карті руху.
          </p>
        </>
      )}
    </div>
  );
}
