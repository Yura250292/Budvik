"use client";

/**
 * Передача маршруту водію на дату.
 *
 * Смуга під шапкою маршруту: водій, дата, кнопка «Передати». Поки маршрут
 * не переданий, водій його не бачить — тому це головна дія на картці, а не
 * ще одне поле у формі.
 *
 * Конфлікт «два маршрути на одного водія в один день» не забороняється
 * жорстко: буває, що людина справді їде двічі. Але сервер повертає 409 з
 * поясненням, і другий раз треба підтвердити свідомо — бо планшет покаже
 * лише один маршрут дня.
 */

import { useState } from "react";

type Driver = { id: string; name: string | null };

export default function AssignDriverBar({
  routeId,
  status,
  driverId,
  driverName,
  date,
  assignedAt,
  stopsCount,
  drivers,
  onChanged,
}: {
  routeId: string;
  status: string;
  driverId: string | null;
  driverName: string | null;
  date: string;
  assignedAt: string | null;
  stopsCount: number;
  drivers: Driver[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pickDriver, setPickDriver] = useState(driverId ?? "");
  const [pickDate, setPickDate] = useState(date.slice(0, 10));

  const assigned = status === "ASSIGNED";
  const closed = status === "COMPLETED" || status === "CANCELLED";
  const running = status === "IN_PROGRESS";

  const assign = async (force = false) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/delivery-routes/${routeId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: pickDriver || null,
          date: pickDate,
          force,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.needsForce) {
        if (confirm(`${data.error}\n\nВсе одно передати?`)) {
          setBusy(false);
          return assign(true);
        }
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Не вдалося передати");
        return;
      }
      setEditing(false);
      onChanged();
    } catch {
      setError("Немає зв'язку — спробуйте ще раз");
    } finally {
      setBusy(false);
    }
  };

  const unassign = async () => {
    if (!confirm("Відкликати маршрут? Водій перестане його бачити.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/delivery-routes/${routeId}/assign`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Не вдалося відкликати");
      else onChanged();
    } catch {
      setError("Немає зв'язку — спробуйте ще раз");
    } finally {
      setBusy(false);
    }
  };

  if (closed) return null;

  return (
    <div
      style={{
        padding: "12px 20px",
        background: assigned ? "#F0FDF4" : "#FFFBEB",
        borderBottom: "1px solid #F3F4F6",
      }}
    >
      {error && (
        <p style={{ fontSize: "13px", color: "#B91C1C", marginBottom: "8px" }}>{error}</p>
      )}

      {running ? (
        <p style={{ fontSize: "13px", color: "#92400E" }}>
          Водій у дорозі — маршрут уже виконується.
        </p>
      ) : assigned && !editing ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p style={{ fontSize: "13px", color: "#166534" }}>
            <b>Передано водію</b>
            {driverName ? ` — ${driverName}` : ""}
            {assignedAt ? `, ${new Date(assignedAt).toLocaleString("uk-UA", {
              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })}` : ""}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} disabled={busy} style={ghostBtn}>
              Змінити водія
            </button>
            <button onClick={unassign} disabled={busy} style={ghostBtn}>
              Відкликати
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label style={labelStyle}>Водій</label>
            <select
              value={pickDriver}
              onChange={(e) => setPickDriver(e.target.value)}
              style={{ ...fieldStyle, minWidth: "180px" }}
            >
              <option value="">Оберіть водія</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Дата</label>
            <input
              type="date"
              value={pickDate}
              onChange={(e) => setPickDate(e.target.value)}
              style={fieldStyle}
            />
          </div>
          <button
            onClick={() => assign(false)}
            disabled={busy || !pickDriver || stopsCount === 0}
            style={{
              background: "#FFD600",
              color: "#0A0A0A",
              padding: "10px 20px",
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "14px",
              border: "none",
              opacity: busy || !pickDriver || stopsCount === 0 ? 0.45 : 1,
            }}
          >
            {busy ? "Передаю..." : assigned ? "Зберегти" : "Передати водію"}
          </button>
          {editing && (
            <button onClick={() => setEditing(false)} disabled={busy} style={ghostBtn}>
              Скасувати
            </button>
          )}
          {!assigned && (
            <p style={{ fontSize: "12px", color: "#92400E", width: "100%" }}>
              {stopsCount === 0
                ? "Спершу додайте хоча б одну точку."
                : "Поки маршрут не передано, водій його не бачить."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#6B7280",
  display: "block",
  marginBottom: "4px",
};

const fieldStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: "8px",
  border: "1px solid #E5E7EB",
  fontSize: "14px",
  background: "white",
};

const ghostBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: "8px",
  fontSize: "13px",
  fontWeight: 600,
  border: "1px solid #E5E7EB",
  background: "white",
  color: "#0A0A0A",
};
