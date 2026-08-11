"use client";

import { useEffect, useState } from "react";

/**
 * Коригування часу зміни складовщика.
 *
 * Бот ставить час автоматично, тож типова помилка — забуте закриття:
 * зміна тягнеться до наступного ранку й ламає всю статистику годин
 * і продуктивності. Тут адмін виправляє час руками; тривалість
 * перераховує сервер.
 */

const INPUT: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid #E5E7EB",
  fontSize: "13px",
  width: "100%",
  background: "white",
};

/**
 * ISO → значення для <input type="datetime-local"> у КИЇВСЬКОМУ часі.
 * slice(0,16) від toISOString() дав би UTC, і адмін бачив би час на
 * 3 години раніше, ніж у таблиці змін.
 */
function toLocalInput(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Значення datetime-local (київський настінний час) → ISO.
 * new Date("2026-08-11T09:00") трактувало б рядок у часовому поясі
 * браузера — для адміна з-за кордону зміна поїхала б на кілька годин.
 */
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  // Зміщення Києва для цієї дати: рахуємо через різницю UTC-розбору та
  // того ж моменту, відформатованого в київському поясі
  const naive = new Date(`${v}:00Z`);
  const asKyiv = new Date(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(naive)
  );
  const offset = asKyiv.getTime() - naive.getTime();
  return new Date(naive.getTime() - offset).toISOString();
}

export default function EditWarehouseShiftModal({
  shift,
  onClose,
  onSaved,
}: {
  shift: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [openedAt, setOpenedAt] = useState(toLocalInput(shift.openedAt));
  const [closedAt, setClosedAt] = useState(toLocalInput(shift.closedAt));
  const [notes, setNotes] = useState(shift.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  // Попередній розрахунок тривалості — щоб адмін бачив результат до збереження
  const preview = (() => {
    if (!openedAt || !closedAt) return null;
    const o = new Date(openedAt).getTime();
    const c = new Date(closedAt).getTime();
    if (isNaN(o) || isNaN(c) || c < o) return null;
    const mins = Math.round((c - o) / 60000);
    return `${Math.floor(mins / 60)} год ${mins % 60} хв`;
  })();

  const save = async () => {
    if (!openedAt) {
      setError("Вкажіть час відкриття");
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/admin/warehouse-shifts/${shift.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openedAt: fromLocalInput(openedAt),
        closedAt: fromLocalInput(closedAt),
        notes,
      }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Не вдалося зберегти");
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved();
  };

  return (
    <div
      onClick={() => !saving && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: "14px",
          width: "100%",
          maxWidth: "460px",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #E5E7EB" }}>
          <h2 style={{ fontSize: "17px", fontWeight: 700 }}>Коригування зміни</h2>
          <p style={{ fontSize: "12px", color: "#6B7280" }}>
            {shift.userName} · {shift.reportsCount || 0} накладних
          </p>
        </div>

        <div style={{ padding: "16px 18px" }}>
          <label style={{ display: "block", marginBottom: "12px" }}>
            <span style={{ fontSize: "12px", color: "#6B7280" }}>Відкриття зміни</span>
            <input
              type="datetime-local"
              value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)}
              style={{ ...INPUT, marginTop: "4px" }}
            />
          </label>

          <label style={{ display: "block", marginBottom: "6px" }}>
            <span style={{ fontSize: "12px", color: "#6B7280" }}>
              Закриття зміни <span style={{ color: "#9CA3AF" }}>(порожньо = зміна триває)</span>
            </span>
            <input
              type="datetime-local"
              value={closedAt}
              onChange={(e) => setClosedAt(e.target.value)}
              style={{ ...INPUT, marginTop: "4px" }}
            />
          </label>

          <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "12px" }}>
            Тривалість: <b style={{ color: "#0A0A0A" }}>{preview || "—"}</b>
          </p>

          <label style={{ display: "block" }}>
            <span style={{ fontSize: "12px", color: "#6B7280" }}>Примітка</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Напр.: забув закрити зміну, час виправлено вручну"
              style={{ ...INPUT, marginTop: "4px", resize: "vertical" }}
            />
          </label>

          {error && (
            <p style={{ color: "#DC2626", fontSize: "13px", marginTop: "12px", fontWeight: 600 }}>
              {error}
            </p>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2"
          style={{ padding: "12px 18px", borderTop: "1px solid #E5E7EB" }}
        >
          <button
            onClick={onClose}
            disabled={saving}
            style={{ padding: "9px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}
          >
            Скасувати
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: "9px 18px",
              borderRadius: "8px",
              background: "#FFD600",
              fontSize: "13px",
              fontWeight: 700,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Збереження..." : "Зберегти"}
          </button>
        </div>
      </div>
    </div>
  );
}
