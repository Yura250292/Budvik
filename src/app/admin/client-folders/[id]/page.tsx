"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

export default function ClientFolderDetailPage() {
  const { data: session } = useSession();
  const { id } = useParams<{ id: string }>();
  const [folder, setFolder] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Edit name
  const [editName, setEditName] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // Search & add client
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [addLoading, setAddLoading] = useState<string | null>(null);

  const role = (session?.user as any)?.role;

  const fetchFolder = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/client-folders/${id}`);
    const data = await res.json();
    setFolder(data);
    setNewName(data.name || "");
    setNewDesc(data.description || "");
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (["ADMIN", "MANAGER"].includes(role) && id) fetchFolder();
  }, [role, id, fetchFolder]);

  const searchClients = async (q: string) => {
    setSearchQ(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    const res = await fetch(`/api/erp/counterparties?search=${encodeURIComponent(q)}&limit=15`);
    const data = await res.json();
    // Filter out already-added clients
    const existingIds = new Set((folder?.items || []).map((i: any) => i.counterpartyId));
    setSearchResults((Array.isArray(data) ? data : []).filter((c: any) => !existingIds.has(c.id)));
    setSearchLoading(false);
  };

  const addClient = async (counterpartyId: string) => {
    setAddLoading(counterpartyId);
    await fetch(`/api/admin/client-folders/${id}/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterpartyId }),
    });
    setAddLoading(null);
    setSearchQ("");
    setSearchResults([]);
    fetchFolder();
  };

  const removeClient = async (itemId: string) => {
    await fetch(`/api/admin/client-folders/${id}/clients`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    fetchFolder();
  };

  const updateFolder = async () => {
    await fetch(`/api/admin/client-folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, description: newDesc }),
    });
    setEditName(false);
    fetchFolder();
  };

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin/client-folders" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              {editName ? (
                <div className="flex items-center gap-2">
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                    style={{ fontSize: "20px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px", border: "1px solid #D1D5DB", width: "200px" }} />
                  <button onClick={updateFolder} style={{ padding: "4px 12px", borderRadius: "6px", background: "#16A34A", color: "white", fontWeight: 600, fontSize: "13px", border: "none" }}>OK</button>
                  <button onClick={() => setEditName(false)} style={{ padding: "4px 12px", borderRadius: "6px", background: "#F3F4F6", fontWeight: 600, fontSize: "13px", border: "none" }}>✕</button>
                </div>
              ) : (
                <h1 onClick={() => setEditName(true)} className="cursor-pointer hover:underline"
                  style={{ fontSize: "24px", fontWeight: 700, color: "#0A0A0A" }}>
                  {folder?.name || "..."} <span style={{ fontSize: "14px", color: "#9CA3AF", fontWeight: 400 }}>✎</span>
                </h1>
              )}
              <p style={{ fontSize: "13px", color: "#6B7280" }}>{folder?.items?.length || 0} клієнтів у папці</p>
            </div>
          </div>
          <button onClick={() => setShowSearch(!showSearch)}
            style={{ padding: "8px 16px", borderRadius: "10px", fontWeight: 600, fontSize: "14px",
              background: "#2563EB", color: "white", border: "none" }}>
            + Додати клієнта
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6" style={{ paddingTop: "16px", paddingBottom: "40px" }}>
        {/* Description */}
        {editName && (
          <div className="mb-4">
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Опис папки..."
              style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", fontSize: "14px" }} />
          </div>
        )}
        {!editName && folder?.description && (
          <p style={{ fontSize: "14px", color: "#6B7280", marginBottom: "16px" }}>{folder.description}</p>
        )}

        {/* Search & add */}
        {showSearch && (
          <div className="bg-white rounded-xl p-5 mb-6" style={{ border: "1px solid #EFEFEF" }}>
            <input value={searchQ} onChange={(e) => searchClients(e.target.value)} autoFocus
              placeholder="Пошук контрагента за назвою, телефоном..."
              style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #D1D5DB", fontSize: "14px" }} />
            {searchLoading && <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "6px" }}>Пошук...</p>}
            {searchResults.length > 0 && (
              <div className="mt-3 space-y-1" style={{ maxHeight: "300px", overflowY: "auto" }}>
                {searchResults.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: "14px", fontWeight: 600 }}>{c.name}</p>
                      <p style={{ fontSize: "12px", color: "#6B7280" }}>
                        {[c.address, c.phone].filter(Boolean).join(" | ")}
                      </p>
                    </div>
                    <button onClick={() => addClient(c.id)} disabled={addLoading === c.id}
                      style={{ padding: "6px 14px", borderRadius: "8px", fontWeight: 600, fontSize: "13px",
                        background: "#16A34A", color: "white", border: "none", opacity: addLoading === c.id ? 0.5 : 1 }}>
                      {addLoading === c.id ? "..." : "+ Додати"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Client list */}
        {loading ? (
          <div className="text-center py-12" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : (folder?.items || []).length === 0 ? (
          <div className="text-center py-16">
            <p style={{ color: "#9CA3AF", fontSize: "15px" }}>Папка порожня. Додайте клієнтів.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
            <table style={{ width: "100%", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                  <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>#</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Клієнт</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Адреса</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Телефон</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Контактна особа</th>
                  <th style={{ padding: "10px 20px", textAlign: "center", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}></th>
                </tr>
              </thead>
              <tbody>
                {folder.items.map((item: any, idx: number) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #F9FAFB" }}>
                    <td style={{ padding: "10px 20px", color: "#9CA3AF", fontWeight: 600 }}>{idx + 1}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 600 }}>{item.counterparty?.name}</td>
                    <td style={{ padding: "10px 16px", color: "#6B7280", maxWidth: "200px" }} className="truncate">{item.counterparty?.address || "—"}</td>
                    <td style={{ padding: "10px 16px", color: "#6B7280" }}>{item.counterparty?.phone || "—"}</td>
                    <td style={{ padding: "10px 16px", color: "#6B7280" }}>{item.counterparty?.contactPerson || "—"}</td>
                    <td style={{ padding: "10px 20px", textAlign: "center" }}>
                      <button onClick={() => removeClient(item.id)}
                        style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                          background: "#FEF2F2", color: "#DC2626", border: "none" }}>
                        Видалити
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
