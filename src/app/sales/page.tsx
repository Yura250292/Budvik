"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

export default function SalesDashboard() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const role = (session?.user as any)?.role;
  const userName = (session?.user as any)?.name || "Торговий";

  useEffect(() => {
    if (!session) return;
    Promise.all([
      fetch("/api/erp/sales").then((r) => r.json()),
      fetch("/api/erp/commissions/my").then((r) => r.json()),
    ]).then(([sales, commissions]) => {
      const docs = Array.isArray(sales) ? sales : [];
      const today = new Date().toDateString();
      const todaySales = docs.filter((d: any) => new Date(d.createdAt).toDateString() === today);
      const confirmed = docs.filter((d: any) => d.status === "CONFIRMED");

      setStats({
        totalDocs: docs.length,
        todayCount: todaySales.length,
        todayAmount: todaySales.reduce((s: number, d: any) => s + d.totalAmount, 0),
        confirmedCount: confirmed.length,
        confirmedAmount: confirmed.reduce((s: number, d: any) => s + d.totalAmount, 0),
        drafts: docs.filter((d: any) => d.status === "DRAFT").length,
        commission: commissions.summary || {},
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [session]);

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #FFD600 0%, #FFA000 100%)", padding: "24px 20px 32px" }}>
        <div className="max-w-lg mx-auto">
          <p style={{ fontSize: "14px", color: "rgba(0,0,0,0.5)" }}>Budvik ERP</p>
          <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#0A0A0A" }}>
            {userName}
          </h1>
          {!loading && stats && (
            <div className="mt-3 flex gap-4">
              <div>
                <p style={{ fontSize: "12px", color: "rgba(0,0,0,0.5)" }}>Сьогодні</p>
                <p style={{ fontSize: "20px", fontWeight: 700 }}>{formatPrice(stats.todayAmount)}</p>
                <p style={{ fontSize: "12px", color: "rgba(0,0,0,0.5)" }}>{stats.todayCount} документів</p>
              </div>
              <div style={{ borderLeft: "1px solid rgba(0,0,0,0.15)", paddingLeft: "16px" }}>
                <p style={{ fontSize: "12px", color: "rgba(0,0,0,0.5)" }}>Комісія</p>
                <p style={{ fontSize: "20px", fontWeight: 700 }}>{formatPrice(stats.commission.totalCommission || 0)}</p>
                <p style={{ fontSize: "12px", color: "rgba(0,0,0,0.5)" }}>до виплати: {formatPrice(stats.commission.pendingCommission || 0)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4" style={{ marginTop: "-16px", paddingBottom: "100px" }}>
        {/* Quick action */}
        <Link href="/sales/new"
          className="block w-full text-center"
          style={{
            background: "#0A0A0A", color: "white", padding: "16px", borderRadius: "16px",
            fontWeight: 700, fontSize: "17px", marginBottom: "20px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          }}>
          + Нове замовлення
        </Link>

        {/* Stats cards */}
        {loading ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : stats && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
              <p style={{ fontSize: "12px", color: "#6B7280" }}>Всього продажів</p>
              <p style={{ fontSize: "22px", fontWeight: 700 }}>{formatPrice(stats.confirmedAmount)}</p>
              <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{stats.confirmedCount} підтверджених</p>
            </div>
            <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
              <p style={{ fontSize: "12px", color: "#6B7280" }}>Чернетки</p>
              <p style={{ fontSize: "22px", fontWeight: 700 }}>{stats.drafts}</p>
              <p style={{ fontSize: "12px", color: "#9CA3AF" }}>потребують підтвердження</p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="space-y-3">
          {[
            { href: "/sales/new", icon: "M12 4v16m8-8H4", title: "Нове замовлення", desc: "Створити документ продажу", color: "#22C55E" },
            { href: "/sales/clients", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", title: "Клієнти", desc: "Список контрагентів та дебіторка", color: "#3B82F6" },
            { href: "/sales/orders", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", title: "Мої документи", desc: "Історія продажів", color: "#8B5CF6" },
            { href: "/dashboard/commissions", icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z", title: "Мої комісії", desc: "Заробіток та виплати", color: "#F59E0B" },
          ].map((item) => (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-4 bg-white rounded-xl p-4"
              style={{ border: "1px solid #EFEFEF", textDecoration: "none" }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${item.color}15` }}>
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke={item.color} strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: "16px", fontWeight: 600, color: "#0A0A0A" }}>{item.title}</p>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>{item.desc}</p>
              </div>
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
