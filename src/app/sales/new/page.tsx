"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  stock: number;
  basePrice: number;
  purchasePrice: number;
  sellingPrice: number;
  quantity: number;
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center" style={{ color: "#9CA3AF" }}>Завантаження...</div>}>
      <NewOrderContent />
    </Suspense>
  );
}

function NewOrderContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const presetClientId = searchParams.get("clientId") || "";

  const [clients, setClients] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState(presetClientId);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientPicker, setShowClientPicker] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const role = (session?.user as any)?.role;

  // Load clients
  useEffect(() => {
    if (!session) return;
    fetch("/api/erp/counterparties")
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setClients(arr.filter((c: any) => c.type === "CUSTOMER" || c.type === "BOTH"));
      });
  }, [session]);

  // Search products (use ERP endpoint for purchase price)
  const searchProducts = useCallback(async (query: string) => {
    if (query.length < 2) { setProductResults([]); return; }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/erp/products?search=${encodeURIComponent(query)}&limit=20`);
      const data = await res.json();
      setProductResults(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setSearchLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchProducts(productSearch), 300);
    return () => clearTimeout(timer);
  }, [productSearch, searchProducts]);

  const addToCart = (product: any) => {
    const existing = cart.find((c) => c.productId === product.id);
    if (existing) {
      setCart(cart.map((c) => c.productId === product.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, {
        productId: product.id,
        name: product.name,
        sku: product.sku || "",
        stock: product.stock || 0,
        basePrice: product.price,
        purchasePrice: product.purchasePrice || product.wholesalePrice || 0,
        sellingPrice: product.price,
        quantity: 1,
      }]);
    }
    setProductSearch("");
    setProductResults([]);
  };

  const updateCartItem = (idx: number, field: keyof CartItem, value: number) => {
    setCart(cart.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const removeFromCart = (idx: number) => {
    setCart(cart.filter((_, i) => i !== idx));
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.quantity * item.sellingPrice, 0);
  const totalCost = cart.reduce((sum, item) => sum + item.quantity * item.purchasePrice, 0);
  const totalProfit = totalAmount - totalCost;
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleSubmit = async () => {
    if (cart.length === 0) return;
    setSaving(true);

    try {
      const res = await fetch("/api/erp/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterpartyId: selectedClientId || null,
          items: cart.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            sellingPrice: item.sellingPrice,
          })),
          notes: notes || null,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        router.push(`/sales/orders/${data.id}`);
      } else {
        alert(data.error || "Помилка створення");
      }
    } catch {
      alert("Мережева помилка");
    }
    setSaving(false);
  };

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const filteredClients = clientSearch
    ? clients.filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
    : clients;

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50" style={{
        background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ height: "2px", background: "linear-gradient(to right, transparent, #FFD600, transparent)" }} />
        <div className="max-w-lg mx-auto flex items-center gap-3" style={{ padding: "12px 16px" }}>
          <Link href="/sales" className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.08)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.7)" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 style={{ fontSize: "20px", fontWeight: 700, flex: 1, color: "white" }}>Нове замовлення</h1>
          {cart.length > 0 && (
            <span style={{
              background: "linear-gradient(135deg, #FFD600, #FFA000)",
              color: "#0A0A0A", padding: "3px 12px", borderRadius: "20px",
              fontSize: "13px", fontWeight: 700,
            }}>
              {totalItems}
            </span>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: "12px", paddingBottom: cart.length > 0 ? "200px" : "100px" }}>
        {/* Client selector */}
        <div className="bg-white rounded-2xl p-4 mb-3" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "6px", fontWeight: 500 }}>Клієнт</p>
          <button onClick={() => setShowClientPicker(true)} className="w-full text-left"
            style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "15px", background: "#FAFAFA" }}>
            {selectedClient ? (
              <span style={{ fontWeight: 500 }}>{selectedClient.name}</span>
            ) : (
              <span style={{ color: "#9CA3AF" }}>Обрати клієнта...</span>
            )}
          </button>
        </div>

        {/* Product search */}
        <div className="bg-white rounded-2xl p-4 mb-3" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "6px", fontWeight: 500 }}>Додати товар</p>
          <input
            type="search"
            placeholder="Пошук по назві або артикулу..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="w-full"
            style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "15px" }}
          />
          {searchLoading && <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>Шукаю...</p>}

          {/* Product results */}
          {productResults.length > 0 && (
            <div className="mt-2 max-h-60 overflow-auto" style={{ border: "1px solid #E5E7EB", borderRadius: "8px" }}>
              {productResults.map((p) => (
                <button key={p.id} onClick={() => addToCart(p)}
                  className="w-full text-left flex items-center justify-between p-3 hover:bg-yellow-50"
                  style={{ borderBottom: "1px solid #F3F4F6", fontSize: "14px" }}>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontWeight: 500 }} className="truncate">{p.name}</p>
                    <div className="flex gap-3" style={{ fontSize: "12px", color: "#9CA3AF" }}>
                      {p.sku && <span>{p.sku}</span>}
                      <span>Залишок: {p.stock || 0}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0" style={{ marginLeft: "8px" }}>
                    <p style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{formatPrice(p.price)}</p>
                    {(p.purchasePrice > 0 || p.wholesalePrice > 0) && (
                      <p style={{ fontSize: "11px", color: "#6B7280", whiteSpace: "nowrap" }}>вхід: {formatPrice(p.purchasePrice || p.wholesalePrice)}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        {cart.length > 0 && (
          <div className="bg-white rounded-2xl mb-3" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #EFEFEF" }}>
              <p style={{ fontSize: "14px", fontWeight: 600 }}>Кошик ({cart.length} позицій)</p>
            </div>
            {cart.map((item, idx) => (
              <div key={item.productId} style={{ padding: "12px 16px", borderBottom: "1px solid #F9FAFB" }}>
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: "14px", fontWeight: 500 }} className="truncate">{item.name}</p>
                    <div className="flex items-center gap-2" style={{ fontSize: "12px", color: "#9CA3AF" }}>
                      <span>{item.sku}</span>
                      <span>|</span>
                      <span>Залишок: {item.stock}</span>
                      {item.purchasePrice > 0 && (
                        <>
                          <span>|</span>
                          <span style={{ color: "#6B7280" }}>Вхід: {formatPrice(item.purchasePrice)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeFromCart(idx)} style={{ color: "#DC2626", fontSize: "18px", padding: "0 4px" }}>&times;</button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateCartItem(idx, "quantity", Math.max(1, item.quantity - 1))}
                      className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: "1px solid #E5E7EB", fontSize: "16px" }}>-</button>
                    <input type="number" value={item.quantity} onChange={(e) => updateCartItem(idx, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-14 text-center" style={{ padding: "4px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "15px", fontWeight: 600 }} />
                    <button onClick={() => updateCartItem(idx, "quantity", item.quantity + 1)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: "1px solid #E5E7EB", fontSize: "16px" }}>+</button>
                  </div>
                  <div style={{ fontSize: "12px", color: "#9CA3AF" }}>&times;</div>
                  <input type="number" step="0.01" value={item.sellingPrice}
                    onChange={(e) => updateCartItem(idx, "sellingPrice", parseFloat(e.target.value) || 0)}
                    className="w-24 text-right" style={{ padding: "4px 8px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "15px" }} />
                  <div className="text-right flex-1">
                    <p style={{ fontSize: "15px", fontWeight: 700 }}>{formatPrice(item.quantity * item.sellingPrice)}</p>
                    {item.purchasePrice > 0 && (() => {
                      const margin = item.sellingPrice - item.purchasePrice;
                      const marginPct = item.purchasePrice > 0 ? Math.round((margin / item.purchasePrice) * 100) : 0;
                      return (
                        <p style={{ fontSize: "11px", fontWeight: 600, color: margin > 0 ? "#16A34A" : margin < 0 ? "#DC2626" : "#9CA3AF" }}>
                          {margin > 0 ? "+" : ""}{formatPrice(margin)} ({marginPct}%)
                        </p>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Notes */}
        {cart.length > 0 && (
          <div className="bg-white rounded-2xl p-4 mb-3" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <input
              placeholder="Примітка (опціонально)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full"
              style={{ padding: "8px 0", fontSize: "14px", border: "none", outline: "none" }}
            />
          </div>
        )}
      </div>

      {/* Bottom bar — above SalesBottomNav (64px + safe area) */}
      {cart.length > 0 && (
        <div className="fixed left-0 right-0 z-50" style={{
          bottom: "64px",
          background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: "12px 16px",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
        }}>
          <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span style={{ fontSize: "14px", color: "rgba(255,255,255,0.5)" }}>{totalItems} товарів</span>
                {totalCost > 0 && (
                  <span style={{ fontSize: "13px", color: totalProfit > 0 ? "#4ADE80" : "#F87171", marginLeft: "12px" }}>
                    Маржа: {formatPrice(totalProfit)} ({totalCost > 0 ? Math.round((totalProfit / totalCost) * 100) : 0}%)
                  </span>
                )}
              </div>
              <span style={{ fontSize: "22px", fontWeight: 700, color: "#FFD600" }}>{formatPrice(totalAmount)}</span>
            </div>
            <button onClick={handleSubmit} disabled={saving || cart.length === 0}
              className="w-full"
              style={{
                background: "linear-gradient(135deg, #FFD600 0%, #FFA000 100%)",
                color: "#0A0A0A", padding: "14px", borderRadius: "14px",
                fontWeight: 700, fontSize: "16px", opacity: saving ? 0.5 : 1, border: "none",
                boxShadow: "0 4px 16px rgba(255,214,0,0.3)",
              }}>
              {saving ? "Створюю..." : "Створити замовлення"}
            </button>
          </div>
        </div>
      )}

      {/* Client picker modal */}
      {showClientPicker && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#F7F7F7" }}>
          <div style={{
            background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{ height: "2px", background: "linear-gradient(to right, transparent, #FFD600, transparent)" }} />
            <div style={{ padding: "12px 16px" }}>
              <div className="flex items-center gap-3 mb-3">
                <button onClick={() => setShowClientPicker(false)} style={{ fontSize: "14px", color: "rgba(255,255,255,0.5)" }}>Скасувати</button>
                <h2 style={{ fontSize: "18px", fontWeight: 700, flex: 1, textAlign: "center", color: "white" }}>Обрати клієнта</h2>
                <div style={{ width: "70px" }} />
              </div>
              <input
                type="search"
                placeholder="Пошук..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                autoFocus
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.1)", fontSize: "15px",
                  background: "rgba(255,255,255,0.06)", color: "white",
                }}
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto" style={{ padding: "8px 16px" }}>
            <button onClick={() => { setSelectedClientId(""); setShowClientPicker(false); }}
              className="w-full text-left p-3 rounded-xl mb-1" style={{ color: "#9CA3AF", fontSize: "14px" }}>
              Без клієнта
            </button>
            {filteredClients.map((c) => (
              <button key={c.id} onClick={() => { setSelectedClientId(c.id); setShowClientPicker(false); setClientSearch(""); }}
                className="w-full text-left flex items-center gap-3 p-3 rounded-xl bg-white mb-1"
                style={{ border: selectedClientId === c.id ? "2px solid #FFD600" : "1px solid #EFEFEF" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "#EFF6FF", color: "#3B82F6", fontWeight: 600, fontSize: "14px" }}>
                  {c.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <p style={{ fontSize: "15px", fontWeight: 500, color: "#0A0A0A" }}>{c.name}</p>
                  {c.phone && <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{c.phone}</p>}
                </div>
                {selectedClientId === c.id && (
                  <svg className="w-5 h-5" fill="#FFD600" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
