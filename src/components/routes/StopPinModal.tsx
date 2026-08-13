"use client";

/**
 * Уточнення точки клієнта прямо з картки маршруту.
 *
 * Сценарій менеджера: перевіряє маршрутний лист, бачить точку без чіткої
 * адреси — знаходить її пошуком або пальцем по карті, підтверджує. Координата
 * лягає в КАРТКУ КЛІЄНТА (geoSource=MANUAL), тому виправлення діє на всі
 * майбутні маршрути, а не лише на цей — саме тому тут той самий
 * PATCH /api/admin/client-map/[id], що й у кабінеті торгового й водія.
 *
 * Пошук ходить у ?all=1 і показує список кандидатів: Nominatim на адресах
 * без номера будинку часто дає кілька схожих сіл, і вибір має робити людина,
 * а не «перший у видачі».
 */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const PinPicker = dynamic(() => import("@/components/map/PinPicker"), {
  ssr: false,
  loading: () => (
    <div
      className="animate-pulse rounded-[12px] bg-g100"
      style={{ height: "clamp(280px, 46vh, 420px)" }}
    />
  ),
});

/** Львів — коли в клієнта ще немає жодної координати */
const FALLBACK = { lat: 49.8397, lng: 24.0297 };

type Candidate = { lat: number; lng: number; displayName: string };

export default function StopPinModal({
  counterpartyId,
  name,
  address,
  lat,
  lng,
  approximate,
  onClose,
  onSaved,
}: {
  counterpartyId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** true — пін поставив геокодер, точність лише до міста */
  approximate: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = {
    lat: lat ?? FALLBACK.lat,
    lng: lng ?? FALLBACK.lng,
  };
  const [pos, setPos] = useState(start);
  const [moved, setMoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState(address ?? "");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const search = async () => {
    const q = query.trim();
    if (q.length < 3) {
      setError("Введіть хоча б три символи");
      return;
    }
    setSearching(true);
    setError(null);
    setCandidates(null);
    try {
      const res = await fetch(`/api/geo/geocode?all=1&q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не вдалося знайти");
        return;
      }
      const items: Candidate[] = data.items ?? [];
      setCandidates(items);
      // Один-єдиний збіг — одразу ставимо пін: зайвий клік нічого не додає.
      if (items.length === 1) pick(items[0]);
    } catch {
      setError("Немає зв'язку — спробуйте ще раз");
    } finally {
      setSearching(false);
    }
  };

  const pick = (c: Candidate) => {
    setPos({ lat: c.lat, lng: c.lng });
    setMoved(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/client-map/${counterpartyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: pos.lat, lng: pos.lng }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не вдалося зберегти");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Немає зв'язку — спробуйте ще раз");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-3"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[16px] bg-white"
        style={{ boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-g200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-bk">{name}</p>
            <p className="mt-0.5 text-[12px] text-g500">
              {lat == null
                ? "Точки на карті ще немає"
                : approximate
                  ? "Пін приблизний — поставив геокодер за адресою"
                  : "Точку вже уточнено вручну"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] border border-g200 text-g500 hover:bg-g50"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") search();
              }}
              placeholder="Місто, вулиця, будинок"
              className="min-w-0 flex-1 rounded-[8px] border border-g200 px-3 py-2 text-[14px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
            />
            <button
              type="button"
              onClick={search}
              disabled={searching}
              className="flex-shrink-0 rounded-[8px] border border-g200 px-4 py-2 text-[14px] font-semibold text-bk hover:bg-g50 disabled:opacity-50"
            >
              {searching ? "Шукаю…" : "Знайти"}
            </button>
          </div>

          {candidates !== null && (
            <div className="mt-2">
              {candidates.length === 0 ? (
                <p className="text-[13px] text-g500">
                  Нічого не знайшлося. Поставте пін пальцем по карті — це
                  надійніше за будь-який геокодер.
                </p>
              ) : (
                <ul className="max-h-[136px] overflow-y-auto rounded-[8px] border border-g200">
                  {candidates.map((c, i) => (
                    <li key={`${c.lat},${c.lng},${i}`}>
                      <button
                        type="button"
                        onClick={() => pick(c)}
                        className="block w-full border-b border-g100 px-3 py-2 text-left text-[13px] text-g600 last:border-b-0 hover:bg-g50"
                      >
                        {c.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-3 overflow-hidden rounded-[12px] border border-g200">
            <PinPicker
              lat={pos.lat}
              lng={pos.lng}
              height="clamp(280px, 46vh, 420px)"
              onChange={(la, ln) => {
                setPos({ lat: la, lng: ln });
                setMoved(true);
              }}
            />
          </div>

          <p className="mt-2 text-[12px] text-g500">
            Перетягніть пін або тапніть по карті. Координата збережеться в
            картці клієнта й діятиме на всіх майбутніх маршрутах.
          </p>

          {error && <p className="mt-2 text-[13px] text-[#B91C1C]">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-g200 px-4 py-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !moved}
            className="flex-1 rounded-[10px] px-4 py-3 text-[15px] font-bold text-bk disabled:opacity-45"
            style={{ background: "#FFD600", border: "none" }}
          >
            {saving ? "Зберігаю…" : "Підтвердити точку"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-g200 px-4 py-3 text-[14px] font-semibold text-bk hover:bg-g50"
          >
            Скасувати
          </button>
        </div>
      </div>
    </div>
  );
}
