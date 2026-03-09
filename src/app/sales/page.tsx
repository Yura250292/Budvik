"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
      {/* Dark branded header */}
      <div style={{
        background: "linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)",
        padding: "20px 20px 40px",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Gold accent line */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "2px",
          background: "linear-gradient(to right, transparent, #FFD600, transparent)",
        }} />
        {/* Subtle gold glow */}
        <div style={{
          position: "absolute", top: "-50px", right: "-30px",
          width: "200px", height: "200px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,214,0,0.08) 0%, transparent 70%)",
        }} />

        <div className="max-w-lg mx-auto relative">
          <div className="flex items-center gap-3 mb-4">
            <Image src="/logo-gold.png" alt="Budvik" width={36} height={36} className="h-9 w-auto" />
            <div>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                Торговий портал
              </p>
              <h1 style={{ fontSize: "22px", fontWeight: 700, color: "white" }}>{userName}</h1>
            </div>
          </div>

          {!loading && stats && (
            <div className="flex gap-3 mt-2">
              <div style={{
                flex: 1, background: "rgba(255,255,255,0.06)", borderRadius: "14px",
                padding: "14px", border: "1px solid rgba(255,255,255,0.08)",
              }}>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>Сьогодні</p>
                <p style={{ fontSize: "22px", fontWeight: 700, color: "#FFD600" }}>{formatPrice(stats.todayAmount)}</p>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>{stats.todayCount} док.</p>
              </div>
              <div style={{
                flex: 1, background: "rgba(255,255,255,0.06)", borderRadius: "14px",
                padding: "14px", border: "1px solid rgba(255,255,255,0.08)",
              }}>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>Комісія</p>
                <p style={{ fontSize: "22px", fontWeight: 700, color: "#22C55E" }}>{formatPrice(stats.commission.totalCommission || 0)}</p>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>
                  очікує: {formatPrice(stats.commission.pendingCommission || 0)}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4" style={{ marginTop: "-20px", paddingBottom: "100px" }}>
        {/* Quick action CTA */}
        <Link href="/sales/new"
          className="flex items-center justify-center gap-2 w-full"
          style={{
            background: "linear-gradient(135deg, #FFD600 0%, #FFA000 100%)",
            color: "#0A0A0A", padding: "16px", borderRadius: "16px",
            fontWeight: 700, fontSize: "17px", marginBottom: "24px",
            boxShadow: "0 8px 32px rgba(255,214,0,0.3)",
            textDecoration: "none",
          }}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Нове замовлення
        </Link>

        {/* Stats grid */}
        {loading ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : stats && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-white rounded-2xl p-4" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "#F0FDF4" }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
              </div>
              <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "2px" }}>Всього продажів</p>
              <p style={{ fontSize: "22px", fontWeight: 700, color: "#0A0A0A" }}>{formatPrice(stats.confirmedAmount)}</p>
              <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{stats.confirmedCount} підтверджених</p>
            </div>
            <div className="bg-white rounded-2xl p-4" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "#FFF7ED" }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#F59E0B" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "2px" }}>Чернетки</p>
              <p style={{ fontSize: "22px", fontWeight: 700, color: "#0A0A0A" }}>{stats.drafts}</p>
              <p style={{ fontSize: "11px", color: "#9CA3AF" }}>потребують підтвердження</p>
            </div>
          </div>
        )}

        {/* Quick navigation */}
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#9CA3AF", marginBottom: "12px", letterSpacing: "0.5px", textTransform: "uppercase" }}>
          Меню
        </p>
        <div className="space-y-2">
          {[
            { href: "/sales/new", icon: "M12 4v16m8-8H4", title: "Нове замовлення", desc: "Створити документ продажу", gradient: "linear-gradient(135deg, #22C55E, #16A34A)" },
            { href: "/sales/clients", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", title: "Клієнти", desc: "Контрагенти та дебіторка", gradient: "linear-gradient(135deg, #3B82F6, #2563EB)" },
            { href: "/sales/orders", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", title: "Мої документи", desc: "Історія продажів", gradient: "linear-gradient(135deg, #8B5CF6, #7C3AED)" },
            { href: "/dashboard/commissions", icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z", title: "Мої комісії", desc: "Заробіток та виплати", gradient: "linear-gradient(135deg, #F59E0B, #D97706)" },
          ].map((item) => (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-4 bg-white rounded-2xl p-4"
              style={{ border: "1px solid #EFEFEF", textDecoration: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: item.gradient }}>
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: "16px", fontWeight: 600, color: "#0A0A0A" }}>{item.title}</p>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>{item.desc}</p>
              </div>
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
