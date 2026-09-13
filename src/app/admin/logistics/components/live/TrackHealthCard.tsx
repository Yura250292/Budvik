"use client";

/**
 * Картка самоперевірки треку — інструмент на час обкатки застосунку.
 *
 * Карта дня показує лінію, і лінія майже завжди виглядає нормально:
 * дві точки з різних кінців дня з'єднаються прямою, і на око це той
 * самий маршрут. Тут навпаки — цифри, за якими видно, чи пристрій
 * справді писав увесь день, чи половину проспав.
 *
 * Головна цифра — покриття. Саме її варто порівнювати з тим, що давав
 * бот: там точка йшла раз на 3 хвилини, лише в робочі години і лише
 * всередині відкритої поїздки.
 */

import { useCallback, useEffect, useState } from "react";
import { STATUS, type StatusKey } from "@/lib/analytics/colors";
import { Card } from "@/components/ui/Card";

type Health = {
  day: string;
  user: { id: string; name: string; role: string };
  hasTrack: boolean;
  workHours: string;
  hiddenPoints: number;
  summary: {
    pointsCount: number;
    distanceKm: number;
    firstAt: string | null;
    lastAt: string | null;
    spanMinutes: number;
    coverage: number | null;
    gapMinutes: number;
    gapsCount: number;
    avgIntervalSec: number | null;
    accuracyAvgM: number | null;
    goodAccuracyPct: number | null;
    movingPct: number | null;
    maxDeliveryLagMin: number;
    clockSkewSeconds: number | null;
  };
  gaps: Array<{ from: string; to: string; minutes: number }>;
  /** Що застосунок казав про себе. null — пульсу цього дня не було. */
  device: {
    at: string;
    tracking: boolean;
    mode: string | null;
    buffered: number;
    lastFixAt: string | null;
    lastFixAccuracyM: number | null;
    lastError: string | null;
    locationPermission: string | null;
    locationMode: string | null;
    batteryOptimized: boolean | null;
    batteryPct: number | null;
    appVersion: string | null;
    deviceName: string | null;
  } | null;
  heartbeat: {
    count: number;
    firstAt: string | null;
    lastAt: string | null;
    /** Скільки хвилин застосунок мовчав — тобто не працював. */
    silentMinutes: number;
    gaps: Array<{ from: string; to: string; minutes: number }>;
  };
  devices: Array<{
    deviceName: string | null;
    lastUsedAt: string | null;
    revoked: boolean;
    createdAt: string;
  }>;
};

