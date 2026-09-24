"use client";

/**
 * «Точки з треку»: клієнти, чию точку можна поставити за стоянками
 * торгового, — одним тапом після погляду на карту.
 *
 * Звідки черга — див. lib/routes/pin-queue.ts. Коротко: частина точок, які
 * торгові ставили біля магазинів, не зберіглась (екран уточнення показував
 * галочку до запису), і лишився тільки трек. Ставить точку людина, а не
 * автомат: навіть «100% з одного замовлення» — це одна стоянка, і сусідній
 * магазин поруч виглядає так само.
 *
 * Пропущені живуть лише до перезавантаження сторінки: окремої таблиці для
 * «переглянуто» немає, а наступного разу в клієнта можуть бути нові голоси.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { QueueMark } from "@/components/map/PinQueueMap";
import type { PinQueue, PinQueueItem } from "@/lib/routes/pin-queue";
import { queueOrder } from "@/lib/routes/pin-queue-order";

const PinQueueMap = dynamic(() => import("@/components/map/PinQueueMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-[clamp(280px,48vh,440px)] w-full" />,
});

const REASON: Record<PinQueueItem["reason"], { label: string; status: "warn" | "bad" | "neutral" }> = {
  CITY: { label: "приблизна", status: "neutral" },
  ELSEWHERE: { label: "посунута здалеку", status: "warn" },
  AT_BASE: { label: "поставлена з дому", status: "bad" },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const shortDay = (d: string) => d.slice(8, 10) + "." + d.slice(5, 7);
const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} км` : `${m} м`);

export function PinQueueTab() {
  const [items, setItems] = useState<PinQueueItem[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; empty: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [placed, setPlaced] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Черга рахується порціями до дедлайну роуту — догружаємо по колу.
  // Прапорець — свій у кожного запуску: React у розробці монтує ефект двічі,
  // і зі спільним ref обидва цикли жили б далі й дублювали рядки.
  useEffect(() => {
    const alive = { current: true };
    setItems([]);
    setProgress(null);
    setError(null);
    setLoading(true);
    (async () => {
      let offset: number | null = 0;
      let empty = 0;
      while (offset !== null && alive.current) {
        const res = await fetch(`/api/admin/client-map/pin-queue?offset=${offset}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as (PinQueue & { error?: string }) | null;
        if (!res.ok || !json) throw new Error(json?.error ?? `Помилка ${res.status}`);
        if (!alive.current) return;
        empty += json.empty;
        const next: number | null = json.nextOffset;
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.counterpartyId));
          return [...prev, ...json.items.filter((i) => !seen.has(i.counterpartyId))].sort(queueOrder);
        });
        setProgress({ done: next ?? json.total, total: json.total, empty });
        offset = next;
      }
    })()
      .catch((e) => alive.current && setError(e instanceof Error ? e.message : "Не вдалося завантажити чергу"))
      .finally(() => alive.current && setLoading(false));
    return () => {
      alive.current = false;
    };
  }, [reloadKey]);

  const selected = useMemo(
    () => items.find((i) => i.counterpartyId === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  );

  const marks: QueueMark[] = useMemo(
    () =>
      selected?.result.candidates.map((c) => ({
        label: c.label,
        lat: c.lat,
        lng: c.lng,
        title: `${c.label}: ${pct(c.share)} замовлень набито тут · ${c.repName}`,
      })) ?? [],
    [selected]
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setActiveLabel("A");
    setActionError(null);
  }, []);

  const drop = (id: string) => {
    setItems((prev) => prev.filter((i) => i.counterpartyId !== id));
    setSelectedId(null);
    setActiveLabel("A");
  };

  /** Людина обрала місце з треку — це її рішення, тож точка ручна, з автором. */
  const place = async (item: PinQueueItem, label: string) => {
    const c = item.result.candidates.find((x) => x.label === label);
    if (!c) return;
    setPlacing(`${item.counterpartyId}:${label}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/client-map/${item.counterpartyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: c.lat, lng: c.lng }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setPlaced((n) => n + 1);
      drop(item.counterpartyId);
    } catch (e) {
      setActionError(e instanceof Error ? `Точку не збережено: ${e.message}` : "Точку не збережено");
    } finally {
      setPlacing(null);
    }
  };

  if (error) return <ErrorBox message={error} onRetry={() => setReloadKey((k) => k + 1)} />;

  const confident = items.filter((i) => i.result.confident).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Точки з треку"
          hint="Де стояв торговий, коли набивав замовлення цього клієнта. Точку ставите ви — перевірте на карті й натисніть «Поставити»."
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-g600">
          {progress ? (
            <>
              <span>
                перевірено <b className="tabular-nums text-bk">{progress.done}</b> з{" "}
                <span className="tabular-nums">{progress.total}</span>
              </span>
              <span>
                у черзі <b className="tabular-nums text-bk">{items.length}</b>
                {confident > 0 && <span className="text-emerald-700"> · упевнених {confident}</span>}
              </span>
              <span>трек мовчить: <span className="tabular-nums">{progress.empty}</span></span>
            </>
          ) : (
            <span>рахую за треком…</span>
          )}
          {placed > 0 && <span className="text-emerald-700">поставлено за сесію: {placed}</span>}
          {loading && <span className="text-g500">догружаю…</span>}
        </div>
      </Card>

      {actionError && <ErrorBox message={actionError} />}

      {!loading && items.length === 0 ? (
        <Card>
          <EmptyState
            title="Черга порожня"
            hint="Для приблизних точок трек не дав жодного місця — або їх уже поставили."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <div className="order-2 space-y-2 lg:order-1">
            {items.length === 0 && loading && <Skeleton className="h-24 w-full" />}
            {items.map((item) => {
              const isSel = selected?.counterpartyId === item.counterpartyId;
              const a = item.result.candidates[0];
              const r = REASON[item.reason];
              return (
                <div
                  key={item.counterpartyId}
                  className={`rounded-[var(--radius-card)] border bg-white p-3 transition-colors ${
                    isSel ? "border-violet-400 ring-1 ring-violet-200" : "border-g200 hover:border-g300"
                  }`}
                >
                  <button type="button" onClick={() => select(item.counterpartyId)} className="block w-full text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-bk">{item.name}</span>
                      <Badge status={r.status}>{r.label}</Badge>
                      {item.result.confident && <Badge status="good">упевнено</Badge>}
                    </div>
                    {item.address && <p className="mt-0.5 truncate text-xs text-g500">{item.address}</p>}
                    <p className="mt-1.5 text-xs text-g600">
                      <b className="text-violet-700">A</b> — {pct(a.share)} з {item.result.votedDocs}{" "}
                      {item.result.votedDocs === 1 ? "замовлення" : "замовлень"} · {a.repName} · днів {a.days}, останній{" "}
                      {shortDay(a.lastDay)} · стояв {a.minutesMin === a.minutesMax ? a.minutesMin : `${a.minutesMin}–${a.minutesMax}`} хв ·{" "}
                      {dist(a.distanceM)} від нинішньої
                    </p>
                  </button>

                  {isSel && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-g100 pt-3">
                      {item.result.candidates.map((c) => (
                        <button
                          key={c.label}
                          type="button"
                          disabled={!!placing}
                          onMouseEnter={() => setActiveLabel(c.label)}
                          onFocus={() => setActiveLabel(c.label)}
                          onClick={() => place(item, c.label)}
                          className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                            c.label === "A"
                              ? "border-violet-600 bg-violet-600 text-white hover:bg-violet-700"
                              : "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100"
                          }`}
                        >
                          {placing === `${item.counterpartyId}:${c.label}` ? "Ставлю…" : `Поставити ${c.label}`}{" "}
                          <span className="font-normal opacity-80">{pct(c.share)}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={!!placing}
                        onClick={() => drop(item.counterpartyId)}
                        className="rounded-md border border-g200 px-3 py-1.5 text-xs font-medium text-g600 hover:bg-g50 disabled:opacity-50"
                      >
                        Пропустити
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="order-1 lg:sticky lg:top-4 lg:order-2 lg:self-start">
            {selected && (
              <>
                <PinQueueMap
                  current={selected.result.current}
                  marks={marks}
                  active={activeLabel}
                  onPick={(label) => setActiveLabel(label)}
                />
                <p className="mt-2 text-xs text-g500">
                  <b className="text-bk">{selected.name}</b>: сіре кільце — нинішня точка, фіолетові — де стояв
                  торговий. Наведіть на кнопку, щоб підсвітити місце.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
