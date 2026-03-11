"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = { DRAFT: "Чернетка", CONFIRMED: "Підтверджений", CANCELLED: "Скасований" };
const STATUS_BG: Record<string, string> = { DRAFT: "#FFF7ED", CONFIRMED: "#F0FDF4", CANCELLED: "#FEF2F2" };
const STATUS_COLOR: Record<string, string> = { DRAFT: "#D97706", CONFIRMED: "#16A34A", CANCELLED: "#DC2626" };
const STATUS_BORDER: Record<string, string> = { DRAFT: "#FDE68A", CONFIRMED: "#BBF7D0", CANCELLED: "#FECACA" };

export default function OrdersPage() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<any[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    fetch(`/api/erp/sales?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setOrders(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [session, filter]);

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50" style={{
        background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ height: "2px", background: "linear-gradient(to right, transparent, #FFD600, transparent)" }} />
        <div className="max-w-lg mx-auto flex items-center gap-3" style={{ padding: "12px 16px" }}>
          <Link href="/sales" className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.08)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.7)" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 style={{ fontSize: "20px", fontWeight: 700, flex: 1, color: "white" }}>Мої документи</h1>
          <Link href="/sales/new" className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #FFD600, #FFA000)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: "12px", paddingBottom: "100px" }}>
        {/* Filters */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
          {[
            { key: "", label: "Всі" },
            { key: "DRAFT", label: "Чернетки" },
            { key: "CONFIRMED", label: "Підтверджені" },
            { key: "CANCELLED", label: "Скасовані" },
          ].map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                padding: "8px 16px", borderRadius: "12px", fontSize: "13px", fontWeight: 600,
                whiteSpace: "nowrap", border: "none",
                background: filter === f.key
                  ? "linear-gradient(135deg, #0A0A0A, #1A1A1A)"
                  : "white",
                color: filter === f.key ? "#FFD600" : "#6B7280",
                boxShadow: filter === f.key
                  ? "0 2px 8px rgba(0,0,0,0.2)"
                  : "0 1px 3px rgba(0,0,0,0.06)",
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "#F3F4F6" }}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p style={{ color: "#9CA3AF", fontSize: "15px", marginBottom: "12px" }}>Документів не знайдено</p>
            <Link href="/sales/new" style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              color: "#FFD600", fontWeight: 600, fontSize: "14px", textDecoration: "none",
              background: "#0A0A0A", padding: "8px 16px", borderRadius: "10px",
            }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Створити перший
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link key={o.id} href={`/sales/orders/${o.id}`}
                className="block bg-white rounded-2xl p-4"
                style={{
                  borderLeft: `3px solid ${STATUS_BORDER[o.status] || "#E5E7EB"}`,
                  border: `1px solid #EFEFEF`,
                  borderLeftWidth: "3px",
                  borderLeftColor: STATUS_COLOR[o.status] || "#E5E7EB",
                  textDecoration: "none",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>{o.number}</span>
                    <span style={{
                      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "6px",
                      background: STATUS_BG[o.status], color: STATUS_COLOR[o.status],
                    }}>
                      {STATUS_LABELS[o.status]}
                    </span>
                  </div>
                  <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{formatDate(o.createdAt)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p style={{ fontSize: "14px", color: "#6B7280" }}>{o.counterparty?.name || "Без клієнта"}</p>
                  <div className="text-right">
                    <p style={{ fontSize: "20px", fontWeight: 700, color: "#0A0A0A" }}>{formatPrice(o.totalAmount)}</p>
                    <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{o._count?.items || 0} позицій</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
