"use client";

/**
 * Пошук клієнта в базі одним рядком: «Коваль Жовтанці».
 *
 * Логіст тримає маршрут у голові прізвищем і селом, а не номерами накладних.
 * Тому пошук приймає слова в довільному порядку й шукає кожне і в назві, і в
 * адресі — /api/erp/counterparties/search.
 *
 * Кожен рядок одразу показує стан піна. Це не прикраса: половина карток у
 * базі має координату від геокодера (часто лише на центр села) або не має
 * ніякої, і саме тут це видно ДО того, як точка поїде водієві. Кнопка
 * «на карті» відкриває той самий StopPinModal, що й у списку точок.
 */

import { useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/utils";

export type FoundClient = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  type: "SUPPLIER" | "CUSTOMER" | "BOTH";
  isActive: boolean;
  address: string | null;
  settlement: string | null;
  lat: number | null;
  lng: number | null;
  geoSource: "GEOCODED" | "MANUAL" | "CITY" | "FAILED" | null;
  deliveryZone: "CITY" | "OBLAST" | null;
  debt: number;
  lastShipmentAt: string | null;
};

/**
 * Стан піна клієнта людською мовою.
 *
 * GeoSource=CITY гірший за відсутність піна: виглядає точним, а каже лише
 * «десь у цьому селі», тому має власний текст, а не спільний «приблизний».
 */
export function pinState(c: { lat: number | null; geoSource: string | null }): {
  exact: boolean;
  label: string;
  tone: "good" | "warn" | "bad";
} {
  if (c.lat == null) return { exact: false, label: "Немає точки", tone: "bad" };
  if (c.geoSource === "MANUAL")
    return { exact: true, label: "Точка уточнена", tone: "good" };
  if (c.geoSource === "CITY")
    return { exact: false, label: "Пін лише на село", tone: "warn" };
  return { exact: false, label: "Пін приблизний", tone: "warn" };
}

/**
 * Пін, з яким їхати не можна взагалі: його немає або він стоїть на центр
 * села. Саме на таких карта відкривається сама.
 *
 * Просто «не MANUAL» для цього не годиться: ручних пінів у базі 86 із 3705,
 * тож на кожному другому додаванні логіст ловив би модалку й закривав її не
 * дивлячись — а це рівно те, чого не можна допустити з попередженням.
 */
export function pinUnusable(c: { lat: number | null; geoSource: string | null }): boolean {
  return c.lat == null || c.geoSource === "CITY" || c.geoSource === "FAILED";
}

const TONE: Record<"good" | "warn" | "bad", { bg: string; fg: string; br: string }> = {
  good: { bg: "#F0FDF4", fg: "#166534", br: "#BBF7D0" },
  warn: { bg: "#FFFBEB", fg: "#92400E", br: "#FCD34D" },
  bad: { bg: "#FEF2F2", fg: "#B91C1C", br: "#FECACA" },
};

/** Скільки чекаємо після останньої натиснутої клавіші перед запитом. */
const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

export default function ClientSearch({
  onPick,
  pickedIds,
  onFixPin,
  busyId,
  autoFocus,
  actionLabel = "Додати",
  placeholder = "Прізвище і село: Коваль Жовтанці",
}: {
  onPick: (client: FoundClient) => void;
  /** Хто вже в маршруті — таких показуємо, але додати вдруге не даємо. */
  pickedIds?: readonly string[];
  /** Відкрити карту й поставити пін руками, не виходячи з пошуку. */
  onFixPin?: (client: FoundClient) => void;
  /** id клієнта, якого зараз додаємо — рядок блимає й не приймає повторний клік. */
  busyId?: string | null;
  autoFocus?: boolean;
  actionLabel?: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<FoundClient[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setItems(null);
      setError(null);
      setSearching(false);
      return;
    }

    // Кожен новий символ скасовує попередній запит: інакше відповідь на
    // «Ков» могла прийти після відповіді на «Коваль» і перетерти її.
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/erp/counterparties/search?q=${encodeURIComponent(q)}&limit=15`,
          { signal: ctrl.signal }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Не вдалося знайти");
          return;
        }
        setItems(data.items ?? []);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setError("Немає зв'язку — спробуйте ще раз");
      } finally {
        // Перерваний запит уже не наш: спінер зніме той, що його змінив.
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const picked = new Set(pickedIds ?? []);

  return (
    <div>
      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-[8px] border border-g200 bg-white px-3 py-2 pr-20 text-[14px] text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
        />
        {(searching || query) && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-g400">
            {searching ? "шукаю…" : items ? `${items.length}` : ""}
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-[13px] text-[#B91C1C]">{error}</p>}

      {query.trim().length >= MIN_CHARS && items?.length === 0 && !searching && (
        <p className="mt-2 text-[13px] text-g400">
          Нікого не знайшли. Спробуйте лише прізвище або лише село — у базі
          адреси з 1С написані по-різному.
        </p>
      )}

      {!!items?.length && (
        <div className="mt-2 max-h-72 overflow-auto rounded-[8px] border border-g200 bg-white">
          {items.map((c) => {
            const pin = pinState(c);
            const already = picked.has(c.id);
            const busy = busyId === c.id;
            return (
              <div
                key={c.id}
                className="flex items-start gap-3 border-b border-g100 px-3 py-2.5 last:border-b-0"
                style={{ opacity: busy ? 0.5 : 1 }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-bk">
                    {c.name}
                    {!c.isActive && (
                      <span className="ml-2 text-[11px] font-medium text-g400">
                        неактивний у 1С
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-g500">
                    {c.address || "адреси в картці немає"}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {/* Пін — головне, що тут вирішується: без нього точка
                        поїде «в район», і водій шукатиме її сам. */}
                    <button
                      type="button"
                      onClick={() => onFixPin?.(c)}
                      disabled={!onFixPin}
                      title={onFixPin ? "Поставити або підправити точку на карті" : undefined}
                      className="rounded-[5px] px-2 py-0.5 text-[11px] font-semibold disabled:cursor-default"
                      style={{
                        background: TONE[pin.tone].bg,
                        color: TONE[pin.tone].fg,
                        border: `1px solid ${TONE[pin.tone].br}`,
                      }}
                    >
                      📍 {pin.label}
                    </button>
                    {c.debt > 0 && (
                      <span className="text-[11px] text-g500">
                        борг {formatPrice(c.debt)}
                      </span>
                    )}
                    {c.lastShipmentAt ? (
                      <span className="text-[11px] text-g400">
                        остання поставка{" "}
                        {new Date(c.lastShipmentAt).toLocaleDateString("uk-UA")}
                      </span>
                    ) : (
                      <span className="text-[11px] text-g400">поставок не було</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onPick(c)}
                  disabled={already || busy}
                  className="flex-shrink-0 rounded-[6px] border border-g200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-bk hover:bg-g50 disabled:opacity-45"
                >
                  {already ? "у маршруті" : busy ? "…" : actionLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
