"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

interface Competitor {
  store: string;
  price: number;
  url: string;
  note?: string;
}

interface PriceResult {
  productId: string;
  productName: string;
  sku: string;
  ourPrice: number;
  ourCostPrice: number;
  competitors: Competitor[];
  cheapestPrice: number | null;
  priceDiff: number | null;
  summary: string;
}

export default function PriceCheckPage() {
  const { data: session } = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PriceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [limit, setLimit] = useState(5);
  const [checkedCount, setCheckedCount] = useState(0);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCategories(data);
      })
      .catch(() => {});
  }, []);

  if (role !== "ADMIN") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg font-bold">Доступ заборонено</p>
      </div>
    );
  }

  const handleSearch = async () => {
    if (!query.trim() && !selectedCategory) {
      setError("Введіть назву товару або оберіть категорію");
      return;
    }
    setLoading(true);
    setError("");
    setResults([]);
    setCheckedCount(0);

    try {
      const body: any = { limit };
      if (query.trim()) body.query = query.trim();
      else if (selectedCategory) body.categoryId = selectedCategory;

      const res = await fetch("/api/erp/price-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Помилка");
      } else {
        setResults(data.results || []);
        setCheckedCount(data.total || 0);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const getCheapestBadge = (result: PriceResult) => {
    if (!result.cheapestPrice || result.competitors.length === 0) return null;
    const diff = result.ourPrice - result.cheapestPrice;
    const pct = result.ourPrice > 0 ? Math.round((diff / result.ourPrice) * 100) : 0;

    if (diff > 0) {
      return { text: `У конкурентів дешевше на ${formatPrice(diff)} (${pct}%)`, color: "#DC2626", bg: "#FEF2F2" };
    } else if (diff < 0) {
      return { text: `Ми дешевше на ${formatPrice(Math.abs(diff))} (${Math.abs(pct)}%)`, color: "#16A34A", bg: "#F0FDF4" };
    }
    return { text: "Ціна однакова", color: "#6B7280", bg: "#F9FAFB" };
  };

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
            <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Моніторинг цін</h1>
            <p style={{ fontSize: "14px", color: "#6B7280" }}>AI аналіз цін конкурентів в інтернеті</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Search form */}
        <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>
                Пошук за назвою / SKU
              </label>
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelectedCategory(""); }}
                placeholder="Наприклад: молоток, GCD 522, перфоратор..."
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: "10px",
                  border: "1px solid #D1D5DB", fontSize: "14px", outline: "none",
                }}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>
                Або за категорією
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => { setSelectedCategory(e.target.value); setQuery(""); }}
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: "10px",
                  border: "1px solid #D1D5DB", fontSize: "14px", outline: "none",
                  background: "white",
                }}
              >
                <option value="">Оберіть категорію</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label style={{ fontSize: "13px", color: "#6B7280" }}>Кількість:</label>
              <select
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value))}
                style={{
                  padding: "6px 10px", borderRadius: "8px",
                  border: "1px solid #D1D5DB", fontSize: "13px",
                }}
              >
                {[3, 5, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>{n} товарів</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSearch}
              disabled={loading}
              style={{
                background: loading
                  ? "linear-gradient(135deg, #9CA3AF, #6B7280)"
                  : "linear-gradient(135deg, #0A0A0A, #1A1A1A)",
                color: loading ? "#D1D5DB" : "#FFD600",
                padding: "10px 24px", borderRadius: "10px",
                fontWeight: 700, fontSize: "14px", border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: "8px",
              }}
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  AI шукає ціни...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Перевірити ціни
                </>
              )}
            </button>
          </div>

          {error && (
            <p style={{ color: "#DC2626", fontSize: "14px", marginTop: "12px" }}>{error}</p>
          )}

          {loading && (
            <div style={{ marginTop: "16px", padding: "16px", background: "#FFF7ED", borderRadius: "10px", border: "1px solid #FDE68A" }}>
              <p style={{ fontSize: "14px", color: "#92400E" }}>
                AI аналізує ціни конкурентів... Це може зайняти 15-60 секунд залежно від кількості товарів.
              </p>
            </div>
          )}
        </div>

        {/* Results */}
        {checkedCount > 0 && !loading && (
          <p style={{ fontSize: "14px", fontWeight: 600, color: "#374151", marginBottom: "12px" }}>
            Перевірено: {checkedCount} товарів
          </p>
        )}

        <div className="space-y-4">
          {results.map((result) => {
            const badge = getCheapestBadge(result);
            return (
              <div key={result.productId} className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
                {/* Product header */}
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }} className="truncate">
                        {result.productName}
                      </p>
                      <p style={{ fontSize: "12px", color: "#9CA3AF" }}>SKU: {result.sku}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p style={{ fontSize: "12px", color: "#9CA3AF" }}>Наша ціна</p>
                      <p style={{ fontSize: "20px", fontWeight: 700, color: "#0A0A0A" }}>{formatPrice(result.ourPrice)}</p>
                      {result.ourCostPrice > 0 && (
                        <p style={{ fontSize: "11px", color: "#9CA3AF" }}>Собівартість: {formatPrice(result.ourCostPrice)}</p>
                      )}
                    </div>
                  </div>

                  {badge && (
                    <div style={{
                      marginTop: "10px", padding: "8px 12px", borderRadius: "8px",
                      background: badge.bg, fontSize: "13px", fontWeight: 600, color: badge.color,
                    }}>
                      {badge.text}
                    </div>
                  )}
                </div>

                {/* Competitors */}
                {result.competitors.length > 0 ? (
                  <div>
                    <div style={{ padding: "10px 20px", background: "#F9FAFB", fontSize: "12px", fontWeight: 600, color: "#6B7280" }}>
                      <div className="grid grid-cols-12 gap-2">
                        <span className="col-span-4">Магазин</span>
                        <span className="col-span-3 text-right">Ціна</span>
                        <span className="col-span-3 text-right">Різниця</span>
                        <span className="col-span-2 text-right">Посилання</span>
                      </div>
                    </div>
                    {result.competitors.map((c, idx) => {
                      const diff = result.ourPrice - c.price;
                      const isMin = c.price === result.cheapestPrice;
                      return (
                        <div
                          key={idx}
                          style={{
                            padding: "12px 20px",
                            borderBottom: idx < result.competitors.length - 1 ? "1px solid #F3F4F6" : "none",
                            background: isMin ? "#FFFBEB" : "transparent",
                          }}
                        >
                          <div className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-4">
                              <p style={{ fontSize: "14px", fontWeight: 500 }}>{c.store}</p>
                              {c.note && <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{c.note}</p>}
                            </div>
                            <div className="col-span-3 text-right">
                              <p style={{ fontSize: "15px", fontWeight: 700, color: isMin ? "#D97706" : "#0A0A0A" }}>
                                {formatPrice(c.price)}
                              </p>
                            </div>
                            <div className="col-span-3 text-right">
                              <p style={{
                                fontSize: "13px", fontWeight: 600,
                                color: diff > 0 ? "#DC2626" : diff < 0 ? "#16A34A" : "#9CA3AF",
                              }}>
                                {diff > 0 ? `-${formatPrice(diff)}` : diff < 0 ? `+${formatPrice(Math.abs(diff))}` : "="}
                              </p>
                            </div>
                            <div className="col-span-2 text-right">
                              {c.url && (
                                <a
                                  href={c.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: "inline-flex", alignItems: "center", gap: "4px",
                                    fontSize: "12px", color: "#2563EB", fontWeight: 500,
                                  }}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                  Відкрити
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: "16px 20px" }}>
                    <p style={{ fontSize: "13px", color: "#9CA3AF", fontStyle: "italic" }}>
                      Конкурентів не знайдено
                    </p>
                  </div>
                )}

                {/* AI Summary */}
                <div style={{ padding: "12px 20px", background: "#F9FAFB", borderTop: "1px solid #F3F4F6" }}>
                  <p style={{ fontSize: "13px", color: "#6B7280" }}>
                    <span style={{ fontWeight: 600 }}>AI:</span> {result.summary}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
