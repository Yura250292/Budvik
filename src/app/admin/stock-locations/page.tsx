"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

export default function StockLocationsPage() {
  const { data: session } = useSession();
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newDefault, setNewDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  // Selected location for stock view
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stocks, setStocks] = useState<any[]>([]);
  const [stockSearch, setStockSearch] = useState("");
  const [stockLoading, setStockLoading] = useState(false);

  // Edit stock
  const [editProduct, setEditProduct] = useState<{ productId: string; name: string; quantity: number } | null>(null);
  const [editQty, setEditQty] = useState("");

  // Add product to location
  const [addProductSearch, setAddProductSearch] = useState("");
  const [addProductResults, setAddProductResults] = useState<any[]>([]);
  const [addProductLoading, setAddProductLoading] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);

  const role = (session?.user as any)?.role;

  const fetchLocations = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/stock-locations");
    const data = await res.json();
    setLocations(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (["ADMIN", "MANAGER"].includes(role)) fetchLocations();
  }, [role, fetchLocations]);

  const fetchStocks = useCallback(async (locId: string, search?: string) => {
    setStockLoading(true);
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    const res = await fetch(`/api/admin/stock-locations/${locId}/stock${q}`);
    const data = await res.json();
    setStocks(Array.isArray(data) ? data : []);
    setStockLoading(false);
  }, []);

  useEffect(() => {
    if (selectedId) fetchStocks(selectedId, stockSearch);
  }, [selectedId, stockSearch, fetchStocks]);

  const handleAddLocation = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    await fetch("/api/admin/stock-locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), address: newAddress.trim(), isDefault: newDefault }),
    });
    setNewName(""); setNewAddress(""); setNewDefault(false); setShowAdd(false);
    setSaving(false);
    fetchLocations();
  };

  const handleUpdateStock = async () => {
    if (!editProduct || !selectedId) return;
    const qty = parseInt(editQty);
    if (isNaN(qty) || qty < 0) return;
    await fetch(`/api/admin/stock-locations/${selectedId}/stock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: editProduct.productId, quantity: qty }),
    });
    setEditProduct(null);
    fetchStocks(selectedId, stockSearch);
  };

  const searchProducts = async (q: string) => {
    setAddProductSearch(q);
    if (q.length < 2) { setAddProductResults([]); return; }
    setAddProductLoading(true);
    const res = await fetch(`/api/erp/products?search=${encodeURIComponent(q)}&limit=10`);
    const data = await res.json();
    setAddProductResults(Array.isArray(data) ? data : []);
    setAddProductLoading(false);
  };

  const handleAddProductToLocation = async (productId: string) => {
    if (!selectedId) return;
    await fetch(`/api/admin/stock-locations/${selectedId}/stock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, quantity: 0 }),
    });
    setShowAddProduct(false);
    setAddProductSearch("");
    setAddProductResults([]);
    fetchStocks(selectedId, stockSearch);
  };

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  const selectedLocation = locations.find((l) => l.id === selectedId);

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
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Склади та залишки</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Управління складами та залишками по локаціях</p>
            </div>
          </div>
          <button onClick={() => setShowAdd(!showAdd)}
            style={{ padding: "8px 16px", borderRadius: "10px", fontWeight: 600, fontSize: "14px",
              background: "#FFD600", color: "#0A0A0A", border: "none" }}>
            + Додати склад
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6" style={{ paddingTop: "20px", paddingBottom: "40px" }}>
        {/* Add location form */}
        {showAdd && (
          <div className="bg-white rounded-xl p-5 mb-6" style={{ border: "1px solid #EFEFEF" }}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Назва складу *</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="Основний склад" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px",
                    border: "1px solid #D1D5DB", fontSize: "14px", marginTop: "4px" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Адреса</label>
                <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="м. Вінниця, вул...." style={{ width: "100%", padding: "8px 12px", borderRadius: "8px",
                    border: "1px solid #D1D5DB", fontSize: "14px", marginTop: "4px" }} />
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2" style={{ fontSize: "14px", color: "#374151" }}>
                  <input type="checkbox" checked={newDefault} onChange={(e) => setNewDefault(e.target.checked)} />
                  Основний
                </label>
                <button onClick={handleAddLocation} disabled={saving || !newName.trim()}
                  style={{ padding: "8px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px",
                    background: "#16A34A", color: "white", border: "none", opacity: saving ? 0.5 : 1 }}>
                  {saving ? "..." : "Зберегти"}
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : locations.length === 0 ? (
          <div className="text-center py-12"><p style={{ color: "#9CA3AF" }}>Складів не знайдено. Додайте перший склад.</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {locations.map((loc) => (
              <button key={loc.id} onClick={() => { setSelectedId(loc.id); setStockSearch(""); }}
                className="bg-white rounded-xl p-5 text-left transition-shadow hover:shadow-md"
                style={{ border: selectedId === loc.id ? "2px solid #2563EB" : "1px solid #EFEFEF",
                  boxShadow: selectedId === loc.id ? "0 0 0 3px rgba(37,99,235,0.1)" : "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: loc.isDefault ? "#FEF3C7" : "#F3F4F6" }}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24"
                      stroke={loc.isDefault ? "#D97706" : "#6B7280"} strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: "16px", fontWeight: 600, color: "#0A0A0A" }} className="truncate">{loc.name}</p>
                    {loc.isDefault && (
                      <span style={{ fontSize: "11px", fontWeight: 600, padding: "1px 6px", borderRadius: "4px",
                        background: "#FEF3C7", color: "#D97706" }}>Основний</span>
                    )}
                  </div>
                </div>
                {loc.address && <p style={{ fontSize: "13px", color: "#6B7280" }} className="truncate">{loc.address}</p>}
                <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>{loc._count?.stocks || 0} товарів</p>
              </button>
            ))}
          </div>
        )}

        {/* Stock view for selected location */}
        {selectedId && selectedLocation && (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6" }}
              className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex-1">
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#0A0A0A" }}>
                  Залишки: {selectedLocation.name}
                </h2>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)}
                  placeholder="Пошук товару..." style={{ flex: 1, padding: "8px 12px", borderRadius: "8px",
                    border: "1px solid #D1D5DB", fontSize: "14px", minWidth: "200px" }} />
                <button onClick={() => setShowAddProduct(!showAddProduct)}
                  style={{ padding: "8px 14px", borderRadius: "8px", fontWeight: 600, fontSize: "13px",
                    background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE", whiteSpace: "nowrap" }}>
                  + Товар
                </button>
              </div>
            </div>

            {/* Add product modal */}
            {showAddProduct && (
              <div style={{ padding: "12px 20px", borderBottom: "1px solid #F3F4F6", background: "#F9FAFB" }}>
                <input value={addProductSearch} onChange={(e) => searchProducts(e.target.value)}
                  placeholder="Знайти товар для додавання..." autoFocus
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "8px",
                    border: "1px solid #D1D5DB", fontSize: "14px" }} />
                {addProductLoading && <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>Пошук...</p>}
                {addProductResults.length > 0 && (
                  <div className="mt-2 space-y-1" style={{ maxHeight: "200px", overflowY: "auto" }}>
                    {addProductResults.map((p) => (
                      <button key={p.id} onClick={() => handleAddProductToLocation(p.id)}
                        className="w-full text-left flex items-center gap-2 hover:bg-white rounded-lg"
                        style={{ padding: "6px 8px", fontSize: "14px" }}>
                        {p.image && <img src={p.image} alt="" style={{ width: "28px", height: "28px", borderRadius: "4px", objectFit: "cover" }} />}
                        <span className="flex-1 truncate">{p.name}</span>
                        <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{p.sku}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {stockLoading ? (
              <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
            ) : stocks.length === 0 ? (
              <div className="text-center py-8"><p style={{ color: "#9CA3AF", fontSize: "14px" }}>Товарів не знайдено</p></div>
            ) : (
              <div>
                <table style={{ width: "100%", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                      <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Товар</th>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Артикул</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Загальний залишок</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>На цьому складі</th>
                      <th style={{ padding: "10px 20px", textAlign: "center", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stocks.map((s) => (
                      <tr key={s.id} style={{ borderBottom: "1px solid #F9FAFB" }}>
                        <td style={{ padding: "10px 20px" }}>
                          <div className="flex items-center gap-2">
                            {s.product?.image && (
                              <img src={s.product.image} alt="" style={{ width: "32px", height: "32px", borderRadius: "6px", objectFit: "cover" }} />
                            )}
                            <span style={{ fontWeight: 500 }}>{s.product?.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: "10px 16px", color: "#6B7280" }}>{s.product?.sku}</td>
                        <td style={{ padding: "10px 16px", textAlign: "right" }}>{s.product?.stock ?? "—"}</td>
                        <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600 }}>{s.quantity}</td>
                        <td style={{ padding: "10px 20px", textAlign: "center" }}>
                          <button onClick={() => { setEditProduct({ productId: s.productId, name: s.product?.name, quantity: s.quantity }); setEditQty(String(s.quantity)); }}
                            style={{ padding: "4px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                              background: "#F3F4F6", color: "#374151", border: "none" }}>
                            Змінити
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Edit quantity modal */}
        {editProduct && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setEditProduct(null)}>
            <div className="bg-white rounded-2xl p-6" style={{ width: "360px", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Змінити кількість</h3>
              <p style={{ fontSize: "14px", color: "#6B7280", marginBottom: "12px" }}>{editProduct.name}</p>
              <input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)} autoFocus min="0"
                style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #D1D5DB",
                  fontSize: "16px", fontWeight: 600, textAlign: "center" }} />
              <div className="flex gap-2 mt-4">
                <button onClick={() => setEditProduct(null)}
                  style={{ flex: 1, padding: "10px", borderRadius: "10px", fontWeight: 600, fontSize: "14px",
                    background: "#F3F4F6", color: "#374151", border: "none" }}>
                  Скасувати
                </button>
                <button onClick={handleUpdateStock}
                  style={{ flex: 1, padding: "10px", borderRadius: "10px", fontWeight: 600, fontSize: "14px",
                    background: "#2563EB", color: "white", border: "none" }}>
                  Зберегти
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
