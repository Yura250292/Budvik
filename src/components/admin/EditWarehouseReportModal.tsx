"use client";

import { useEffect, useState } from "react";

/**
 * Ручне коригування розпізнаної накладної.
 *
 * Потрібне, поки OCR тестується: Gemini плутає кому в кількості, зрізає
 * останній рядок таблиці, ліпить номер документа з датою. Замість того щоб
 * ганяти фото на повторне розпізнавання, адмін виправляє значення руками.
 *
 * Позиції редагуємо локально й відправляємо весь список одним PUT —
 * сервер замінює їх цілком (див. коментар у API-роуті).
 */

type Item = {
  name: string;
  sku: string;
  unit: string;
  quantity: string;
  price: string;
};

const CARD_INPUT: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid #E5E7EB",
  fontSize: "13px",
  width: "100%",
  background: "white",
};

/** Число → рядок для інпута. 0 показуємо як "0", null/undefined — порожньо. */
function numStr(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

/** ISO-дата → YYYY-MM-DD для <input type="date"> */
function dateInputValue(v: unknown): string {
  if (!v) return "";
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default function EditWarehouseReportModal({
  report,
  onClose,
  onSaved,
}: {
  report: any;
  onClose: () => void;
  onSaved: (updated: any) => void;
}) {
  const [docType, setDocType] = useState<string>(report.docType || "");
  const [docNumber, setDocNumber] = useState<string>(report.docNumber || "");
  const [docDate, setDocDate] = useState<string>(dateInputValue(report.docDate));
  const [counterpartyName, setCounterpartyName] = useState<string>(
    report.counterpartyName || ""
  );
  const [counterpartyCode, setCounterpartyCode] = useState<string>(
    report.counterpartyCode || ""
  );
  const [notes, setNotes] = useState<string>(report.notes || "");
  const [totalAmount, setTotalAmount] = useState<string>(numStr(report.totalAmount));
  const [items, setItems] = useState<Item[]>(
    (report.items || []).map((i: any) => ({
      name: i.name || "",
      sku: i.sku || "",
      unit: i.unit || "",
      quantity: numStr(i.quantity),
      price: numStr(i.price),
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc закриває — модалка займає весь екран, миша до хрестика далеко
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const toNum = (v: string): number => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  const itemsSum = items.reduce((s, i) => s + toNum(i.quantity) * toNum(i.price), 0);

  const updateItem = (idx: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const addItem = () =>
    setItems((prev) => [...prev, { name: "", sku: "", unit: "", quantity: "", price: "" }]);

  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/admin/warehouse-reports/${report.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        docType: docType || null,
        docNumber,
        docDate: docDate || null,
        counterpartyName,
        counterpartyCode,
        notes,
        totalAmount,
        items: items.filter((i) => i.name.trim()),
      }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Не вдалося зберегти");
      setSaving(false);
      return;
    }

    const updated = await res.json();
    setSaving(false);
    onSaved(updated);
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
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "20px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#F7F7F7",
          borderRadius: "14px",
          width: "100%",
          maxWidth: "980px",
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ padding: "14px 18px", background: "white", borderBottom: "1px solid #E5E7EB" }}
        >
          <div>
            <h2 style={{ fontSize: "17px", fontWeight: 700 }}>Коригування накладної</h2>
            <p style={{ fontSize: "12px", color: "#6B7280" }}>
              {report.user?.name || report.userName} · зміни бачить лише адмін-панель, у 1С нічого
              не потрапляє
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            style={{ fontSize: "22px", color: "#9CA3AF", lineHeight: 1, padding: "0 4px" }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "16px 18px" }}>
          {/* --- Реквізити --- */}
          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: "12px",
              padding: "14px 16px",
              marginBottom: "14px",
            }}
          >
            <h3 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "10px" }}>
              Реквізити документа
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <label>
                <span style={{ fontSize: "12px", color: "#6B7280" }}>Тип документа</span>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  style={{ ...CARD_INPUT, marginTop: "4px" }}
                >
                  <option value="">— не вказано —</option>
                  <option value="purchase">Прихідна</option>
                  <option value="sales">Видаткова</option>
                </select>
              </label>

              <label>
                <span style={{ fontSize: "12px", color: "#6B7280" }}>Номер</span>
                <input
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  style={{ ...CARD_INPUT, marginTop: "4px" }}
                />
              </label>

              <label>
                <span style={{ fontSize: "12px", color: "#6B7280" }}>Дата документа</span>
                <input
                  type="date"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                  style={{ ...CARD_INPUT, marginTop: "4px" }}
                />
              </label>

              <label>
                <span style={{ fontSize: "12px", color: "#6B7280" }}>Контрагент</span>
                <input
                  value={counterpartyName}
                  onChange={(e) => setCounterpartyName(e.target.value)}
                  style={{ ...CARD_INPUT, marginTop: "4px" }}
                />
              </label>

              <label>
                <span style={{ fontSize: "12px", color: "#6B7280" }}>Код / ЄДРПОУ</span>
                <input
                  value={counterpartyCode}
                  onChange={(e) => setCounterpartyCode(e.target.value)}
                  style={{ ...CARD_INPUT, marginTop: "4px" }}
                />
              </label>

              <label>
                <span style={{ fontSize: "12px", color: "#6B7280" }}>
                  Сума з документа{" "}
                  <span style={{ color: "#9CA3AF" }}>(порожньо = сума позицій)</span>
                </span>
                <input
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder={itemsSum ? itemsSum.toFixed(2) : "0"}
                  style={{ ...CARD_INPUT, marginTop: "4px" }}
                />
              </label>
            </div>

            <label style={{ display: "block", marginTop: "12px" }}>
              <span style={{ fontSize: "12px", color: "#6B7280" }}>Примітки</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                style={{ ...CARD_INPUT, marginTop: "4px", resize: "vertical" }}
              />
            </label>
          </div>

          {/* --- Позиції --- */}
          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: "12px",
              overflow: "hidden",
            }}
          >
            <div
              className="flex items-center justify-between"
              style={{ padding: "12px 16px", borderBottom: "1px solid #F3F4F6" }}
            >
              <h3 style={{ fontSize: "14px", fontWeight: 700 }}>
                Позиції <span style={{ color: "#9CA3AF", fontWeight: 500 }}>({items.length})</span>
              </h3>
              <button
                onClick={addItem}
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  background: "#FFD600",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                + Додати рядок
              </button>
            </div>

            {items.length === 0 ? (
              <p style={{ padding: "18px", fontSize: "13px", color: "#6B7280" }}>
                Позицій немає. Додайте рядки вручну або поверніться до фото.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: "760px",
                    fontSize: "13px",
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#FAFAFA", textAlign: "left" }}>
                      {["№", "Товар", "Артикул", "Од.", "Кількість", "Ціна", "Сума", ""].map(
                        (h) => (
                          <th
                            key={h}
                            style={{
                              padding: "8px 10px",
                              fontWeight: 600,
                              color: "#6B7280",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "6px 10px", color: "#9CA3AF" }}>{i + 1}</td>
                        <td style={{ padding: "6px 10px", minWidth: "220px" }}>
                          <input
                            value={it.name}
                            onChange={(e) => updateItem(i, { name: e.target.value })}
                            placeholder="Назва товару"
                            style={CARD_INPUT}
                          />
                        </td>
                        <td style={{ padding: "6px 10px", width: "120px" }}>
                          <input
                            value={it.sku}
                            onChange={(e) => updateItem(i, { sku: e.target.value })}
                            style={CARD_INPUT}
                          />
                        </td>
                        <td style={{ padding: "6px 10px", width: "80px" }}>
                          <input
                            value={it.unit}
                            onChange={(e) => updateItem(i, { unit: e.target.value })}
                            style={CARD_INPUT}
                          />
                        </td>
                        <td style={{ padding: "6px 10px", width: "100px" }}>
                          <input
                            value={it.quantity}
                            onChange={(e) => updateItem(i, { quantity: e.target.value })}
                            inputMode="decimal"
                            style={CARD_INPUT}
                          />
                        </td>
                        <td style={{ padding: "6px 10px", width: "110px" }}>
                          <input
                            value={it.price}
                            onChange={(e) => updateItem(i, { price: e.target.value })}
                            inputMode="decimal"
                            style={CARD_INPUT}
                          />
                        </td>
                        <td
                          style={{
                            padding: "6px 10px",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            color: "#0A0A0A",
                          }}
                        >
                          {(toNum(it.quantity) * toNum(it.price)).toFixed(2)} ₴
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <button
                            onClick={() => removeItem(i)}
                            title="Видалити рядок"
                            style={{ color: "#DC2626", fontSize: "16px", lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid #E5E7EB", background: "#FAFAFA" }}>
                      <td colSpan={6} style={{ padding: "10px", fontWeight: 700, textAlign: "right" }}>
                        Разом позицій:
                      </td>
                      <td colSpan={2} style={{ padding: "10px", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {itemsSum.toFixed(2)} ₴
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {error && (
            <p style={{ color: "#DC2626", fontSize: "13px", marginTop: "12px", fontWeight: 600 }}>
              {error}
            </p>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2"
          style={{ padding: "12px 18px", background: "white", borderTop: "1px solid #E5E7EB" }}
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
