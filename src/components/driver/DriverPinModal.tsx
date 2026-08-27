"use client";

/**
 * Уточнення точки клієнта водієм — прямо з карти, без переходу на сторінку.
 *
 * У торгового для цього є /sales/clients/[id]/pin, але вона тягне зведення
 * клієнта (фінанси, історія покупок) заради двох координат. Водієві того
 * бачити не треба, а координати в нього вже є — карта їх щойно намалювала.
 *
 * Головний сценарій той самий, що в торгового: стоячи біля магазину
 * натиснути «Я зараз тут». Це точніше за тягання пальцем по мапі, тому
 * кнопка головна, а перетягування лишається запасним шляхом.
 */

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";

const PinPicker = dynamic(() => import("@/components/map/PinPicker"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full animate-pulse"
      style={{ height: "clamp(280px, 48vh, 460px)", borderRadius: "12px", background: "#EEE" }}
    />
  ),
});

/** Гірше за це GPS у місті не дає — приймати як «я тут» немає сенсу. */
const MAX_ACCURACY_M = 100;

export function DriverPinModal({
  client,
  onClose,
  onSaved,
}: {
  client: { id: string; name: string; lat: number; lng: number; approximate: boolean };
  onClose: () => void;
  onSaved: (lat: number, lng: number) => void;
}) {
  const [pos, setPos] = useState({ lat: client.lat, lng: client.lng });
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const here = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Пристрій не дає геолокацію");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        // Показуємо точність, але не блокуємо: в дворі під навісом інколи
        // краще поставити приблизно, ніж лишити пін на площі Ринок.
        setAccuracy(Math.round(p.coords.accuracy));
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        setLocating(false);
        setError("Не вдалося визначити позицію. Увімкніть геолокацію.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/client-map/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // accuracy лишається лише поки пін стоїть там, куди його поставив
        // GPS: ручне перетягування скидає його в null (див. PinPicker нижче).
        body: JSON.stringify({ lat: pos.lat, lng: pos.lng, accuracyM: accuracy }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      onSaved(pos.lat, pos.lng);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }, [client.id, pos, accuracy, onSaved, onClose]);

  const moved = pos.lat !== client.lat || pos.lng !== client.lng;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center"
      style={{ background: "rgba(10,10,10,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full"
        style={{
          maxWidth: "640px",
          background: "#fff",
          borderRadius: "18px 18px 0 0",
          // Модалка живе над нижнім меню водія: без цього відступу кнопки
          // «Я зараз тут» і «Зберегти» ховалися під навбаром, і уточнити
          // пін було неможливо — вікно виглядало зламаним.
          maxHeight: "calc(92vh - 4rem)",
          overflowY: "auto",
          paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 pt-4">
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }}>
              {client.name}
            </p>
            <p style={{ fontSize: "12px", color: "#6B7280" }}>
              {client.approximate ? "Точка приблизна — геокодер знайшов лише місто" : "Точка вже уточнена"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200"
            style={{ width: "44px", height: "44px", background: "#F3F4F6", border: "none" }}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="#374151" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 pt-3">
          <PinPicker
            lat={pos.lat}
            lng={pos.lng}
            onChange={(lat, lng) => {
              setAccuracy(null);
              setPos({ lat, lng });
            }}
            height="clamp(280px, 48vh, 460px)"
          />
        </div>

        {accuracy != null && (
          <p
            className="px-4 pt-2"
            style={{ fontSize: "12px", color: accuracy > MAX_ACCURACY_M ? "#D97706" : "#16A34A" }}
          >
            {accuracy > MAX_ACCURACY_M
              ? `Точність ±${accuracy} м — слабкий сигнал, перевірте маркер`
              : `Точність ±${accuracy} м`}
          </p>
        )}

        {error && (
          <div
            className="mx-4 mt-3 rounded-xl p-3"
            style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}
          >
            <p style={{ fontSize: "13px", color: "#B91C1C" }}>{error}</p>
          </div>
        )}

        <div className="flex gap-2 px-4 py-4">
          <button
            type="button"
            onClick={here}
            disabled={locating}
            className="flex-1 cursor-pointer rounded-xl transition-colors duration-200"
            style={{
              minHeight: "52px",
              background: locating ? "#E5E7EB" : "#2563EB",
              color: locating ? "#6B7280" : "#fff",
              border: "none",
              fontSize: "15px",
              fontWeight: 700,
            }}
          >
            {locating ? "Шукаю…" : "Я зараз тут"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !moved}
            className="flex-1 cursor-pointer rounded-xl transition-colors duration-200"
            style={{
              minHeight: "52px",
              background: saving || !moved ? "#E5E7EB" : "#16A34A",
              color: saving || !moved ? "#6B7280" : "#fff",
              border: "none",
              fontSize: "15px",
              fontWeight: 700,
            }}
          >
            {saving ? "Зберігаю…" : "Зберегти"}
          </button>
        </div>
      </div>
    </div>
  );
}
