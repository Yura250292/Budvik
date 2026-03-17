"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = { DRAFT: "Чернетка", CONFIRMED: "Підтверджено", CANCELLED: "Скасовано" };
const STATUS_COLORS: Record<string, string> = { DRAFT: "bg-g100 text-g600", CONFIRMED: "bg-green-50 text-green-700", CANCELLED: "bg-red-50 text-red-600" };

type ItemForm = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  sellingPrice: number;
  purchasePrice: number;
  discountPercent: number;
  retailPrice: number;
};

export default function SalesDocumentDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const isNew = id === "new";

  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const [counterpartyId, setCounterpartyId] = useState("");
  const [salesRepId, setSalesRepId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemForm[]>([]);

  const [customers, setCustomers] = useState<any[]>([]);
  const [salesReps, setSalesReps] = useState<any[]>([]);

  // Product search state
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    // Load customers
    fetch("/api/erp/counterparties?type=CUSTOMER")
      .then((r) => r.json())
      .then((data) => {
        fetch("/api/erp/counterparties?type=BOTH")
          .then((r) => r.json())
          .then((both) => {
            const all = [...(Array.isArray(data) ? data : []), ...(Array.isArray(both) ? both : [])];
            setCustomers(all.filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i));
          });
      });
    // Load sales reps
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        setSalesReps((Array.isArray(data) ? data : []).filter((u: any) => u.role === "SALES" || u.role === "ADMIN"));
      })
      .catch(() => setSalesReps([]));
  }, []);

  // Set default salesRepId if SALES role
  useEffect(() => {
    if (isNew && session?.user?.id && role === "SALES") {
      setSalesRepId(session.user.id);
    }
  }, [isNew, session, role]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchDoc = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    const res = await fetch(`/api/erp/sales/${id}`);
    if (res.ok) {
      const data = await res.json();
      setDoc(data);
      setCounterpartyId(data.counterpartyId || "");
      setSalesRepId(data.salesRepId || "");
      setNotes(data.notes || "");
      setItems(
        data.items.map((i: any) => ({
          productId: i.productId,
          productName: i.product?.name || "",
          sku: i.product?.sku || "",
          quantity: i.quantity,
          sellingPrice: i.sellingPrice,
          purchasePrice: i.purchasePrice,
          discountPercent: i.discountPercent,
          retailPrice: i.product?.price || 0,
        }))
      );
    }
    setLoading(false);
  }, [id, isNew]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  // Debounced product search using ERP endpoint
  const searchProducts = (query: string) => {
    setProductSearch(query);
    setHighlightIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 1) {
      setProductResults([]);
      setShowDropdown(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/erp/products?search=${encodeURIComponent(query.trim())}&limit=20`);
        const data = await res.json();
        setProductResults(Array.isArray(data) ? data : []);
        setShowDropdown(true);
      } catch {
        setProductResults([]);
      }
      setSearchLoading(false);
    }, 250);
  };

  const addProduct = (product: any) => {
    const alreadyAdded = items.find((i) => i.productId === product.id);
    if (alreadyAdded) {
      setItems(items.map((i) => (i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i)));
    } else {
      setItems([
        ...items,
        {
          productId: product.id,
          productName: product.name,
          sku: product.sku || "",
          quantity: 1,
          sellingPrice: product.price,
          purchasePrice: product.purchasePrice || 0,
          discountPercent: 0,
          retailPrice: product.price,
        },
      ]);
    }
    setProductSearch("");
    setProductResults([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  // Keyboard navigation in search dropdown
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || productResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => (prev < productResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : productResults.length - 1));
    } else if (e.key === "Enter" && highlightIndex >= 0) {
      e.preventDefault();
      addProduct(productResults[highlightIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  const updateItem = (index: number, field: string, value: number) => {
    setItems(items.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item, [field]: value };
      if (field === "sellingPrice" && item.retailPrice > 0) {
        updated.discountPercent = Math.round(((item.retailPrice - value) / item.retailPrice) * 100 * 100) / 100;
      }
      return updated;
    }));
  };

  const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

  const totalAmount = items.reduce((s, i) => s + i.quantity * i.sellingPrice, 0);
  const totalCost = items.reduce((s, i) => s + i.quantity * i.purchasePrice, 0);
  const totalProfit = totalAmount - totalCost;

  const handleSave = async () => {
    if (items.length === 0) return alert("Додайте товари");

    setSaving(true);
    const payload = {
      counterpartyId: counterpartyId || null,
      salesRepId: salesRepId || null,
      notes,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        sellingPrice: i.sellingPrice,
        purchasePrice: i.purchasePrice,
        discountPercent: i.discountPercent,
      })),
    };

    const url = isNew ? "/api/erp/sales" : `/api/erp/sales/${id}`;
    const method = isNew ? "POST" : "PATCH";

    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      const data = await res.json();
      if (isNew) router.push(`/admin/erp/sales/${data.id}`);
      else fetchDoc();
    } else {
      const err = await res.json();
      alert(err.error || "Помилка збереження");
    }
    setSaving(false);
  };

  const handleConfirm = async () => {
    if (!confirm("Підтвердити продаж? Залишки будуть зменшені, комісії нараховані.")) return;
    setSaving(true);
    const res = await fetch(`/api/erp/sales/${id}/confirm`, { method: "POST" });
    if (res.ok) fetchDoc();
    else {
      const err = await res.json();
      alert(err.error || "Помилка");
    }
    setSaving(false);
  };

  const handleCancel = async () => {
    if (!confirm("Скасувати документ?")) return;
    setSaving(true);
    const res = await fetch(`/api/erp/sales/${id}/cancel`, { method: "POST" });
    if (res.ok) fetchDoc();
    else {
      const err = await res.json();
      alert(err.error || "Помилка");
    }
    setSaving(false);
  };

  if (role !== "ADMIN" && role !== "SALES" && role !== "MANAGER") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ color: "#9E9E9E" }}>Завантаження...</div>;

  const isDraft = isNew || doc?.status === "DRAFT";
  const addedProductIds = new Set(items.map((i) => i.productId));

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin/erp/sales" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>
                {isNew ? "Новий документ продажу" : doc?.number}
              </h1>
              {doc && (
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[doc.status]}`}>{STATUS_LABELS[doc.status]}</span>
                  <span style={{ fontSize: "13px", color: "#9CA3AF" }}>{formatDate(doc.createdAt)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDraft && (
              <>
                <button onClick={handleSave} disabled={saving} style={{ background: "#FFD600", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: saving ? 0.6 : 1 }}>
                  {saving ? "..." : isNew ? "Створити" : "Зберегти"}
                </button>
                {!isNew && (
                  <button onClick={handleConfirm} disabled={saving} style={{ background: "#22C55E", color: "white", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: saving ? 0.6 : 1 }}>
                    Підтвердити
                  </button>
                )}
              </>
            )}
            {doc && doc.status !== "CANCELLED" && (
              <button onClick={handleCancel} disabled={saving} style={{ background: "white", color: "#EF4444", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", border: "1px solid #FCA5A5", opacity: saving ? 0.6 : 1 }}>
                Скасувати
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Header info */}
        <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF" }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Покупець</label>
              {isDraft ? (
                <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}>
                  <option value="">Без контрагента</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <p style={{ fontSize: "14px", fontWeight: 500, padding: "10px 0" }}>{doc?.counterparty?.name || "—"}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Торговий менеджер</label>
              {isDraft ? (
                <select value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}>
                  <option value="">Оберіть торгового...</option>
                  {salesReps.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : (
                <p style={{ fontSize: "14px", fontWeight: 500, padding: "10px 0" }}>{doc?.salesRep?.name || "—"}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Примітки</label>
              {isDraft ? (
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Необов'язково"
                  style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              ) : (
                <p style={{ fontSize: "14px", color: "#6B7280", padding: "10px 0" }}>{doc?.notes || "—"}</p>
              )}
            </div>
          </div>
        </div>

        {/* Summary cards (for confirmed docs) */}
        {doc?.status === "CONFIRMED" && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
              <p style={{ fontSize: "13px", color: "#6B7280" }}>Сума продажу</p>
              <p style={{ fontSize: "22px", fontWeight: 700 }}>{formatPrice(doc.totalAmount)}</p>
            </div>
            <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
              <p style={{ fontSize: "13px", color: "#6B7280" }}>Прибуток</p>
              <p style={{ fontSize: "22px", fontWeight: 700, color: doc.profitAmount > 0 ? "#16A34A" : "#DC2626" }}>{formatPrice(doc.profitAmount)}</p>
            </div>
            <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
              <p style={{ fontSize: "13px", color: "#6B7280" }}>Маржа</p>
              <p style={{ fontSize: "22px", fontWeight: 700 }}>{doc.totalAmount > 0 ? Math.round((doc.profitAmount / doc.totalAmount) * 100) : 0}%</p>
            </div>
          </div>
        )}

        {/* Product search */}
        {isDraft && (
          <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF" }}>
            <label className="block text-sm font-medium text-g600 mb-2">Додати товар</label>
            <div className="relative" ref={searchRef}>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={inputRef}
                  value={productSearch}
                  onChange={(e) => searchProducts(e.target.value)}
                  onFocus={() => { if (productResults.length > 0) setShowDropdown(true); }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Назва, артикул або категорія..."
                  style={{ width: "100%", padding: "10px 14px 10px 38px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                />
                {searchLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div style={{ width: 16, height: 16, border: "2px solid #E5E7EB", borderTopColor: "#FFD600", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                  </div>
                )}
              </div>

              {showDropdown && productResults.length > 0 && (
                <div className="absolute z-20 w-full bg-white border rounded-xl mt-1 max-h-[400px] overflow-y-auto" style={{ boxShadow: "0 12px 36px rgba(0,0,0,0.14)", border: "1px solid #E5E7EB" }}>
                  {productResults.map((p: any, idx: number) => {
                    const isAdded = addedProductIds.has(p.id);
                    const isHighlighted = idx === highlightIndex;
                    return (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors"
                        style={{
                          borderBottom: idx < productResults.length - 1 ? "1px solid #F3F4F6" : "none",
                          background: isHighlighted ? "#FFF9DB" : isAdded ? "#F9FAFB" : "white",
                        }}
                        onMouseEnter={() => setHighlightIndex(idx)}
                      >
                        {/* Product image */}
                        {p.image ? (
                          <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" style={{ border: "1px solid #F3F4F6" }} />
                        ) : (
                          <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: "#F3F4F6" }}>
                            <svg className="w-5 h-5 text-[#D1D5DB]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                            </svg>
                          </div>
                        )}

                        {/* Product info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize: "14px", fontWeight: 500, color: "#0A0A0A" }} className="truncate">{p.name}</span>
                            {isAdded && (
                              <span style={{ fontSize: "10px", fontWeight: 600, color: "#16A34A", background: "#DCFCE7", padding: "1px 6px", borderRadius: "4px", flexShrink: 0 }}>
                                В документі
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {p.sku && (
                              <span style={{ fontSize: "12px", color: "#6B7280", fontFamily: "monospace" }}>{p.sku}</span>
                            )}
                            {p.category && (
                              <span style={{ fontSize: "11px", color: "#9CA3AF", background: "#F3F4F6", padding: "1px 6px", borderRadius: "4px" }}>
                                {p.category}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Price and stock info */}
                        <div className="text-right flex-shrink-0">
                          <div style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{formatPrice(p.price)}</div>
                          <div className="flex items-center gap-2 justify-end mt-0.5">
                            {p.purchasePrice > 0 && (
                              <span style={{ fontSize: "11px", color: "#6B7280" }}>вхід: {formatPrice(p.purchasePrice)}</span>
                            )}
                            <span style={{
                              fontSize: "11px",
                              fontWeight: 500,
                              color: p.stock > 0 ? "#16A34A" : "#DC2626",
                            }}>
                              {p.stock > 0 ? `${p.stock} шт` : "Немає"}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {showDropdown && !searchLoading && productSearch.trim().length >= 1 && productResults.length === 0 && (
                <div className="absolute z-20 w-full bg-white border rounded-xl mt-1 px-4 py-6 text-center" style={{ boxShadow: "0 12px 36px rgba(0,0,0,0.14)", border: "1px solid #E5E7EB" }}>
                  <p style={{ fontSize: "14px", color: "#9CA3AF" }}>Товарів не знайдено</p>
                  <p style={{ fontSize: "12px", color: "#D1D5DB", marginTop: "4px" }}>Спробуйте інший запит або артикул</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Items table */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Товар</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>К-ть</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Вхідна ціна</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Ціна продажу</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Знижка %</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Прибуток</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Сума</th>
                  {isDraft && <th style={{ padding: "12px 16px", width: "50px" }} />}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={isDraft ? 8 : 7} style={{ padding: "40px", textAlign: "center", color: "#9CA3AF", fontSize: "14px" }}>
                      Немає товарів
                    </td>
                  </tr>
                ) : (
                  items.map((item, idx) => {
                    const profit = (item.sellingPrice - item.purchasePrice) * item.quantity;
                    return (
                      <tr key={idx} style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ fontSize: "14px", fontWeight: 500 }}>{item.productName}</div>
                          {item.sku && <div style={{ fontSize: "11px", color: "#9CA3AF" }}>{item.sku}</div>}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                          {isDraft ? (
                            <input type="number" min={1} value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                              style={{ width: "70px", padding: "6px", borderRadius: "6px", border: "1px solid #E5E7EB", fontSize: "14px", textAlign: "center" }} />
                          ) : item.quantity}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          {isDraft ? (
                            <input type="number" min={0} step={0.01} value={item.purchasePrice} onChange={(e) => updateItem(idx, "purchasePrice", parseFloat(e.target.value) || 0)}
                              style={{ width: "100px", padding: "6px", borderRadius: "6px", border: "1px solid #E5E7EB", fontSize: "14px", textAlign: "right" }} />
                          ) : formatPrice(item.purchasePrice)}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          {isDraft ? (
                            <input type="number" min={0} step={0.01} value={item.sellingPrice} onChange={(e) => updateItem(idx, "sellingPrice", parseFloat(e.target.value) || 0)}
                              style={{ width: "100px", padding: "6px", borderRadius: "6px", border: "1px solid #E5E7EB", fontSize: "14px", textAlign: "right" }} />
                          ) : formatPrice(item.sellingPrice)}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", color: item.discountPercent > 0 ? "#DC2626" : "#6B7280" }}>
                          {item.discountPercent > 0 ? `-${item.discountPercent}%` : "—"}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: 600, color: profit > 0 ? "#16A34A" : profit < 0 ? "#DC2626" : "#6B7280" }}>
                          {formatPrice(profit)}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: 600 }}>
                          {formatPrice(item.sellingPrice * item.quantity)}
                        </td>
                        {isDraft && (
                          <td style={{ padding: "12px 16px" }}>
                            <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#FAFAFA", borderTop: "2px solid #EFEFEF" }}>
                    <td colSpan={4} />
                    <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Разом:</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "16px", fontWeight: 700, color: totalProfit > 0 ? "#16A34A" : "#DC2626" }}>
                      {formatPrice(totalProfit)}
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "18px", fontWeight: 700 }}>
                      {formatPrice(totalAmount)}
                    </td>
                    {isDraft && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Commission info for confirmed docs */}
        {doc?.commissions && doc.commissions.length > 0 && (
          <div className="bg-white rounded-xl p-6 mt-6" style={{ border: "1px solid #EFEFEF" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>Комісії</h3>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #EFEFEF" }}>
                  <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px", color: "#6B7280" }}>Бренд</th>
                  <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Продаж</th>
                  <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Прибуток</th>
                  <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Ставка</th>
                  <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Комісія</th>
                </tr>
              </thead>
              <tbody>
                {doc.commissions.map((c: any) => (
                  <tr key={c.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "8px 0", fontSize: "14px", fontWeight: 500 }}>{c.brand}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontSize: "14px" }}>{formatPrice(c.saleAmount)}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontSize: "14px", color: "#16A34A" }}>{formatPrice(c.profitAmount)}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontSize: "14px" }}>{c.commissionRate}%</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontSize: "14px", fontWeight: 600, color: "#F59E0B" }}>{formatPrice(c.commissionAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
