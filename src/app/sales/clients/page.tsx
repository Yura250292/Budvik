"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";

const AVATAR_COLORS = ["#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B", "#22C55E", "#EF4444", "#06B6D4"];

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
    fetch(`/api/erp/counterparties?${params}`)
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setClients(arr.filter((c: any) => c.type === "CUSTOMER" || c.type === "BOTH"));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [session, search]);

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  const getColor = (name: string) => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50" style={{
        background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "0",
      }}>
        <div style={{ height: "2px", background: "linear-gradient(to right, transparent, #FFD600, transparent)" }} />
        <div className="max-w-lg mx-auto flex items-center gap-3" style={{ padding: "12px 16px" }}>
          <Link href="/sales" className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.08)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.7)" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 style={{ fontSize: "20px", fontWeight: 700, flex: 1, color: "white" }}>Клієнти</h1>
          <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>{clients.length}</span>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: "12px", paddingBottom: "100px" }}>
        {/* Search */}
        <div className="mb-4 relative">
          <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            placeholder="Пошук клієнта..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
            style={{
              padding: "12px 16px 12px 44px", borderRadius: "14px", border: "1px solid #E5E7EB",
              fontSize: "15px", background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
            }}
          />
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : clients.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "#F3F4F6" }}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <p style={{ color: "#9CA3AF", fontSize: "15px" }}>Клієнтів не знайдено</p>
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((c) => {
              const color = getColor(c.name);
              return (
                <Link key={c.id} href={`/sales/clients/${c.id}`}
                  className="flex items-center gap-3 bg-white rounded-2xl p-4"
                  style={{ border: "1px solid #EFEFEF", textDecoration: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                  <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: `${color}15`, color, fontWeight: 700, fontSize: "16px" }}>
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }} className="truncate">{c.name}</p>
                    <div className="flex gap-2 items-center">
                      {c.code && <span style={{ fontSize: "12px", color: "#9CA3AF", background: "#F3F4F6", padding: "1px 6px", borderRadius: "4px" }}>{c.code}</span>}
                      {c.phone && <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{c.phone}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {(c._count?.salesDocuments || 0) > 0 && (
                      <p style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>{c._count.salesDocuments} док.</p>
                    )}
                  </div>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
