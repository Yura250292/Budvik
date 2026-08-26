"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate, formatDocDate } from "@/lib/utils";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { isRealSku } from "@/lib/catalog/sku-search";

const STATUS_LABELS: Record<string, string> = { DRAFT: "Чернетка", CONFIRMED: "Підтверджено", CANCELLED: "Скасовано" };
const STATUS_BG: Record<string, string> = { DRAFT: "#FFF7ED", CONFIRMED: "#F0FDF4", CANCELLED: "#FEF2F2" };
const STATUS_COLOR: Record<string, string> = { DRAFT: "#D97706", CONFIRMED: "#16A34A", CANCELLED: "#DC2626" };

export default function SalesOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDoc = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/erp/sales/${id}`);
      if (res.ok) {
        setDoc(await res.json());
      } else {
        router.push("/sales/orders");
      }
    } catch {
      router.push("/sales/orders");
    }
    setLoading(false);
  }, [id, router]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  const handleConfirm = async () => {
    if (!confirm("Підтвердити продаж?\nЗалишки будуть зменшені, комісії нараховані.")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/erp/sales/${id}/confirm`, { method: "POST" });
      if (res.ok) {
        fetchDoc();
      } else {
        const err = await res.json();
        alert(err.error || "Помилка підтвердження");
      }
    } catch {
      alert("Мережева помилка");
    }
    setActionLoading(false);
  };

  const handleCancel = async () => {
    if (!confirm("Скасувати документ?")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/erp/sales/${id}/cancel`, { method: "POST" });
      if (res.ok) {
        fetchDoc();
      } else {
        const err = await res.json();
        alert(err.error || "Помилка скасування");
      }
    } catch {
      alert("Мережева помилка");
    }
    setActionLoading(false);
  };

  // Роль-гейт живе в SalesGate на рівні секції (src/app/sales/layout.tsx).

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ color: "#9CA3AF" }}>Завантаження...</div>;
  }

  if (!doc) return null;

  const totalCost = doc.items?.reduce((s: number, i: any) => s + i.quantity * i.purchasePrice, 0) || 0;
  const totalProfit = doc.totalAmount - totalCost;

  /**
   * Чи взагалі є з чого рахувати маржу.
   *
   * У замовленнях собівартості немає ніколи: 1С віддає її регістром
   * ПродажиСебестоимость, а той пише лише на реалізацію. Формула
   * «сума − нуль» показувала весь оборот як прибуток — 7 675,52 грн
   * прибутку при 7 675,52 грн виручки і маржа 0%. Число неправильне не
   * трохи, а повністю, тож замість нього краще не показувати нічого.
   */
  const hasCost = totalCost > 0;

  // Документ із 1С підтвердити чи скасувати на сайті не можна: там свій
  // цикл проведення, і наше «Підтвердити» лише розвело б дві бази. Кнопки
  // лишаються тільки для документів, набраних тут.
  const fromOneC = !!doc.externalId;
  const isDraft = doc.status === "DRAFT" && !fromOneC;
  const unpostedInOneC = doc.status === "DRAFT" && fromOneC;

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <SalesHeader
        title={doc.number}
        subtitle={fromOneC ? formatDocDate(doc.createdAt) : formatDate(doc.createdAt)}
        backTo="/sales/orders"
        sticky
        right={
          <span style={{
            fontSize: "12px", fontWeight: 600, padding: "4px 10px", borderRadius: "8px",
            background: STATUS_BG[doc.status], color: STATUS_COLOR[doc.status],
          }}>
            {unpostedInOneC ? "Не проведено" : STATUS_LABELS[doc.status]}
          </span>
        }
      />

      {/* Відступ під навбар дає SalesLayout. */}
      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: "12px" }}>
        {/* Summary cards. Прибуток і маржа — лише там, де приїхала
            собівартість, тобто на реалізаціях. */}
        <div className={`grid ${hasCost ? "grid-cols-3" : "grid-cols-2"} gap-2 mb-3`}>
          <div className="bg-white rounded-xl p-3 text-center" style={{ border: "1px solid #EFEFEF" }}>
            <p style={{ fontSize: "11px", color: "#9CA3AF" }}>Сума</p>
            <p style={{ fontSize: "18px", fontWeight: 700 }}>{formatPrice(doc.totalAmount)}</p>
          </div>
          {hasCost ? (
            <>
              <div className="bg-white rounded-xl p-3 text-center" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "11px", color: "#9CA3AF" }}>Прибуток</p>
                <p style={{ fontSize: "18px", fontWeight: 700, color: totalProfit > 0 ? "#16A34A" : "#DC2626" }}>{formatPrice(totalProfit)}</p>
              </div>
              <div className="bg-white rounded-xl p-3 text-center" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "11px", color: "#9CA3AF" }}>Маржа</p>
                <p style={{ fontSize: "18px", fontWeight: 700 }}>{Math.round((totalProfit / totalCost) * 100)}%</p>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl p-3 text-center" style={{ border: "1px solid #EFEFEF" }}>
              <p style={{ fontSize: "11px", color: "#9CA3AF" }}>Позицій</p>
              <p style={{ fontSize: "18px", fontWeight: 700 }}>{doc.items?.length || 0}</p>
            </div>
          )}
        </div>

        {/* Непроведене замовлення з 1С: показуємо чесно, що це ще не факт. */}
        {unpostedInOneC && (
          <div className="rounded-2xl p-3 mb-3" style={{ background: "#FFF7ED", border: "1px solid #FED7AA" }}>
            {doc.replacedBy ? (
              <>
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#C2410C" }}>
                  Замінено документом №{doc.replacedBy.number}
                </p>
                <p style={{ fontSize: "12px", color: "#9A3412", marginTop: "2px" }}>
                  Проведено на {formatPrice(doc.replacedBy.totalAmount)}
                  {/* Різниця — це і є недовіз: рахувати його в голові, тримаючи
                      поруч два екрани, торговий не має. */}
                  {Math.abs(doc.totalAmount - doc.replacedBy.totalAmount) >= 0.01 && (
                    <> · недовіз {formatPrice(doc.totalAmount - doc.replacedBy.totalAmount)}</>
                  )}
                </p>
                <Link
                  href={`/sales/orders/${doc.replacedBy.id}`}
                  style={{ fontSize: "12px", fontWeight: 600, color: "#C2410C", textDecoration: "underline" }}
                >
                  Відкрити проведений документ
                </Link>
              </>
            ) : (
              <>
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#C2410C" }}>Замовлення ще не проведене в 1С</p>
                <p style={{ fontSize: "12px", color: "#9A3412", marginTop: "2px" }}>
                  Кількості й сума можуть змінитись, коли офіс проведе документ під наявний залишок.
                </p>
              </>
            )}
          </div>
        )}

        {/* Client info */}
        <div className="bg-white rounded-2xl p-4 mb-3" style={{ border: "1px solid #EFEFEF" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "#EFF6FF", color: "#3B82F6", fontWeight: 600, fontSize: "16px" }}>
              {doc.counterparty?.name?.charAt(0) || "?"}
            </div>
            <div>
              <p style={{ fontSize: "15px", fontWeight: 600 }}>{doc.counterparty?.name || "Без клієнта"}</p>
              {doc.salesRep && <p style={{ fontSize: "12px", color: "#9CA3AF" }}>Менеджер: {doc.salesRep.name}</p>}
            </div>
          </div>
          {doc.notes && (
            <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "8px", padding: "8px 0", borderTop: "1px solid #F3F4F6" }}>
              {doc.notes}
            </p>
          )}
        </div>

        {/* Items */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #EFEFEF" }}>
            <p style={{ fontSize: "14px", fontWeight: 600 }}>Товари ({doc.items?.length || 0})</p>
          </div>
          {doc.items?.map((item: any, idx: number) => {
            const lineTotal = item.quantity * item.sellingPrice;
            const lineProfit = (item.sellingPrice - item.purchasePrice) * item.quantity;
            const marginPct = item.purchasePrice > 0 ? Math.round(((item.sellingPrice - item.purchasePrice) / item.purchasePrice) * 100) : 0;
            return (
              <div key={idx} style={{ padding: "12px 16px", borderBottom: "1px solid #F9FAFB" }}>
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    {/* Без truncate: назви на кшталт «SIGMA Плита газова
                        одноконфор.з пєзопідпалом, плав.регул. (адаптер,
                        кейс)» обривались рівно там, де починалась відмінність
                        між схожими позиціями, і торговий не міг звірити рядок
                        з екраном 1С. */}
                    <p style={{ fontSize: "14px", fontWeight: 500, lineHeight: 1.3 }}>{item.product?.name}</p>
                    <div className="flex items-center gap-2" style={{ fontSize: "12px", color: "#9CA3AF" }}>
                      {/* Службова заглушка «1C-74DDFD7F» для людини порожній
                          звук — у 1С у цього товару артикула просто немає. */}
                      {isRealSku(item.product?.sku) && <span>{item.product.sku}</span>}
                      {item.purchasePrice > 0 && (
                        <>
                          <span>|</span>
                          <span style={{ color: "#6B7280" }}>Вхід: {formatPrice(item.purchasePrice)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0" style={{ marginLeft: "8px" }}>
                    <p style={{ fontSize: "15px", fontWeight: 700 }}>{formatPrice(lineTotal)}</p>
                    {item.purchasePrice > 0 && (
                      <p style={{ fontSize: "11px", fontWeight: 600, color: lineProfit > 0 ? "#16A34A" : lineProfit < 0 ? "#DC2626" : "#9CA3AF" }}>
                        {lineProfit > 0 ? "+" : ""}{formatPrice(lineProfit)} ({marginPct}%)
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2" style={{ fontSize: "13px", color: "#6B7280" }}>
                  <span>{item.quantity} шт</span>
                  <span>&times;</span>
                  <span>{formatPrice(item.sellingPrice)}</span>
                  {item.discountPercent > 0 && (
                    <span style={{ color: "#F59E0B", fontWeight: 600 }}>-{item.discountPercent}%</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Commission info for confirmed */}
        {doc.commissions && doc.commissions.length > 0 && (
          <div className="bg-white rounded-2xl p-4 mt-3" style={{ border: "1px solid #EFEFEF" }}>
            <p style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>Комісії</p>
            {doc.commissions.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid #F3F4F6" }}>
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 500 }}>{c.brand}</p>
                  <p style={{ fontSize: "12px", color: "#9CA3AF" }}>Ставка: {c.commissionRate}%</p>
                </div>
                <p style={{ fontSize: "16px", fontWeight: 700, color: "#F59E0B" }}>{formatPrice(c.commissionAmount)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Confirmed status card */}
        {doc.status === "CONFIRMED" && (
          <div className="mt-3 p-4 rounded-2xl text-center" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
            <p style={{ fontSize: "15px", fontWeight: 600, color: "#16A34A" }}>Документ підтверджено</p>
            <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "4px" }}>
              {fromOneC ? formatDocDate(doc.confirmedAt) : formatDate(doc.confirmedAt)}
            </p>
          </div>
        )}

        {doc.status === "CANCELLED" && (
          <div className="mt-3 p-4 rounded-2xl text-center" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
            <p style={{ fontSize: "15px", fontWeight: 600, color: "#DC2626" }}>Документ скасовано</p>
          </div>
        )}
      </div>

      {/* Bottom action bar for DRAFT — above SalesBottomNav (64px) */}
      {isDraft && (
        <div className="fixed left-0 right-0 z-50" style={{
          bottom: "64px",
          background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: "14px 16px",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
        }}>
          <div className="max-w-lg mx-auto flex gap-3">
            <button onClick={handleCancel} disabled={actionLoading}
              style={{
                flex: 1, padding: "14px", borderRadius: "14px", fontWeight: 600, fontSize: "15px",
                background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)",
                border: "1px solid rgba(255,255,255,0.1)", opacity: actionLoading ? 0.5 : 1,
              }}>
              Скасувати
            </button>
            <button onClick={handleConfirm} disabled={actionLoading}
              style={{
                flex: 2, padding: "14px", borderRadius: "14px", fontWeight: 700, fontSize: "16px",
                background: "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",
                color: "white", border: "none", opacity: actionLoading ? 0.5 : 1,
                boxShadow: "0 4px 16px rgba(34,197,94,0.3)",
              }}>
              {actionLoading ? "..." : "Підтвердити продаж"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
