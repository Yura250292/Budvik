"use client";

/**
 * Пульт треку: чому не пишеться, просто зараз.
 *
 * Екран існує через те, що місяць розборів робився не тут, а в терміналі:
 * поламку бачили ввечері з бази, коли день уже проїхано. Сигнал у Telegram
 * при цьому працював — 08.09 він спрацював двічі до дев'ятої ранку, — але
 * сказати «трек мовчить» замало. Питання, на яке ніхто не міг відповісти без
 * розбору: ЧОМУ мовчить і що з цим зробити.
 *
 * Тому кожна картка починається не з даних, а з висновку й дії, а числа
 * лежать під ними — для того, хто не повірив. Найважливіші три:
 *
 *   «життя застосунку»  — коли піднявся процес;
 *   «викликів служби»   — скільки разів система віддала йому координати;
 *   «точок»             — скільки з них дійшло до буфера.
 *
 * Нуль викликів при живому процесі й піднятій службі — це та сама поламка,
 * яку не показував жоден інший екран: усе справне, а координат немає.
 *
 * Оновлюється саме, раз на 20 секунд. Ручна кнопка теж є: коли людині щойно
 * сказали відкрити застосунок, чекати двадцять секунд незручно.
 */

import { useCallback, useEffect, useState } from "react";

const REFRESH_MS = 20_000;

type Beat = {
  at: string;
  minutesAgo: number;
  appVersion: string | null;
  osVersion: string | null;
  device: string | null;
  tracking: boolean;
  subscribed: boolean | null;
  mode: string | null;
  buffered: number;
  lastFixAt: string | null;
  lastFixMinutesAgo: number | null;
  lastFixAccuracyM: number | null;
  lastSyncAt: string | null;
  lastError: string | null;
  locationPermission: string | null;
  locationMode: string | null;
  batteryOptimized: boolean | null;
  batteryPct: number | null;
  watchdogAt: string | null;
  watchdogStatus: string | null;
  contextStartedAt: string | null;
  contextMinutes: number | null;
  fixBatches: number | null;
  contextPoints: number | null;
};

type Tablet = {
  userId: string;
  name: string;
  role: string;
  shift: { id: string; startedAt: string; minutes: number } | null;
  points: { today: number; lastAt: string | null; lastMinutesAgo: number | null };
  beat: Beat | null;
  events: { at: string; kind: string; note: string | null }[];
  state: "OK" | "WARN" | "DEAD" | "IDLE";
  verdict: string;
  action: string | null;
};

type Board = { day: string; now: string; tablets: Tablet[] };

