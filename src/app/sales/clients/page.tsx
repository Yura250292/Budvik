"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function ClientsPage() {
  const { data: session } = useSession();
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    // Show customers and both
    fetch(`/api/erp/counterparties?${params}`)
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        // Filter to CUSTOMER and BOTH types for sales reps
        setClients(arr.filter((c: any) => c.type === "CUSTOMER" || c.type === "BOTH"));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [session, search]);

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "12px 16px" }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/sales" className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#F3F4F6" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 style={{ fontSize: "20px", fontWeight: 700, flex: 1 }}>Клієнти</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: "12px", paddingBottom: "40px" }}>
        {/* Search */}
        <div className="mb-4">
          <input
            type="search"
            placeholder="Пошук клієнта..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
            style={{
              padding: "12px 16px", borderRadius: "12px", border: "1px solid #E5E7EB",
              fontSize: "15px", background: "white",
            }}
          />
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : clients.length === 0 ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Клієнтів не знайдено</div>
        ) : (
          <div className="space-y-2">
            {clients.map((c) => (
              <Link key={c.id} href={`/sales/clients/${c.id}`}
                className="flex items-center gap-3 bg-white rounded-xl p-4"
                style={{ border: "1px solid #EFEFEF", textDecoration: "none" }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "#EFF6FF", color: "#3B82F6", fontWeight: 700, fontSize: "15px" }}>
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }} className="truncate">{c.name}</p>
                  <div className="flex gap-3">
                    {c.code && <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{c.code}</span>}
                    {c.phone && <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{c.phone}</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p style={{ fontSize: "12px", color: "#6B7280" }}>{c._count?.salesDocuments || 0} док.</p>
                  {c._count?.invoices > 0 && (
                    <p style={{ fontSize: "12px", color: "#6B7280" }}>{c._count.invoices} накл.</p>
                  )}
                </div>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