function clock(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function dateTime(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * Оцінка одним словом — щоб не читати всі цифри, коли все добре.
 *
 * Колір беремо не власним hex, а зі спільної палітри статусів: та сама
 * шкала фарбує бейджі й показники в решті адмінки, і «жовтий» тут має
 * означати рівно те саме, що там.
 */
function verdict(s: Health["summary"]): { text: string; status: StatusKey; hint: string } {
  if (s.coverage == null) {
    return { text: "Немає даних", status: "neutral", hint: "точок замало для висновку" };
  }
  if (s.coverage >= 95) {
    return { text: "Трек рівний", status: "good", hint: "пристрій писав без відчутних пауз" };
  }
  if (s.coverage >= 80) {
    return {
      text: "Є паузи",
      status: "warn",
      hint: "невеликі дірки — імовірно, зв'язок або тунелі",
    };
  }
  return {
    text: "Трек рваний",
    status: "bad",
    hint: "перевірте економію батареї й дозвіл «Завжди»",
  };
}

export function TrackHealthCard({ userId, day }: { userId: string; day: string }) {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/track/${userId}/health?day=${day}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити");
    }
  }, [userId, day]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1 text-xs font-medium text-g600 transition-colors hover:bg-g50 hover:text-bk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark"
      >
        Перевірити якість треку
      </button>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-4">
        <p className="text-[13px] text-red-800">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <p className="text-[13px] text-g500">Рахую…</p>
      </Card>
    );
  }

  const s = data.summary;
  const v = verdict(s);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-bk">Якість треку: {data.user.name}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="cursor-pointer text-xs text-g500 transition-colors hover:text-bk"
        >
          Згорнути
        </button>
      </div>

      {!data.hasTrack ? (
        <div>
          <p className="mb-2 text-sm font-semibold text-red-600">Цього дня точок немає</p>
          {data.devices.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-g500">
              У цієї людини немає жодного пристрою — застосунок ще не встановлений
              або вхід не виконано.
            </p>
          ) : (
            <div className="text-[13px] leading-relaxed text-g600">
              <p className="mb-1.5">Пристрої є, отже вхід виконувався:</p>
              {data.devices.map((d, i) => (
                <p key={i} className={d.revoked ? "text-g400" : "text-g600"}>
                  • {d.deviceName ?? "без назви"}
                  {d.revoked && " (відкликаний)"}
                  {d.lastUsedAt
                    ? ` — востаннє озивався ${dateTime(d.lastUsedAt)}`
                    : " — жодного разу не слав точок"}
                </p>
              ))}
              <p className="mt-2 text-g500">
                Якщо пристрій давно мовчить — найімовірніша причина в економії
                батареї або дозволі «Дозволяти завжди».
              </p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3 rounded-[var(--radius-btn)] bg-g50 p-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span
                className="text-[17px] font-bold"
                style={{ color: STATUS[v.status].fg }}
              >
                {v.text}
              </span>
              {s.coverage != null && (
                <span className="text-[15px] font-semibold text-bk">
                  покриття {s.coverage}%
                </span>
              )}
              <span className="text-xs text-g500">{v.hint}</span>
            </div>
          </div>

          <div className="grid gap-x-6 gap-y-2 text-[13px] [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
            <Row label="Точок за день" value={String(s.pointsCount)} />
            <Row
              label="Проміжок між точками"
              value={s.avgIntervalSec != null ? `${s.avgIntervalSec} с` : "—"}
              // Очікуємо ~60 с. Помітно більше — пристрій засинав.
              warn={s.avgIntervalSec != null && s.avgIntervalSec > 150}
            />
            <Row
              label="Писав з — до"
              value={
                s.firstAt && s.lastAt
                  ? `${clock(s.firstAt)}—${clock(s.lastAt)} (${Math.floor(s.spanMinutes / 60)} год ${s.spanMinutes % 60} хв)`
                  : "—"
              }
            />
            <Row
              label="Мовчав сумарно"
              value={s.gapMinutes > 0 ? `${s.gapMinutes} хв у ${s.gapsCount} паузах` : "не мовчав"}
              warn={s.gapMinutes > 30}
            />
            <Row
              label="Точність GPS"
              value={
                s.accuracyAvgM != null
                  ? `${s.accuracyAvgM} м у середньому, ${s.goodAccuracyPct}% придатних`
                  : "—"
              }
              warn={s.goodAccuracyPct != null && s.goodAccuracyPct < 80}
            />
            <Row label="У русі" value={s.movingPct != null ? `${s.movingPct}% точок` : "—"} />
            <Row
              label="Найдовша затримка"
              value={s.maxDeliveryLagMin > 0 ? `${s.maxDeliveryLagMin} хв у буфері` : "надсилав одразу"}
            />
            <Row
              label="Годинник пристрою"
              value={
                s.clockSkewSeconds == null
                  ? "—"
                  : s.clockSkewSeconds < -60
                    ? `поспішає на ${Math.abs(s.clockSkewSeconds)} с`
                    : "у нормі"
              }
              warn={s.clockSkewSeconds != null && s.clockSkewSeconds < -60}
            />
          </div>

          {data.gaps.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[13px] font-semibold text-bk">Найдовші паузи</p>
              <div className="space-y-1">
                {data.gaps.map((g, i) => (
                  <p key={i} className="text-[13px] text-g600">
                    {clock(g.from)} — {clock(g.to)}{" "}
                    <span className={g.minutes >= 30 ? "text-red-600" : "text-g500"}>
                      ({g.minutes} хв)
                    </span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Пульс застосунку. Головне тут — те, чого немає: мовчання
              пульсу означає, що служби не було, і саме воно пояснює
              дірки в треку. Без цього блоку «немає точок» лишалось
              питанням без відповіді. */}
          <div className="mt-3 rounded-[var(--radius-btn)] border border-g200 bg-g50 p-3">
            <p className="mb-1.5 text-[13px] font-semibold text-bk">Що казав застосунок</p>
            {data.heartbeat.count === 0 ? (
              <p className="text-[13px] leading-relaxed text-g500">
                Пульсу цього дня не було. Або на планшеті стара збірка
                застосунку (пульс з&apos;явився у версії 1.3), або він не
                запускався взагалі.
              </p>
            ) : (
              <div className="text-[13px] leading-relaxed text-g600">
                <p>
                  Озвався {data.heartbeat.count} раз
                  {data.heartbeat.firstAt && data.heartbeat.lastAt
                    ? ` (з ${clock(data.heartbeat.firstAt)} до ${clock(data.heartbeat.lastAt)})`
                    : ""}
                  {data.heartbeat.silentMinutes > 0 && (
                    <b className="text-red-600"> · мовчав {data.heartbeat.silentMinutes} хв</b>
                  )}
                </p>
                {data.device && (
                  <p className="text-g500">
                    {data.device.deviceName ?? "планшет"}
                    {data.device.appVersion && ` · v${data.device.appVersion}`}
                    {` · запис ${data.device.tracking ? "увімкнено" : "ВИМКНЕНО"}`}
                    {data.device.locationPermission &&
                      ` · дозвіл ${
                        data.device.locationPermission === "ALWAYS"
                          ? "«Завжди»"
                          : data.device.locationPermission === "WHILE_USING"
                            ? "лише «поки відкрито»"
                            : "не виданий"
                      }`}
                    {data.device.batteryOptimized === true && " · економія батареї УВІМКНЕНА"}
                    {data.device.batteryPct != null && ` · заряд ${data.device.batteryPct}%`}
                    {data.device.buffered > 0 && ` · у буфері ${data.device.buffered} точок`}
                  </p>
                )}
                {data.device?.lastError && (
                  <p className="text-red-700">Помилка: {data.device.lastError}</p>
                )}
                {data.heartbeat.gaps.length > 0 && (
                  <p className="text-g500">
                    Застосунок не працював:{" "}
                    {data.heartbeat.gaps
                      .map((g) => `${clock(g.from)}—${clock(g.to)} (${g.minutes} хв)`)
                      .join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-g400">
            Рахуємо лише робочі години ({data.workHours}).
            {data.hiddenPoints > 0 &&
              ` Ще ${data.hiddenPoints} точок записано поза цим вікном — вони збережені, але в статистику й на карту не йдуть.`}{" "}
            Пауза рахується від 5 хвилин без жодної точки. Короткі паузи нормальні
            (тунель, підземний паркінг), а от години — це майже завжди економія
            батареї або дозвіл «Завжди», якого не дали.
          </p>
        </>
      )}
    </Card>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-g500">{label}</span>
      <span className={`text-right font-semibold ${warn ? "text-red-600" : "text-bk"}`}>
        {value}
      </span>
    </div>
  );
}
