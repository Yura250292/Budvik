"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

export default function ClientFoldersPage() {
  const { data: session } = useSession();
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const role = (session?.user as any)?.role;

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/client-folders");
    const data = await res.json();
    setFolders(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (["ADMIN", "MANAGER"].includes(role)) fetchFolders();
  }, [role, fetchFolders]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    await fetch("/api/admin/client-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
    });
    setNewName(""); setNewDesc(""); setShowNew(false);
    setSaving(false);
    fetchFolders();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Видалити папку "${name}"? Клієнти залишаться в базі.`)) return;
    await fetch(`/api/admin/client-folders/${id}`, { method: "DELETE" });
    fetchFolders();
  };

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
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Папки клієнтів</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Шаблони напрямків для швидкого призначення торговим</p>
            </div>
          </div>
          <button onClick={() => setShowNew(!showNew)}
            style={{ padding: "8px 16px", borderRadius: "10px", fontWeight: 600, fontSize: "14px",
              background: "#FFD600", color: "#0A0A0A", border: "none" }}>
            + Нова папка
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6" style={{ paddingTop: "20px", paddingBottom: "40px" }}>
        {/* Create form */}
        {showNew && (
          <div className="bg-white rounded-xl p-5 mb-6" style={{ border: "1px solid #EFEFEF" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Нова папка</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Назва *</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="Радехів" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px",
                    border: "1px solid #D1D5DB", fontSize: "14px", marginTop: "4px" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Опис</label>
                <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="12 клієнтів основних + супутні" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px",
                    border: "1px solid #D1D5DB", fontSize: "14px", marginTop: "4px" }} />
              </div>
              <div className="flex items-end">
                <button onClick={handleCreate} disabled={saving || !newName.trim()}
                  style={{ padding: "8px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px",
                    background: "#16A34A", color: "white", border: "none", opacity: saving ? 0.5 : 1 }}>
                  {saving ? "..." : "Створити"}
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : folders.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "#FEF3C7" }}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#D97706" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <p style={{ color: "#6B7280", fontSize: "15px" }}>Папок ще немає</p>
            <p style={{ color: "#9CA3AF", fontSize: "13px", marginTop: "4px" }}>Створіть першу папку-напрямок для групування клієнтів</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {folders.map((f) => (
              <div key={f.id} className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <Link href={`/admin/client-folders/${f.id}`} style={{ textDecoration: "none" }}>
                  <div style={{ padding: "16px 20px" }}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "#FEF3C7" }}>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#D97706" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }} className="truncate">{f.name}</p>
                        <p style={{ fontSize: "13px", color: "#6B7280" }}>{f._count?.items || 0} клієнтів</p>
                      </div>
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                    {f.description && <p style={{ fontSize: "13px", color: "#9CA3AF" }} className="truncate">{f.description}</p>}
                  </div>
                </Link>
                <div style={{ padding: "8px 20px 12px", borderTop: "1px solid #F3F4F6" }}>
                  <button onClick={() => handleDelete(f.id, f.name)}
                    style={{ fontSize: "12px", color: "#DC2626", background: "none", border: "none", fontWeight: 600, cursor: "pointer" }}>
                    Видалити
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
