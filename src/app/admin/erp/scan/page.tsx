"use client";

import { useSession } from "next-auth/react";
import { useState, useRef } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

interface MatchedProduct {
  id: string;
  name: string;
  sku: string | null;
  currentPrice: number;
}

interface ScannedItem {
  name: string;
  sku?: string;
  quantity: number;
  price: number;
  unit?: string;
  matched: MatchedProduct | null;
}

interface ScannedData {
  type: "purchase" | "sales";
  number?: string;
  date?: string;
  counterpartyName?: string;
  counterpartyCode?: string;
  items: ScannedItem[];
  totalAmount?: number;
  notes?: string;
  matchedCounterparty: { id: string; name: string; code: string; type: string } | null;
}

export default function ScanPage() {
  const { data: session } = useSession();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<ScannedData | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ type: string; id: string; number: string } | null>(null);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<ScannedItem[]>([]);
  const [searchResults, setSearchResults] = useState<Record<number, MatchedProduct[]>>({});
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const role = (session?.user as any)?.role;

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const handleScan = async (file: File) => {
    setScanning(true);
    setError("");
    setScanned(null);
    setCreated(null);
    setPreviewUrl(URL.createObjectURL(file));

    const formData = new FormData();
    formData.append("file", file);
    formData.append("action", "scan");

    try {
      const res = await fetch("/api/erp/scan", { method: "POST", body: formData });
      const data = await res.json();

      if (res.ok && data.scanned) {
        setScanned(data.scanned);
        setEditItems(data.scanned.items || []);
      } else {
        setError(data.error || "Помилка розпізнавання");
      }
    } catch {
      setError("Мережева помилка");
    }
    setScanning(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleScan(file);
  };

  const handleCapture = () => {
    fileRef.current?.click();
  };

  const searchProduct = async (idx: number, query: string) => {
    if (query.length < 2) return;
    setSearchingIdx(idx);
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(query)}&limit=5`);
      const data = await res.json();
      const products = (data.products || data || []).slice(0, 5).map((p: any) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        currentPrice: p.price,
      }));
      setSearchResults((prev) => ({ ...prev, [idx]: products }));
    } catch { /* ignore */ }
    setSearchingIdx(null);
  };

  const selectProduct = (idx: number, product: MatchedProduct) => {
    setEditItems((prev) => prev.map((item, i) => i === idx ? { ...item, matched: product } : item));
    setSearchResults((prev) => { const n = { ...prev }; delete n[idx]; return n; });
  };

  const updateItem = (idx: number, field: string, value: any) => {
    setEditItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const removeItem = (idx: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCreate = async () => {
    if (!scanned) return;

    const unmatchedItems = editItems.filter((item) => !item.matched);
    if (unmatchedItems.length > 0) {
      const proceed = confirm(`${unmatchedItems.length} товар(ів) не знайдено в базі. Вони будуть пропущені. Продовжити?`);
      if (!proceed) return;
    }

    const validItems = editItems.filter((item) => item.matched);
    if (validItems.length === 0) {
      setError("Немає товарів з відповідниками в базі");
      return;
    }

    setCreating(true);
    setError("");

    const formData = new FormData();
    formData.append("action", "create");
    formData.append("data", JSON.stringify({
      type: scanned.type,
      number: scanned.number,
      date: scanned.date,
      counterpartyId: scanned.matchedCounterparty?.id || null,
      notes: scanned.notes,
      items: validItems.map((item) => ({
        productId: item.matched!.id,
        quantity: item.quantity,
        price: item.price,
      })),
    }));

    try {
      const res = await fetch("/api/erp/scan", { method: "POST", body: formData });
      const data = await res.json();

      if (res.ok && data.ok) {
        setCreated(data);
      } else {
        setError(data.error || "Помилка створення");
      }
    } catch {
      setError("Мережева помилка");
    }
    setCreating(false);
  };

  const totalSum = editItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const matchedCount = editItems.filter((i) => i.matched).length;

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
            <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>AI Сканер накладних</h1>
            <p style={{ fontSize: "14px", color: "#6B7280" }}>Фото → Документ за секунди</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Success state */}
        {created && (
          <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #EFEFEF" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px", color: "#22C55E" }}>&#10003;</div>
            <h2 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>Документ створено!</h2>
            <p style={{ fontSize: "16px", color: "#6B7280", marginBottom: "24px" }}>{created.number}</p>
            <div className="flex gap-3 justify-center">
              <Link
                href={created.type === "purchase" ? `/admin/erp/purchase-orders/${created.id}` : `/admin/erp/sales/${created.id}`}
                style={{ background: "#FFD600", padding: "12px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
                Відкрити документ
              </Link>
              <button onClick={() => { setScanned(null); setCreated(null); setPreviewUrl(null); setEditItems([]); if (fileRef.current) fileRef.current.value = ""; }}
                style={{ background: "white", border: "1px solid #E5E7EB", padding: "12px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
                Сканувати ще
              </button>
            </div>
          </div>
        )}

        {/* Upload area */}
        {!created && !scanned && (
          <div className="bg-white rounded-xl p-8" style={{ border: "1px solid #EFEFEF" }}>
            <div className="text-center">
              <div className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center mb-4" style={{ background: "#FFF9DB" }}>
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="#EAB308" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
              </div>
              <h2 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>Сфотографуйте накладну</h2>
              <p style={{ fontSize: "14px", color: "#6B7280", marginBottom: "24px", maxWidth: "400px", margin: "0 auto 24px" }}>
                AI розпізнає номер, контрагента, товари, ціни та кількість. Створить готовий документ в ERP.
              </p>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="flex gap-3 justify-center flex-wrap">
                <button onClick={handleCapture} disabled={scanning}
                  style={{ background: "#FFD600", padding: "14px 28px", borderRadius: "12px", fontWeight: 700, fontSize: "16px", opacity: scanning ? 0.5 : 1 }}>
                  {scanning ? "Розпізнаю..." : "Зробити фото"}
                </button>
                <button onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleScan(f); }; input.click(); }}
                  disabled={scanning}
                  style={{ background: "white", border: "1px solid #E5E7EB", padding: "14px 28px", borderRadius: "12px", fontWeight: 600, fontSize: "16px", opacity: scanning ? 0.5 : 1 }}>
                  Вибрати з галереї
                </button>
              </div>
            </div>

            {scanning && (
              <div className="mt-8 text-center">
                <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                <p style={{ fontSize: "14px", color: "#6B7280" }}>AI аналізує документ...</p>
              </div>
            )}

            {error && !scanning && (
              <div className="mt-6 p-4 rounded-lg" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
                <p style={{ color: "#DC2626", fontSize: "14px" }}>{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Scanned result */}
        {!created && scanned && (
          <>
            {/* Photo + Doc info side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Photo preview */}
              {previewUrl && (
                <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "#6B7280", marginBottom: "8px" }}>Фото документа</p>
                  <img src={previewUrl} alt="Скановане фото" className="w-full rounded-lg" style={{ maxHeight: "300px", objectFit: "contain" }} />
                </div>
              )}

              {/* Document info */}
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>Розпізнаний документ</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span style={{ fontSize: "13px", color: "#6B7280" }}>Тип</span>
                    <span style={{ fontSize: "14px", fontWeight: 600, padding: "2px 10px", borderRadius: "6px", background: scanned.type === "purchase" ? "#EFF6FF" : "#F0FDF4", color: scanned.type === "purchase" ? "#2563EB" : "#16A34A" }}>
                      {scanned.type === "purchase" ? "Прихідна" : "Видаткова"}
                    </span>
                  </div>
                  {scanned.number && (
                    <div className="flex justify-between">
                      <span style={{ fontSize: "13px", color: "#6B7280" }}>Номер</span>
                      <span style={{ fontSize: "14px", fontWeight: 600 }}>{scanned.number}</span>
                    </div>
                  )}
                  {scanned.date && (
                    <div className="flex justify-between">
                      <span style={{ fontSize: "13px", color: "#6B7280" }}>Дата</span>
                      <span style={{ fontSize: "14px" }}>{scanned.date}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-start">
                    <span style={{ fontSize: "13px", color: "#6B7280" }}>Контрагент</span>
                    <div className="text-right">
                      <p style={{ fontSize: "14px", fontWeight: 600 }}>{scanned.counterpartyName || "—"}</p>
                      {scanned.matchedCounterparty ? (
                        <p style={{ fontSize: "12px", color: "#16A34A" }}>Знайдено: {scanned.matchedCounterparty.name}</p>
                      ) : scanned.counterpartyName ? (
                        <p style={{ fontSize: "12px", color: "#F59E0B" }}>Не знайдено в базі</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ fontSize: "13px", color: "#6B7280" }}>Товарів</span>
                    <span style={{ fontSize: "14px" }}>
                      {editItems.length} ({matchedCount} знайдено в базі)
                    </span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: "2px solid #0A0A0A", paddingTop: "8px" }}>
                    <span style={{ fontSize: "15px", fontWeight: 700 }}>Сума</span>
                    <span style={{ fontSize: "18px", fontWeight: 700 }}>{formatPrice(totalSum)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Items table */}
            <div className="bg-white rounded-xl p-5 mb-4" style={{ border: "1px solid #EFEFEF" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Товари ({editItems.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: "2px solid #E5E7EB" }}>
                      <th style={{ padding: "8px 4px", textAlign: "left", fontSize: "12px", color: "#6B7280", width: "40%" }}>Назва з накладної → База</th>
                      <th style={{ padding: "8px 4px", textAlign: "center", fontSize: "12px", color: "#6B7280" }}>К-сть</th>
                      <th style={{ padding: "8px 4px", textAlign: "right", fontSize: "12px", color: "#6B7280" }}>Ціна</th>
                      <th style={{ padding: "8px 4px", textAlign: "right", fontSize: "12px", color: "#6B7280" }}>Сума</th>
                      <th style={{ padding: "8px 4px", width: "36px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editItems.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "10px 4px" }}>
                          <p style={{ fontSize: "13px", color: "#6B7280", marginBottom: "2px" }}>{item.name}{item.sku ? ` (${item.sku})` : ""}</p>
                          {item.matched ? (
                            <div className="flex items-center gap-1">
                              <span style={{ fontSize: "12px", color: "#16A34A" }}>&#10003;</span>
                              <span style={{ fontSize: "13px", fontWeight: 600 }}>{item.matched.name}</span>
                              {item.matched.sku && <span style={{ fontSize: "11px", color: "#9CA3AF" }}>({item.matched.sku})</span>}
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-center gap-1">
                                <span style={{ fontSize: "12px", color: "#DC2626" }}>&#10007;</span>
                                <input
                                  placeholder="Пошук товару..."
                                  className="text-sm border-b border-dashed border-g300 outline-none"
                                  style={{ width: "180px", padding: "2px 0" }}
                                  onChange={(e) => searchProduct(idx, e.target.value)}
                                />
                                {searchingIdx === idx && <span style={{ fontSize: "11px", color: "#9CA3AF" }}>...</span>}
                              </div>
                              {searchResults[idx] && searchResults[idx].length > 0 && (
                                <div className="mt-1 border rounded-lg overflow-hidden" style={{ fontSize: "12px" }}>
                                  {searchResults[idx].map((p) => (
                                    <button key={p.id} onClick={() => selectProduct(idx, p)}
                                      className="w-full text-left px-2 py-1.5 hover:bg-primary/10 border-b last:border-0 flex justify-between">
                                      <span>{p.name}</span>
                                      <span style={{ color: "#6B7280" }}>{p.sku}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px 4px", textAlign: "center" }}>
                          <input type="number" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                            style={{ width: "60px", textAlign: "center", padding: "4px", border: "1px solid #E5E7EB", borderRadius: "6px", fontSize: "14px" }} />
                        </td>
                        <td style={{ padding: "10px 4px", textAlign: "right" }}>
                          <input type="number" step="0.01" value={item.price} onChange={(e) => updateItem(idx, "price", parseFloat(e.target.value) || 0)}
                            style={{ width: "90px", textAlign: "right", padding: "4px", border: "1px solid #E5E7EB", borderRadius: "6px", fontSize: "14px" }} />
                        </td>
                        <td style={{ padding: "10px 4px", textAlign: "right", fontSize: "14px", fontWeight: 600 }}>
                          {formatPrice(item.quantity * item.price)}
                        </td>
                        <td style={{ padding: "10px 4px" }}>
                          <button onClick={() => removeItem(idx)} style={{ color: "#DC2626", fontSize: "18px", lineHeight: 1 }} title="Видалити">
                            &times;
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {error && (
              <div className="p-4 rounded-lg mb-4" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
                <p style={{ color: "#DC2626", fontSize: "14px" }}>{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-between">
              <button onClick={() => { setScanned(null); setPreviewUrl(null); setEditItems([]); setError(""); if (fileRef.current) fileRef.current.value = ""; }}
                style={{ background: "white", border: "1px solid #E5E7EB", padding: "12px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
                Сканувати інше фото
              </button>
              <button onClick={handleCreate} disabled={creating || matchedCount === 0}
                style={{
                  background: matchedCount > 0 ? "#FFD600" : "#E5E7EB",
                  padding: "12px 28px", borderRadius: "8px", fontWeight: 700, fontSize: "15px",
                  opacity: creating ? 0.5 : 1,
                }}>
                {creating ? "Створюю..." : `Створити ${scanned.type === "purchase" ? "прихідну" : "видаткову"} (${matchedCount} товарів)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
