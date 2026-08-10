"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatPrice } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "В черзі",
  PROCESSING: "Обробляється",
  DONE: "Розпізнано",
  FAILED: "Помилка",
};

const STATUS_BG: Record<string, string> = {
  PENDING: "#FEF3C7",
  PROCESSING: "#EFF6FF",
  DONE: "#F0FDF4",
  FAILED: "#FEF2F2",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: "#D97706",
  PROCESSING: "#2563EB",
  DONE: "#16A34A",
  FAILED: "#DC2626",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  purchase: "Прихідна накладна",
  sales: "Видаткова накладна",
};

function formatPrice2(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "");
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateOnly(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

const CARD: React.CSSProperties = {
  background: "white",
  borderRadius: "var(--radius-card, 12px)",
  border: "1px solid #E5E7EB",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}>
      <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "2px" }}>{label}</p>
      <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{value || "—"}</p>
    </div>
  );
}

export default function WarehouseReportDetailPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/warehouse-reports/${id}`);
      setReport(res.ok ? await res.json() : null);
    } catch {
      setReport(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (["ADMIN", "MANAGER"].includes(role) && id) fetchReport();
  }, [role, id, fetchReport]);

  const retry = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/warehouse-reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry" }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Помилка");
    } else {
      await fetchReport();
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!confirm("Видалити цю накладну разом із фото? Дію не можна скасувати.")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/warehouse-reports/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Помилка");
      setBusy(false);
    } else {
      router.push("/admin/warehouse-reports");
    }
  };

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg font-bold">Доступ заборонено</p>
      </div>
    );
  }

  const items = report?.items || [];
  const itemsSum = items.reduce((s: number, i: any) => s + (i.lineTotal || 0), 0);
  const matchedCount = items.filter((i: any) => i.matchedProductId).length;
  // Розбіжність між сумою з документа і сумою позицій — сигнал, що AI щось
  // недочитав; показуємо явно, щоб адмін не звіряв вручну
  const declared = report?.totalAmount || 0;
  const mismatch = declared > 0 && Math.abs(declared - itemsSum) > 1;

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF" }}>
        <div className="max-w-7xl mx-auto" style={{ padding: "14px 24px" }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link
                href="/admin/warehouse-reports"
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "#FFD600" }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div>
                <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0A0A0A" }}>
                  {report?.docNumber ? `Накладна №${report.docNumber}` : "Накладна"}
                </h1>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>
                  {report ? `${report.user?.name} · ${formatDateTime(report.createdAt)}` : "Завантаження..."}
                </p>
              </div>
            </div>

            {report && (
              <div className="flex items-center gap-2">
                {report.status === "FAILED" && (
                  <button
                    onClick={retry}
                    disabled={busy}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "8px",
                      background: "#FFD600",
                      fontWeight: 600,
                      fontSize: "13px",
                    }}
                  >
                    {busy ? "..." : "🔄 Розпізнати ще раз"}
                  </button>
                )}
                {role === "ADMIN" && (
                  <button
                    onClick={remove}
                    disabled={busy}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "8px",
                      background: "#FEF2F2",
                      color: "#DC2626",
                      fontWeight: 600,
                      fontSize: "13px",
                    }}
                  >
                    Видалити
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "16px", paddingBottom: "40px" }}>
        {loading && <p style={{ color: "#6B7280", fontSize: "14px" }}>Завантаження...</p>}

        {!loading && !report && (
          <div style={{ ...CARD, padding: "24px", textAlign: "center", color: "#6B7280" }}>
            Накладну не знайдено
          </div>
        )}

        {!loading && report && (
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Ліва колонка: фото + реквізити */}
            <div style={{ width: "100%", maxWidth: "360px", flexShrink: 0 }}>
              <div style={{ ...CARD, padding: "12px", marginBottom: "16px" }}>
                <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "8px" }}>
                  Оригінал фото
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/admin/warehouse-reports/${id}/photo`}
                  alt="Накладна"
                  onClick={() => setLightbox(true)}
                  style={{
                    width: "100%",
                    borderRadius: "8px",
                    border: "1px solid #E5E7EB",
                    cursor: "zoom-in",
                  }}
                />
                <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "6px", textAlign: "center" }}>
                  Натисніть, щоб збільшити
                </p>
              </div>

              <div style={{ ...CARD, padding: "16px" }}>
                <h2 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "8px" }}>
                  Реквізити документа
                </h2>

                <div style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}>
                  <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "4px" }}>Статус</p>
                  <span
                    style={{
                      fontSize: "12px",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      background: STATUS_BG[report.status],
                      color: STATUS_COLOR[report.status],
                      fontWeight: 600,
                    }}
                  >
                    {STATUS_LABELS[report.status]}
                  </span>
                </div>

                <Field
                  label="Тип документа"
                  value={report.docType ? DOC_TYPE_LABELS[report.docType] || report.docType : null}
                />
                <Field label="Номер" value={report.docNumber} />
                <Field label="Дата документа" value={formatDateOnly(report.docDate)} />
                <Field
                  label="Контрагент"
                  value={
                    report.counterpartyName ? (
                      <>
                        {report.counterpartyName}
                        {report.matchedCounterparty && (
                          <span style={{ display: "block", fontSize: "12px", color: "#16A34A", fontWeight: 500 }}>
                            ✓ знайдено в базі: {report.matchedCounterparty.name}
                          </span>
                        )}
                      </>
                    ) : null
                  }
                />
                {report.counterpartyCode && (
                  <Field label="Код / ЄДРПОУ" value={report.counterpartyCode} />
                )}
                <Field label="Складовщик" value={report.user?.name} />
                <Field label="Надіслано" value={formatDateTime(report.createdAt)} />
                {report.shift && (
                  <Field
                    label="Зміна"
                    value={
                      <>
                        {formatDateTime(report.shift.openedAt)}
                        {report.shift.openAddress && (
                          <span style={{ display: "block", fontSize: "12px", color: "#6B7280", fontWeight: 400 }}>
                            📍 {report.shift.openAddress}
                          </span>
                        )}
                      </>
                    }
                  />
                )}
                {report.notes && <Field label="Примітки" value={report.notes} />}
              </div>
            </div>

            {/* Права колонка: позиції */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {report.status === "FAILED" && report.errorMessage && (
                <div
                  style={{
                    ...CARD,
                    padding: "14px 16px",
                    marginBottom: "16px",
                    background: STATUS_BG.FAILED,
                    borderColor: STATUS_COLOR.FAILED,
                  }}
                >
                  <p style={{ color: STATUS_COLOR.FAILED, fontWeight: 600, fontSize: "14px" }}>
                    ❌ Не вдалося розпізнати
                  </p>
                  <p style={{ color: "#6B7280", fontSize: "13px", marginTop: "4px" }}>
                    {report.errorMessage}
                  </p>
                </div>
              )}

              {mismatch && (
                <div
                  style={{
                    ...CARD,
                    padding: "12px 16px",
                    marginBottom: "16px",
                    background: "#FEF3C7",
                    borderColor: "#D97706",
                  }}
                >
                  <p style={{ color: "#D97706", fontWeight: 600, fontSize: "13px" }}>
                    ⚠️ Сума в документі ({formatPrice2(declared)}) не збігається із сумою позицій (
                    {formatPrice2(itemsSum)})
                  </p>
                  <p style={{ color: "#92400E", fontSize: "12px", marginTop: "4px" }}>
                    Можливо, AI не розпізнав частину рядків. Звірте з фото.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Позицій", value: items.length },
                  { label: "Сума позицій", value: formatPrice(itemsSum) },
                  { label: "Сума з документа", value: declared ? formatPrice(declared) : "—" },
                  { label: "Зіставлено з базою", value: `${matchedCount} з ${items.length}` },
                ].map((k) => (
                  <div key={k.label} style={{ ...CARD, padding: "12px 14px" }}>
                    <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "4px" }}>{k.label}</p>
                    <p style={{ fontSize: "18px", fontWeight: 700, color: "#0A0A0A" }}>{k.value}</p>
                  </div>
                ))}
              </div>

              <div style={{ ...CARD, overflow: "hidden" }}>
                <div
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid #F3F4F6",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <h2 style={{ fontSize: "15px", fontWeight: 700 }}>Номенклатура</h2>
                  <span style={{ fontSize: "12px", color: "#6B7280" }}>
                    ✓ — товар знайдено в базі Budvik
                  </span>
                </div>

                {items.length === 0 ? (
                  <p style={{ padding: "20px", color: "#6B7280", fontSize: "14px" }}>
                    Позицій не розпізнано
                  </p>
                ) : (
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", overscrollBehaviorX: "contain" }}>
                    {/* 7 колонок: без minWidth на телефоні вони стискаються
                        в нечитабельні стовпчики по одному символу. */}
                    <table style={{ width: "100%", minWidth: "760px", fontSize: "13px", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#FAFAFA", textAlign: "left" }}>
                          {["№", "Товар", "Артикул", "Од.", "Кількість", "Ціна", "Сума"].map((h) => (
                            <th
                              key={h}
                              style={{
                                padding: "10px 12px",
                                fontWeight: 600,
                                color: "#6B7280",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item: any, i: number) => (
                          <tr key={item.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                            <td style={{ padding: "10px 12px", color: "#9CA3AF" }}>{i + 1}</td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ fontWeight: 600 }}>
                                {item.matchedProductId && (
                                  <span style={{ color: "#16A34A", marginRight: "4px" }} title="Знайдено в базі">
                                    ✓
                                  </span>
                                )}
                                {item.name}
                              </div>
                              {item.matchedProductName && item.matchedProductName !== item.name && (
                                <div style={{ fontSize: "12px", color: "#9CA3AF" }}>
                                  ↳ {item.matchedProductName}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: "10px 12px", color: "#6B7280" }}>{item.sku || "—"}</td>
                            <td style={{ padding: "10px 12px", color: "#6B7280" }}>{item.unit || "—"}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap" }}>
                              {formatQty(item.quantity)}
                            </td>
                            <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                              {formatPrice2(item.price)}
                              {item.matchedProductPrice != null &&
                                Math.abs(item.matchedProductPrice - item.price) > 0.01 && (
                                  <div style={{ fontSize: "11px", color: "#9CA3AF" }}>
                                    у базі: {formatPrice2(item.matchedProductPrice)}
                                  </div>
                                )}
                            </td>
                            <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>
                              {formatPrice2(item.lineTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: "2px solid #E5E7EB", background: "#FAFAFA" }}>
                          <td colSpan={6} style={{ padding: "12px", fontWeight: 700, textAlign: "right" }}>
                            Разом:
                          </td>
                          <td style={{ padding: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
                            {formatPrice2(itemsSum)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {report.rawResponse?.text && (
                <div style={{ ...CARD, padding: "12px 16px", marginTop: "16px" }}>
                  <button
                    onClick={() => setShowRaw((v) => !v)}
                    style={{ fontSize: "13px", fontWeight: 600, color: "#6B7280" }}
                  >
                    {showRaw ? "▾" : "▸"} Відповідь AI (для перевірки)
                  </button>
                  {showRaw && (
                    <pre
                      style={{
                        marginTop: "10px",
                        fontSize: "11px",
                        color: "#6B7280",
                        background: "#FAFAFA",
                        padding: "12px",
                        borderRadius: "8px",
                        overflowX: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {report.rawResponse.text}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {lightbox && (
        <div
          onClick={() => setLightbox(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/admin/warehouse-reports/${id}/photo`}
            alt="Накладна"
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: "8px" }}
          />
        </div>
      )}
    </div>
  );
}