const hm = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleTimeString("uk-UA", {
        timeZone: "Europe/Kyiv",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/** Людською мовою: журнал читає не той, хто його писав. */
const KIND: Record<string, string> = {
  boot: "застосунок піднявся",
  start_ok: "службу запущено",
  start_failed: "служба НЕ запустилась",
  start_denied: "немає дозволу",
  stop: "службу зупинено",
  restart_refused: "перезапуск відхилено",
  task_error: "помилка завдання",
  push: "реєстрація сповіщень",
};

const TONE: Record<Tablet["state"], { dot: string; card: string; label: string }> = {
  DEAD: { dot: "bg-red-500", card: "border-red-200 bg-red-50/60", label: "Не пише" },
  WARN: { dot: "bg-amber-500", card: "border-amber-200 bg-amber-50/60", label: "Увага" },
  OK: { dot: "bg-emerald-500", card: "border-emerald-200 bg-white", label: "Пише" },
  IDLE: { dot: "bg-g300", card: "border-g200 bg-white", label: "Не на зміні" },
};

export default function TrackHealthBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/track/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`Сервер відповів ${res.status}`);
      setBoard(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося оновити");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!board && !error) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-g300 border-t-bk motion-reduce:animate-none" />
      </div>
    );
  }

  const dead = board?.tablets.filter((t) => t.state === "DEAD") ?? [];
  const onShift = board?.tablets.filter((t) => t.shift) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-bk">Чому не пишеться</h1>
          <p className="mt-1 text-sm text-g600">
            {onShift.length
              ? `На зміні ${onShift.length} · не пишуть ${dead.length}`
              : "Зараз ніхто не на зміні"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-g500">
          <span>станом на {hm(board?.now)}</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-3 py-1.5 font-medium text-g600 transition-colors hover:border-g300 hover:text-bk disabled:opacity-50"
          >
            {busy ? "Питаю…" : "Оновити"}
          </button>
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded-[var(--radius-card)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {board?.tablets.map((t) => {
          const tone = TONE[t.state];
          const b = t.beat;
          const isOpen = open === t.userId;

          return (
            <article
              key={t.userId}
              className={`rounded-[var(--radius-card)] border px-4 py-3.5 ${tone.card}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="flex items-center gap-2.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
                  <span className="font-semibold text-bk">{t.name}</span>
                  {t.shift && (
                    <span className="text-xs text-g500">
                      зміна з {hm(t.shift.startedAt)} · {t.shift.minutes} хв
                    </span>
                  )}
                </div>
                <span className="text-xs font-medium text-g500">{tone.label}</span>
              </div>

              <p className="mt-2 text-sm text-bk">{t.verdict}</p>
              {t.action && (
                <p className="mt-1 text-sm font-medium text-g700">→ {t.action}</p>
              )}

              {b && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-g600 sm:grid-cols-3">
                  <Fact
                    label="Життя застосунку"
                    value={
                      b.contextStartedAt
                        ? `з ${hm(b.contextStartedAt)}${b.contextMinutes != null ? ` (${b.contextMinutes} хв)` : ""}`
                        : "—"
                    }
                  />
                  <Fact
                    label="Викликів служби"
                    value={b.fixBatches != null ? String(b.fixBatches) : "?"}
                    alarm={b.fixBatches === 0 && b.tracking}
                  />
                  <Fact label="Точок за день" value={String(t.points.today)} />
                  <Fact label="Остання точка" value={hm(t.points.lastAt)} />
                  <Fact
                    label="Приймач"
                    value={
                      b.lastFixAt
                        ? `${hm(b.lastFixAt)}${b.lastFixAccuracyM != null ? ` ±${b.lastFixAccuracyM} м` : ""}`
                        : "—"
                    }
                  />
                  <Fact label="Чекає в планшеті" value={String(b.buffered)} alarm={b.buffered > 200} />
                  <Fact label="Дозвіл" value={b.locationPermission ?? "—"} alarm={b.locationPermission !== "ALWAYS"} />
                  <Fact label="GPS" value={b.locationMode ?? "—"} alarm={b.locationMode === "OFF"} />
                  <Fact
                    label="Батарея"
                    value={`${b.batteryPct ?? "?"}%${b.batteryOptimized ? " · обмежує" : ""}`}
                    alarm={!!b.batteryOptimized}
                  />
                  <Fact label="Пульс" value={`${hm(b.at)} (${b.minutesAgo} хв)`} alarm={b.minutesAgo > 35} />
                  <Fact label="Збірка" value={b.appVersion ?? "—"} />
                  <Fact label="Планшет" value={b.osVersion ?? "—"} />
                </dl>
              )}

              {b?.lastError && (
                <p className="mt-2 text-xs text-g500">Скарга пристрою: {b.lastError}</p>
              )}

              {t.events.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : t.userId)}
                    className="mt-2.5 cursor-pointer text-xs font-medium text-g600 underline underline-offset-2 hover:text-bk"
                  >
                    {isOpen ? "Сховати журнал" : `Журнал пристрою (${t.events.length})`}
                  </button>
                  {isOpen && (
                    <ol className="mt-2 space-y-0.5 border-t border-g200 pt-2 text-xs text-g600">
                      {[...t.events].reverse().map((e, i) => (
                        <li key={`${e.at}-${i}`} className="flex gap-3">
                          <span className="w-10 shrink-0 tabular-nums text-g500">{hm(e.at)}</span>
                          <span className="w-44 shrink-0">{KIND[e.kind] ?? e.kind}</span>
                          <span className="text-g500">{e.note}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-g500">
        «Викликів служби 0» при піднятій службі означає, що система не віддає застосунку координати —
        застосунок при цьому справний, і жоден інший екран цього не покаже. Лікується відкриттям
        застосунку: із переднього плану Android дозволяє підняти запис завжди.
      </p>
    </div>
  );
}

function Fact({ label, value, alarm }: { label: string; value: string; alarm?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-g400">{label}</dt>
      <dd className={alarm ? "font-semibold text-red-600" : "text-bk"}>{value}</dd>
    </div>
  );
}
