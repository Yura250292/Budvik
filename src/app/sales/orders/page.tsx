"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = { DRAFT: "Чернетка", CONFIRMED: "Підтверджений", CANCELLED: "Скасований" };
const STATUS_BG: Record<string, string> = { DRAFT: "#FFF8E1", CONFIRMED: "#E8F5E9", CANCELLED: "#FFEAEA" };
const STATUS_COLOR: Record<string, string> = { DRAFT: "#B8860B", CONFIRMED: "#2E7D32", CANCELLED: "#C62828" };

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
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "12px 16px" }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/sales" className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#F3F4F6" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 style={{ fontSize: "20px", fontWeight: 700, flex: 1 }}>Мої документи</h1>
          <Link href="/sales/new" className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#22C55E" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: "12px", paddingBottom: "40px" }}>
        {/* Filters */}
        <div className="flex gap-2 mb-4 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          {[
            { key: "", label: "Всі" },
            { key: "DRAFT", label: "Чернетки" },
            { key: "CONFIRMED", label: "Підтверджені" },
            { key: "CANCELLED", label: "Скасовані" },
          ].map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                padding: "7px 14px", borderRadius: "20px", fontSize: "13px", fontWeight: 500,
                whiteSpace: "nowrap", border: "1px solid",
                background: filter === f.key ? "#0A0A0A" : "white",
                color: filter === f.key ? "white" : "#6B7280",
                borderColor: filter === f.key ? "#0A0A0A" : "#E5E7EB",
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
            <p style={{ color: "#9CA3AF", marginBottom: "12px" }}>Документів не знайдено</p>
            <Link href="/sales/new" style={{ color: "#22C55E", fontWeight: 600, fontSize: "14px" }}>
              Створити перший
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link key={o.id} href={`/admin/erp/sales/${o.id}`}
                className="block bg-white rounded-xl p-4"
                style={{ border: "1px solid #EFEFEF", textDecoration: "none" }}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}>{o.number}</span>
                  <span style={{
                    fontSize: "12px", fontWeight: 500, padding: "2px 8px", borderRadius: "6px",
                    background: STATUS_BG[o.status], color: STATUS_COLOR[o.status],
                  }}>
                    {STATUS_LABELS[o.status]}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p style={{ fontSize: "14px", color: "#6B7280" }}>{o.counterparty?.name || "Без клієнта"}</p>
                    <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{formatDate(o.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p style={{ fontSize: "18px", fontWeight: 700 }}>{formatPrice(o.totalAmount)}</p>
                    <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{o._count?.items || 0} позицій</p>
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
