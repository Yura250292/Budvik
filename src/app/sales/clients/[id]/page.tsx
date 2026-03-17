"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Створено", CONFIRMED: "Підтверджено", PACKING: "На упакуванні",
  IN_TRANSIT: "В дорозі", DELIVERED: "Доставлено", CANCELLED: "Скасовано",
};
const STATUS_BG: Record<string, string> = {
  DRAFT: "#FFF7ED", CONFIRMED: "#EFF6FF", PACKING: "#FDF4FF",
  IN_TRANSIT: "#FFFBEB", DELIVERED: "#F0FDF4", CANCELLED: "#FEF2F2",
};
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "#D97706", CONFIRMED: "#2563EB", PACKING: "#9333EA",
  IN_TRANSIT: "#D97706", DELIVERED: "#16A34A", CANCELLED: "#DC2626",
};

export default function ClientDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch(`/api/erp/counterparties/${id}/summary`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [session, id]);

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ color: "#9CA3AF" }}>Завантаження...</div>;
  if (!data?.counterparty) return <div className="min-h-screen flex items-center justify-center"><p>Клієнта не знайдено</p></div>;

  const { counterparty: cp, debt, sales, topProducts = [] } = data;

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50" style={{
        background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ height: "2px", background: "linear-gradient(to right, transparent, #FFD600, transparent)" }} />
        <div className="max-w-lg mx-auto flex items-center gap-3" style={{ padding: "12px 16px" }}>
          <Link href="/sales/clients" className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.08)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.7)" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 style={{ fontSize: "18px", fontWeight: 700, color: "white" }} className="truncate">{cp.name}</h1>
            {cp.code && <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>ЄДРПОУ: {cp.code}</p>}
          </div>
          <Link href={`/sales/new?clientId=${id}`}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #FFD600, #FFA000)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: "16px", paddingBottom: "100px" }}>
        {/* Contact info */}
        <div className="bg-white rounded-2xl p-4 mb-3" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          {cp.phone && (
            <a href={`tel:${cp.phone}`} className="flex items-center gap-3 py-2.5" style={{ textDecoration: "none", color: "#0A0A0A" }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#EFF6FF" }}>
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="#3B82F6" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
              </div>
              <span style={{ fontSize: "15px", fontWeight: 500 }}>{cp.phone}</span>
            </a>
          )}
          {cp.address && (
            <div className="flex items-center gap-3 py-2.5" style={{ borderTop: "1px solid #F3F4F6" }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#F3F4F6" }}>
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="#6B7280" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
              </div>
              <span style={{ fontSize: "14px", color: "#6B7280" }}>{cp.address}</span>
            </div>
          )}
          {cp.contactPerson && (
            <div className="flex items-center gap-3 py-2.5" style={{ borderTop: "1px solid #F3F4F6" }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#F3F4F6" }}>
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="#6B7280" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <span style={{ fontSize: "14px", color: "#6B7280" }}>{cp.contactPerson}</span>
            </div>
          )}
        </div>

        {/* Debt card */}
        <div className="rounded-2xl p-4 mb-3" style={{
          border: debt.total > 0 ? "1px solid #FCA5A5" : "1px solid #EFEFEF",
          background: debt.total > 0 ? "linear-gradient(135deg, #FEF2F2, #FFF1F2)" : "white",
          boxShadow: debt.total > 0 ? "0 2px 8px rgba(220,38,38,0.08)" : "0 1px 4px rgba(0,0,0,0.04)",
        }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: debt.total > 0 ? "#FEE2E2" : "#F3F4F6" }}>
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke={debt.total > 0 ? "#DC2626" : "#9CA3AF"} strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
              </div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: debt.total > 0 ? "#DC2626" : "#6B7280" }}>
                Заборгованість
              </p>
            </div>
            <p style={{ fontSize: "24px", fontWeight: 700, color: debt.total > 0 ? "#DC2626" : "#16A34A" }}>
              {formatPrice(debt.total)}
            </p>
          </div>
          {debt.invoices.length > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(220,38,38,0.15)" }}>
              {debt.invoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between py-1.5" style={{ fontSize: "13px" }}>
                  <span style={{ color: "#6B7280" }}>{inv.number}</span>
                  <span style={{ fontWeight: 600, color: "#DC2626" }}>
                    {formatPrice(inv.totalAmount - inv.paidAmount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top products */}
        {topProducts.length > 0 && (
          <div className="bg-white rounded-2xl mb-3" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div className="flex items-center gap-2" style={{ padding: "14px 16px", borderBottom: "1px solid #F3F4F6" }}>
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="#F59E0B" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>Найчастіші товари</p>
            </div>
            <div style={{ padding: "4px 0" }}>
              {topProducts.map((tp: any) => (
                <div key={tp.product.id} className="flex items-center gap-3" style={{ padding: "10px 16px", borderBottom: "1px solid #F9FAFB" }}>
                  <div className="w-11 h-11 rounded-lg flex-shrink-0 overflow-hidden" style={{ background: "#F3F4F6", border: "1px solid #EFEFEF" }}>
                    {tp.product.image ? (
                      <img src={tp.product.image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: "14px", fontWeight: 500, color: "#0A0A0A" }} className="truncate">{tp.product.name}</p>
                    <div className="flex gap-2" style={{ fontSize: "12px", color: "#9CA3AF" }}>
                      <span>{tp.totalQuantity} шт. / {tp.orderCount} зам.</span>
                      {tp.product.sku && <span>| {tp.product.sku}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{formatPrice(tp.product.price)}</p>
                    <p style={{ fontSize: "11px", color: tp.product.stock > 0 ? "#16A34A" : "#DC2626" }}>
                      {tp.product.stock > 0 ? `${tp.product.stock} шт.` : "Немає"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sales history */}
        <div className="bg-white rounded-2xl mb-3" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between" style={{ padding: "14px 16px", borderBottom: "1px solid #F3F4F6" }}>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>Останні замовлення</p>
            <p style={{ fontSize: "13px", color: "#6B7280" }}>{sales.count} підтв. / {formatPrice(sales.totalAmount)}</p>
          </div>
          {sales.items.length > 0 ? (
            <div style={{ padding: "4px 0" }}>
              {sales.items.slice(0, 10).map((s: any) => (
                <Link key={s.id} href={`/sales/orders/${s.id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                  <div style={{ padding: "10px 16px", borderBottom: "1px solid #F9FAFB" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{s.number}</span>
                        <span style={{
                          fontSize: "11px", fontWeight: 500,
                          padding: "2px 6px", borderRadius: "4px",
                          background: STATUS_BG[s.status], color: STATUS_COLOR[s.status],
                        }}>
                          {STATUS_LABELS[s.status]}
                        </span>
                      </div>
                      <div className="text-right">
                        <p style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>{formatPrice(s.totalAmount)}</p>
                        <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{formatDate(s.createdAt)}</p>
                      </div>
                    </div>
                    {/* Product thumbnails */}
                    {s.items && s.items.length > 0 && (
                      <div className="flex gap-2 mt-1.5">
                        {s.items.slice(0, 4).map((item: any) => (
                          <div key={item.id} className="flex items-center gap-1.5" style={{ maxWidth: "45%", minWidth: 0 }}>
                            <div className="w-7 h-7 rounded flex-shrink-0 overflow-hidden" style={{ background: "#F3F4F6", border: "1px solid #EFEFEF" }}>
                              {item.product?.image ? (
                                <img src={item.product.image} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                                  </svg>
                                </div>
                              )}
                            </div>
                            <span style={{ fontSize: "11px", color: "#6B7280" }} className="truncate">{item.quantity}x {item.product?.name}</span>
                          </div>
                        ))}
                        {s.items.length > 4 && (
                          <span style={{ fontSize: "11px", color: "#9CA3AF", alignSelf: "center" }}>+{s.items.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: "13px", color: "#9CA3AF", padding: "20px 16px", textAlign: "center" }}>Замовлень поки немає</p>
          )}
        </div>

        {/* Action button */}
        <Link href={`/sales/new?clientId=${id}`}
          className="flex items-center justify-center gap-2 w-full"
          style={{
            background: "linear-gradient(135deg, #FFD600 0%, #FFA000 100%)",
            color: "#0A0A0A", padding: "14px", borderRadius: "14px",
            fontWeight: 700, fontSize: "16px", textDecoration: "none",
            boxShadow: "0 4px 16px rgba(255,214,0,0.3)",
          }}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Нове замовлення
        </Link>
      </div>
    </div>
  );
}
