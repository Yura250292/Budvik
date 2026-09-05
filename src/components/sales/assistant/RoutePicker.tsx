"use client";

/**
 * Список точок маршруту, з якого можна викидати зайвих — і одразу їхати.
 *
 * Помічник пропонує дев'ять точок, а торговий знає, що до двох сьогодні
 * немає сенсу: один зачинений, другому він дзвонив учора. Досі це
 * означало написати нове питання й чекати нову відповідь; тепер — один
 * дотик по рядку.
 *
 * Стан живе ЛИШЕ тут, у пам'яті екрана. Зберігати вибір на сервері немає
 * за чим: маршрут складають на найближчу годину, а не на завтра, і
 * повернення до вчорашнього вибору нікому не потрібне. Зате перерахунок
 * посилань миттєвий — жодного запиту.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, MapPin, Navigation } from "lucide-react";
import {
  MAX_POINTS_PER_LINK,
  batchNavigateUrl,
  googleMapsLinksFromHere,
} from "@/lib/maps/google-links";

type Stop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  note?: string;
};

type Payload = { title?: string; stops: Stop[] };

export default function RoutePicker({ json }: { json: string }) {
  const payload = useMemo<Payload | null>(() => {
    try {
      const parsed = JSON.parse(json) as Payload;
      return Array.isArray(parsed?.stops) ? parsed : null;
    } catch {
      return null;
    }
  }, [json]);

  const [dropped, setDropped] = useState<Set<string>>(new Set());

  const chosen = useMemo(
    () => (payload?.stops ?? []).filter((s) => !dropped.has(s.id)),
    [payload, dropped]
  );

  const links = useMemo(() => googleMapsLinksFromHere(chosen), [chosen]);
  const waze = useMemo(() => batchNavigateUrl(chosen.slice(0, 1), "waze"), [chosen]);

  if (!payload) return null;

  const toggle = (id: string) =>
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-cab-line">
      <div className="flex items-center justify-between bg-cab-bg px-3 py-2">
        <span className="text-[12px] font-semibold text-cab-t2">
          {payload.title ?? "Маршрут"}
        </span>
        <span className="text-[12px] font-semibold text-bk">
          {chosen.length} з {payload.stops.length}
        </span>
      </div>

      <ul className="flex flex-col">
        {payload.stops.map((stop, i) => {
          const off = dropped.has(stop.id);
          return (
            <li key={stop.id} className="flex items-stretch border-t border-cab-line first:border-t-0">
              <button
                type="button"
                onClick={() => toggle(stop.id)}
                aria-pressed={!off}
                className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left"
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    off ? "bg-cab-bg text-cab-t3 line-through" : "bg-bk text-white"
                  }`}
                >
                  {off ? "×" : chosen.findIndex((c) => c.id === stop.id) + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[14px] font-semibold ${
                      off ? "text-cab-t3 line-through" : "text-bk"
                    }`}
                  >
                    {stop.name}
                  </span>
                  {stop.note && (
                    <span className="mt-0.5 block text-[12px] leading-snug text-cab-t2">
                      {stop.note}
                    </span>
                  )}
                </span>
              </button>
              <Link
                href={`/sales/clients/${stop.id}`}
                aria-label="Відкрити картку клієнта"
                className="flex items-center px-3 text-cab-t3"
              >
                <ChevronRight size={16} />
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2 border-t border-cab-line bg-cab-bg px-3 py-2.5">
        {chosen.length === 0 ? (
          <span className="text-[12px] text-cab-t3">Усі точки прибрані — натисніть на рядок, щоб повернути.</span>
        ) : (
          <>
            {links.map((l, i) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-bk px-3 py-1.5 text-[12px] font-semibold text-white"
              >
                <MapPin size={13} />
                {links.length > 1 ? `Google, частина ${i + 1}` : "Google Maps"}
              </a>
            ))}
            {waze && (
              <a
                href={waze}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-cab-line bg-white px-3 py-1.5 text-[12px] font-semibold text-bk"
              >
                <Navigation size={13} />
                Waze
              </a>
            )}
          </>
        )}
      </div>

      {links.length > 1 && (
        <p className="px-3 pb-2.5 text-[11px] text-cab-t3">
          Google веде щонайбільше {MAX_POINTS_PER_LINK} точок за раз — далі відкривайте наступну частину.
        </p>
      )}
    </div>
  );
}
