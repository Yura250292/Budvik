"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

type AttainmentRow = {
  repId: string;
  brandId: string | null;
  actual: number;
  target: number;
  attainment: number;
};

export default function SalesRepsAdminPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Оборот і % плану за поточний місяць, ключ — repId.
  // Джерело те саме, що й у «Аналітиці торгових» (lib/analytics/facts.ts),
  // тож цифри тут і там збігаються.
  const [totals, setTotals] = useState<Map<string, AttainmentRow>>(new Map());

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (!["ADMIN", "MANAGER"].includes(role)) return;
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        setUsers((Array.isArray(data) ? data : []).filter((u: any) => u.role === "SALES"));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [role]);

  useEffect(() => {
    if (!["ADMIN", "MANAGER"].includes(role)) return;
    // Показники — річ допоміжна: якщо ендпоінт впаде, список торгових
    // усе одно має відкритися, тож помилку просто ковтаємо.
    fetch("/api/admin/sales-plans/attainment")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const rows: AttainmentRow[] = Array.isArray(data?.rows) ? data.rows : [];
        // brandId === null — це підсумковий рядок по торговому (не по бренду).
        setTotals(new Map(rows.filter((r) => r.brandId === null).map((r) => [r.repId, r])));
      })
      .catch(() => {});
  }, [role]);

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Торгові представники</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Призначення регіонів, клієнтів, категорій товарів</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {loading ? (
          <div className="text-center py-12" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-12"><p style={{ color: "#9CA3AF" }}>Торгових не знайдено. Створіть користувача з роллю SALES.</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {users.map((u) => {
              const t = totals.get(u.id);
              return (
              <div key={u.id} className="bg-white rounded-xl p-5"
                style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <Link href={`/admin/sales-reps/${u.id}`}
                  className="flex items-center gap-4 hover:opacity-80 transition-opacity"
                  style={{ textDecoration: "none" }}>
                  <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "#FFF7ED", color: "#D97706", fontWeight: 700, fontSize: "18px" }}>
                    {u.name?.charAt(0)?.toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: "16px", fontWeight: 600, color: "#0A0A0A" }} className="truncate">{u.name}</p>
                    <p style={{ fontSize: "13px", color: "#6B7280" }}>{u.email}</p>
                    {u.phone && <p style={{ fontSize: "13px", color: "#9CA3AF" }}>{u.phone}</p>}
                  </div>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>

                {/* Показники за поточний місяць */}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="rounded-lg p-3" style={{ background: "#F9FAFB" }}>
                    <p style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600 }}>ОБОРОТ ЗА МІСЯЦЬ</p>
                    <p style={{ fontSize: "18px", fontWeight: 700 }}>{formatPrice(t?.actual ?? 0)}</p>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: t && t.target > 0 ? "#F0FDF4" : "#F9FAFB" }}>
                    <p style={{ fontSize: "11px", color: t && t.target > 0 ? "#16A34A" : "#6B7280", fontWeight: 600 }}>ВИКОНАННЯ ПЛАНУ</p>
                    <p style={{ fontSize: "18px", fontWeight: 700, color: t && t.target > 0 ? "#16A34A" : "#9CA3AF" }}>
                      {t && t.target > 0 ? `${Math.round(t.attainment)}%` : "плану немає"}
                    </p>
                  </div>
                </div>

                <Link href={`/admin/sales-analytics/${u.id}`}
                  className="block mt-3 text-center"
                  style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", fontWeight: 600, color: "#0A0A0A", textDecoration: "none" }}>
                  Аналітика →
                </Link>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
