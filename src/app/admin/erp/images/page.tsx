"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

interface Stats {
  total: number;
  withImage: number;
  noImage: number;
  withBudvikImage: number;
  withOtherImage: number;
  coverage: number;
  sampleNoImage: {
    id: string;
    name: string;
    slug: string;
    sku: string;
    stock: number;
    category: { name: string } | null;
  }[];
}

interface ScrapeResult {
  dryRun: boolean;
  totalWithoutImages: number;
  sitemapsProcessed: number;
  matched: number;
  updated: number;
  skipped: number;
  preview: { productId: string; productName: string; imageUrl: string; matchType: string }[];
}

interface SearchResult {
  productId: string;
  productName: string;
  imageUrl: string | null;
  source: string;
  status: "found" | "not_found" | "error";
}

export default function ImagesPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  // Scrape state
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);

  // AI search state
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchCount, setSearchCount] = useState(5);

  // Selected products for AI search
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/erp/images/stats");
      if (res.ok) setStats(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleScrapeOldSite = async (dryRun: boolean) => {
    setScraping(true);
    setScrapeResult(null);
    try {
      const res = await fetch("/api/erp/images/scrape-old-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      if (res.ok) {
        const data = await res.json();
        setScrapeResult(data);
        if (!dryRun) loadStats();
      }
    } catch {}
    setScraping(false);
  };

  const handleAISearch = async () => {
    setSearching(true);
    setSearchResults([]);
    try {
      const body: any = { limit: searchCount };
      if (selectedIds.size > 0) {
        body.productIds = Array.from(selectedIds);
      }
      const res = await fetch("/api/erp/images/auto-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
        if (data.applied > 0) loadStats();
      }
    } catch {}
    setSearching(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (role !== "ADMIN") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Доступ заборонено</h1>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Менеджер зображень</h1>
              <p style={{ fontSize: "13px", color: "#9CA3AF" }}>Парсинг старого сайту та AI-пошук</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats */}
        {loading ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : stats ? (
          <>
            {/* Coverage bar */}
            <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
              <div className="flex items-center justify-between mb-3">
                <h2 style={{ fontSize: "18px", fontWeight: 700 }}>Покриття зображеннями</h2>
                <span style={{ fontSize: "28px", fontWeight: 800, color: stats.coverage >= 80 ? "#16A34A" : stats.coverage >= 50 ? "#F59E0B" : "#DC2626" }}>
                  {stats.coverage}%
                </span>
              </div>
              <div style={{ height: "12px", background: "#F3F4F6", borderRadius: "6px", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${stats.coverage}%`,
                    background: stats.coverage >= 80 ? "linear-gradient(90deg, #22C55E, #16A34A)" : stats.coverage >= 50 ? "linear-gradient(90deg, #FCD34D, #F59E0B)" : "linear-gradient(90deg, #FCA5A5, #DC2626)",
                    borderRadius: "6px",
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                <StatBox label="Всього товарів" value={stats.total} />
                <StatBox label="З картинками" value={stats.withImage} color="#16A34A" />
                <StatBox label="Без картинок" value={stats.noImage} color="#DC2626" />
                <StatBox label="З budvik.com" value={stats.withBudvikImage} color="#6B7280" />
              </div>
            </div>

            {/* Scrape old site */}
            <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FEF3C7" }}>
                  <svg className="w-5 h-5 text-[#F59E0B]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                </div>
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Парсинг budvik.com</h3>
                  <p style={{ fontSize: "13px", color: "#6B7280" }}>
                    Завантажити картинки з 11 sitemaps старого сайту (зіставлення по slug/назві)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleScrapeOldSite(true)}
                  disabled={scraping}
                  style={{
                    padding: "10px 20px",
                    borderRadius: "8px",
                    fontWeight: 600,
                    fontSize: "14px",
                    background: "white",
                    border: "1px solid #E5E7EB",
                    color: "#374151",
                    opacity: scraping ? 0.5 : 1,
                    cursor: scraping ? "not-allowed" : "pointer",
                  }}
                >
                  {scraping ? "Обробка..." : "Попередній перегляд"}
                </button>
                <button
                  onClick={() => handleScrapeOldSite(false)}
                  disabled={scraping}
                  style={{
                    padding: "10px 20px",
                    borderRadius: "8px",
                    fontWeight: 600,
                    fontSize: "14px",
                    background: "#FFD600",
                    color: "#0A0A0A",
                    opacity: scraping ? 0.5 : 1,
                    cursor: scraping ? "not-allowed" : "pointer",
                  }}
                >
                  {scraping ? "Обробка..." : "Запустити парсинг"}
                </button>
              </div>

              {scrapeResult && (
                <div className="mt-4 p-4 rounded-lg" style={{ background: "#F9FAFB", border: "1px solid #E5E7EB" }}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <MiniStat label="Sitemaps" value={scrapeResult.sitemapsProcessed} />
                    <MiniStat label="Знайдено" value={scrapeResult.matched} color="#16A34A" />
                    <MiniStat label="Оновлено" value={scrapeResult.updated} color="#2563EB" />
                    <MiniStat label="Пропущено" value={scrapeResult.skipped} color="#9CA3AF" />
                  </div>
                  {scrapeResult.dryRun && scrapeResult.matched > 0 && (
                    <p style={{ fontSize: "13px", color: "#F59E0B", fontWeight: 600, marginBottom: "8px" }}>
                      Попередній перегляд — натисніть "Запустити парсинг" щоб застосувати
                    </p>
                  )}
                  {scrapeResult.preview.length > 0 && (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {scrapeResult.preview.map((m, i) => (
                        <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white" style={{ border: "1px solid #F3F4F6" }}>
                          <img
                            src={m.imageUrl}
                            alt=""
                            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                            style={{ border: "1px solid #E5E7EB" }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                          <div className="flex-1 min-w-0">
                            <p style={{ fontSize: "13px", fontWeight: 500 }} className="truncate">{m.productName}</p>
                            <p style={{ fontSize: "11px", color: "#9CA3AF" }}>
                              Метод: <span style={{ color: "#6B7280", fontWeight: 500 }}>{m.matchType}</span>
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AI Search */}
            <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#EDE9FE" }}>
                  <svg className="w-5 h-5 text-[#7C3AED]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 700 }}>AI Пошук зображень</h3>
                  <p style={{ fontSize: "13px", color: "#6B7280" }}>
                    Gemini шукає фото в інтернет-магазинах (Rozetka, Prom.ua, Епіцентр...)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <label style={{ fontSize: "13px", color: "#6B7280" }}>Кількість:</label>
                  <select
                    value={searchCount}
                    onChange={(e) => setSearchCount(Number(e.target.value))}
                    style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                  >
                    <option value={3}>3</option>
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                  </select>
                </div>
                <button
                  onClick={handleAISearch}
                  disabled={searching}
                  style={{
                    padding: "10px 20px",
                    borderRadius: "8px",
                    fontWeight: 600,
                    fontSize: "14px",
                    background: "linear-gradient(135deg, #7C3AED, #5B21B6)",
                    color: "white",
                    opacity: searching ? 0.5 : 1,
                    cursor: searching ? "not-allowed" : "pointer",
                  }}
                >
                  {searching ? "Пошук..." : selectedIds.size > 0 ? `Знайти для ${selectedIds.size} обраних` : "Знайти автоматично"}
                </button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    style={{ fontSize: "13px", color: "#9CA3AF", textDecoration: "underline", cursor: "pointer", background: "none", border: "none" }}
                  >
                    Скинути вибір
                  </button>
                )}
              </div>

              {/* AI Search results */}
              {searchResults.length > 0 && (
                <div className="space-y-2 mb-4">
                  {searchResults.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: r.status === "found" ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${r.status === "found" ? "#BBF7D0" : "#FECACA"}` }}>
                      {r.imageUrl ? (
                        <img
                          src={r.imageUrl}
                          alt=""
                          className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                          style={{ border: "1px solid #E5E7EB" }}
                          onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#FEE2E2" }}>
                          <svg className="w-6 h-6 text-[#DC2626]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: "13px", fontWeight: 600 }} className="truncate">{r.productName}</p>
                        <p style={{ fontSize: "12px", color: r.status === "found" ? "#16A34A" : "#DC2626" }}>
                          {r.status === "found" ? `Знайдено: ${r.source}` : r.status === "error" ? `Помилка: ${r.source}` : "Не знайдено"}
                        </p>
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: "6px",
                          background: r.status === "found" ? "#DCFCE7" : "#FEE2E2",
                          color: r.status === "found" ? "#16A34A" : "#DC2626",
                        }}
                      >
                        {r.status === "found" ? "OK" : "X"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Products without images */}
            {stats.sampleNoImage.length > 0 && (
              <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>
                  Товари без зображень (топ за залишками)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: "2px solid #EFEFEF" }}>
                        <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "12px", color: "#9CA3AF", fontWeight: 600 }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.size === stats.sampleNoImage.length}
                            onChange={() => {
                              if (selectedIds.size === stats.sampleNoImage.length) {
                                setSelectedIds(new Set());
                              } else {
                                setSelectedIds(new Set(stats.sampleNoImage.map((p) => p.id)));
                              }
                            }}
                            style={{ width: "16px", height: "16px", accentColor: "#7C3AED" }}
                          />
                        </th>
                        <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "12px", color: "#9CA3AF", fontWeight: 600 }}>Назва</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "12px", color: "#9CA3AF", fontWeight: 600 }}>Артикул</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "12px", color: "#9CA3AF", fontWeight: 600 }}>Категорія</th>
                        <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "12px", color: "#9CA3AF", fontWeight: 600 }}>Залишок</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.sampleNoImage.map((p) => (
                        <tr key={p.id} style={{ borderBottom: "1px solid #F3F4F6" }} className="hover:bg-gray-50">
                          <td style={{ padding: "8px 12px" }}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(p.id)}
                              onChange={() => toggleSelect(p.id)}
                              style={{ width: "16px", height: "16px", accentColor: "#7C3AED" }}
                            />
                          </td>
                          <td style={{ padding: "8px 12px", fontSize: "13px", fontWeight: 500, maxWidth: "300px" }} className="truncate">{p.name}</td>
                          <td style={{ padding: "8px 12px", fontSize: "12px", color: "#6B7280", fontFamily: "monospace" }}>{p.sku || "—"}</td>
                          <td style={{ padding: "8px 12px", fontSize: "12px", color: "#9CA3AF" }}>{p.category?.name || "—"}</td>
                          <td style={{ padding: "8px 12px", fontSize: "13px", fontWeight: 600, textAlign: "right", color: p.stock > 0 ? "#16A34A" : "#DC2626" }}>{p.stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center p-3 rounded-lg" style={{ background: "#F9FAFB" }}>
      <p style={{ fontSize: "12px", color: "#9CA3AF", marginBottom: "4px" }}>{label}</p>
      <p style={{ fontSize: "22px", fontWeight: 700, color: color || "#0A0A0A" }}>{value.toLocaleString()}</p>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{label}</p>
      <p style={{ fontSize: "18px", fontWeight: 700, color: color || "#0A0A0A" }}>{value.toLocaleString()}</p>
    </div>
  );
}
