"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function SalesRepsAdminPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
            {users.map((u) => (
              <Link key={u.id} href={`/admin/sales-reps/${u.id}`}
                className="bg-white rounded-xl p-5 hover:shadow-md transition-shadow"
                style={{ border: "1px solid #EFEFEF", textDecoration: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-4">
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
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
