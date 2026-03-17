"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Tab = "regions" | "clients" | "categories";

export default function SalesRepDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const userId = params.id as string;

  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("regions");
  const [loading, setLoading] = useState(true);

  // Regions
  const [regions, setRegions] = useState<any[]>([]);
  const [newRegion, setNewRegion] = useState("");

  // Clients
  const [assignedClients, setAssignedClients] = useState<any[]>([]);
  const [allClients, setAllClients] = useState<any[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientPicker, setShowClientPicker] = useState(false);

  // Categories
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [catSaving, setCatSaving] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const role = (session?.user as any)?.role;

  // Load user info
  useEffect(() => {
    if (!["ADMIN", "MANAGER"].includes(role)) return;
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        const u = (Array.isArray(data) ? data : []).find((u: any) => u.id === userId);
        setUser(u || null);
        setLoading(false);
      });
  }, [role, userId]);

  // Load tab data
  const loadRegions = useCallback(async () => {
    const res = await fetch(`/api/admin/sales-reps/${userId}/regions`);
    setRegions(await res.json());
  }, [userId]);

  const loadClients = useCallback(async () => {
    const [assignedRes, allRes] = await Promise.all([
      fetch(`/api/admin/sales-reps/${userId}/clients`),
      fetch("/api/erp/counterparties"),
    ]);
    setAssignedClients(await assignedRes.json());
    const all = await allRes.json();
    setAllClients(Array.isArray(all) ? all.filter((c: any) => c.type === "CUSTOMER" || c.type === "BOTH") : []);
  }, [userId]);

  const loadCategories = useCallback(async () => {
    const [accessRes, catRes] = await Promise.all([
      fetch(`/api/admin/sales-reps/${userId}/categories`),
      fetch("/api/categories"),
    ]);
    const access = await accessRes.json();
    const cats = await catRes.json();
    setAllCategories(Array.isArray(cats) ? cats : []);
    setSelectedCategoryIds(Array.isArray(access) ? access.map((a: any) => a.categoryId) : []);
  }, [userId]);

  useEffect(() => {
    if (!["ADMIN", "MANAGER"].includes(role)) return;
    if (tab === "regions") loadRegions();
    if (tab === "clients") loadClients();
    if (tab === "categories") loadCategories();
  }, [tab, role, loadRegions, loadClients, loadCategories]);

  // Actions
  const addRegion = async () => {
    if (!newRegion.trim()) return;
    setActionLoading(true);
    await fetch(`/api/admin/sales-reps/${userId}/regions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: newRegion }),
    });
    setNewRegion("");
    await loadRegions();
    setActionLoading(false);
  };

  const removeRegion = async (regionId: string) => {
    await fetch(`/api/admin/sales-reps/${userId}/regions`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regionId }),
    });
    loadRegions();
  };

  const assignClient = async (counterpartyId: string) => {
    setActionLoading(true);
    await fetch(`/api/admin/sales-reps/${userId}/clients`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterpartyId }),
    });
    setShowClientPicker(false);
    await loadClients();
    setActionLoading(false);
  };

  const removeClient = async (assignmentId: string) => {
    await fetch(`/api/admin/sales-reps/${userId}/clients`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    loadClients();
  };

  const toggleCategory = (catId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  const saveCategories = async () => {
    setCatSaving(true);
    await fetch(`/api/admin/sales-reps/${userId}/categories`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIds: selectedCategoryIds }),
    });
    setCatSaving(false);
  };

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }
  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ color: "#9CA3AF" }}>Завантаження...</div>;
  if (!user) return <div className="min-h-screen flex items-center justify-center"><p>Користувача не знайдено</p></div>;

  const assignedClientIds = new Set(assignedClients.map((c: any) => c.counterpartyId));
  const availableClients = allClients.filter((c) =>
    !assignedClientIds.has(c.id) &&
    (!clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase()))
  );

  const TABS = [
    { key: "regions" as Tab, label: "Регіони", icon: "M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" },
    { key: "clients" as Tab, label: "Клієнти", icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" },
    { key: "categories" as Tab, label: "Категорії товарів", icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link href="/admin/sales-reps" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0A0A0A" }}>{user.name}</h1>
            <p style={{ fontSize: "13px", color: "#6B7280" }}>{user.email} {user.phone && `| ${user.phone}`}</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6" style={{ paddingTop: "16px", paddingBottom: "40px" }}>
        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-2"
              style={{
                padding: "10px 18px", borderRadius: "12px", fontSize: "14px", fontWeight: 600,
                whiteSpace: "nowrap", border: "none",
                background: tab === t.key ? "#0A0A0A" : "white",
                color: tab === t.key ? "#FFD600" : "#6B7280",
                boxShadow: tab === t.key ? "0 2px 8px rgba(0,0,0,0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
              }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
              </svg>
              {t.label}
            </button>
          ))}
        </div>

        {/* === REGIONS TAB === */}
        {tab === "regions" && (
          <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>Регіони / Міста</h2>
            <p style={{ fontSize: "13px", color: "#9CA3AF", marginBottom: "16px" }}>
              Території на яких працює торговий представник
            </p>

            {/* Add region */}
            <div className="flex gap-2 mb-4">
              <input value={newRegion} onChange={(e) => setNewRegion(e.target.value)}
                placeholder="Напр: Львів, Радехів..."
                onKeyDown={(e) => e.key === "Enter" && addRegion()}
                style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              <button onClick={addRegion} disabled={actionLoading || !newRegion.trim()}
                style={{
                  padding: "10px 20px", borderRadius: "10px", fontWeight: 600, fontSize: "14px",
                  background: "#FFD600", color: "#0A0A0A", border: "none", opacity: !newRegion.trim() ? 0.4 : 1,
                }}>
                Додати
              </button>
            </div>

            {/* Regions list */}
            {regions.length === 0 ? (
              <p style={{ fontSize: "14px", color: "#9CA3AF", padding: "12px 0" }}>Регіони не призначені — доступ до всіх</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {regions.map((r: any) => (
                  <div key={r.id} className="flex items-center gap-2"
                    style={{ background: "#EFF6FF", padding: "6px 12px", borderRadius: "8px", fontSize: "14px", color: "#1E40AF", fontWeight: 500 }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {r.region}
                    <button onClick={() => removeRegion(r.id)} style={{ color: "#93C5FD", fontSize: "16px", padding: "0 2px", border: "none", background: "none" }}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === CLIENTS TAB === */}
        {tab === "clients" && (
          <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 style={{ fontSize: "16px", fontWeight: 700 }}>Призначені клієнти</h2>
                <p style={{ fontSize: "13px", color: "#9CA3AF" }}>Клієнти закріплені за цим торговим</p>
              </div>
              <button onClick={() => setShowClientPicker(true)}
                style={{ padding: "8px 16px", borderRadius: "8px", fontWeight: 600, fontSize: "13px", background: "#FFD600", border: "none" }}>
                + Додати клієнта
              </button>
            </div>

            {assignedClients.length === 0 ? (
              <p style={{ fontSize: "14px", color: "#9CA3AF", padding: "12px 0" }}>Клієнти не призначені — доступ до всіх</p>
            ) : (
              <div className="space-y-2">
                {assignedClients.map((ac: any) => (
                  <div key={ac.id} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "#FAFAFA", border: "1px solid #F3F4F6" }}>
                    <div>
                      <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{ac.counterparty?.name}</p>
                      {ac.counterparty?.address && <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{ac.counterparty.address}</p>}
                    </div>
                    <button onClick={() => removeClient(ac.id)}
                      style={{ color: "#DC2626", fontSize: "13px", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", border: "1px solid #FECACA", background: "#FEF2F2" }}>
                      Зняти
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Client picker modal */}
            {showClientPicker && (
              <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
                <div className="bg-white rounded-xl w-full max-w-md mx-4" style={{ maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "16px 20px", borderBottom: "1px solid #EFEFEF" }}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Обрати клієнта</h3>
                      <button onClick={() => setShowClientPicker(false)} style={{ fontSize: "20px", color: "#9CA3AF", border: "none", background: "none" }}>&times;</button>
                    </div>
                    <input type="search" placeholder="Пошук..." value={clientSearch} onChange={(e) => setClientSearch(e.target.value)}
                      autoFocus style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
                  </div>
                  <div className="flex-1 overflow-auto" style={{ padding: "8px 12px" }}>
                    {availableClients.length === 0 ? (
                      <p style={{ textAlign: "center", color: "#9CA3AF", padding: "20px", fontSize: "14px" }}>Немає доступних клієнтів</p>
                    ) : (
                      availableClients.slice(0, 50).map((c) => (
                        <button key={c.id} onClick={() => assignClient(c.id)}
                          disabled={actionLoading}
                          className="w-full text-left p-3 rounded-lg hover:bg-yellow-50 mb-1"
                          style={{ border: "1px solid #F3F4F6", fontSize: "14px" }}>
                          <p style={{ fontWeight: 500, color: "#0A0A0A" }}>{c.name}</p>
                          {c.address && <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{c.address}</p>}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* === CATEGORIES TAB === */}
        {tab === "categories" && (
          <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>Доступ до категорій товарів</h2>
            <p style={{ fontSize: "13px", color: "#9CA3AF", marginBottom: "16px" }}>
              Якщо нічого не обрано — торговий бачить всі товари. Оберіть конкретні категорії для обмеження.
            </p>

            {allCategories.length === 0 ? (
              <p style={{ color: "#9CA3AF", fontSize: "14px" }}>Категорії не знайдено</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                  {allCategories.map((cat: any) => {
                    const isSelected = selectedCategoryIds.includes(cat.id);
                    return (
                      <label key={cat.id}
                        className="flex items-center gap-3 p-3 rounded-lg cursor-pointer"
                        style={{
                          border: isSelected ? "2px solid #FFD600" : "1px solid #E5E7EB",
                          background: isSelected ? "#FFFBEB" : "white",
                        }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleCategory(cat.id)}
                          style={{ width: "18px", height: "18px", accentColor: "#FFD600" }} />
                        <div>
                          <p style={{ fontSize: "14px", fontWeight: 500, color: "#0A0A0A" }}>{cat.name}</p>
                          <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{cat.slug}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={saveCategories} disabled={catSaving}
                    style={{
                      padding: "10px 24px", borderRadius: "10px", fontWeight: 700, fontSize: "14px",
                      background: "#FFD600", color: "#0A0A0A", border: "none", opacity: catSaving ? 0.5 : 1,
                    }}>
                    {catSaving ? "Зберігаю..." : "Зберегти доступ"}
                  </button>
                  {selectedCategoryIds.length > 0 && (
                    <span style={{ fontSize: "13px", color: "#6B7280" }}>
                      Обрано: {selectedCategoryIds.length} з {allCategories.length}
                    </span>
                  )}
                  {selectedCategoryIds.length === 0 && (
                    <span style={{ fontSize: "13px", color: "#16A34A" }}>Доступ до всіх категорій</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
