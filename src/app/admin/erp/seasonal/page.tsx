"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

const SEASONS = [
  { value: "spring", label: "Весна", icon: "🌱" },
  { value: "summer", label: "Літо", icon: "☀️" },
  { value: "autumn", label: "Осінь", icon: "🍂" },
  { value: "winter", label: "Зима", icon: "❄️" },
  { value: "custom", label: "Довільний період", icon: "📅" },
];

const COLORS = ["#22C55E", "#F59E0B", "#EA580C", "#3B82F6", "#FFD600", "#DC2626", "#7C3AED", "#0A0A0A"];

interface Promo {
  id: string;
  title: string;
  description: string | null;
  season: string;
  icon: string | null;
  color: string;
  keywords: string[];
  categoryIds: string[];
  productIds: string[];
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
}

export default function SeasonalPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  // Form state
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", season: "spring", icon: "🌱", color: "#22C55E",
    keywords: "", categoryIds: [] as string[], productIds: "",
    isActive: true, startDate: "", endDate: "", sortOrder: 0,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const [promosRes, catsRes] = await Promise.all([
      fetch("/api/erp/seasonal").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
    ]);
    setPromos(promosRes.promos || []);
    setCategories(Array.isArray(catsRes) ? catsRes : []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setEditing(null);
    setForm({
      title: "", description: "", season: "spring", icon: "🌱", color: "#22C55E",
      keywords: "", categoryIds: [], productIds: "",
      isActive: true, startDate: "", endDate: "", sortOrder: 0,
    });
  };

  const editPromo = (p: Promo) => {
    setEditing(p.id);
    setForm({
      title: p.title,
      description: p.description || "",
      season: p.season,
      icon: p.icon || SEASONS.find((s) => s.value === p.season)?.icon || "",
      color: p.color,
      keywords: p.keywords.join(", "),
      categoryIds: p.categoryIds,
      productIds: p.productIds.join(", "),
      isActive: p.isActive,
      startDate: p.startDate ? p.startDate.slice(0, 10) : "",
      endDate: p.endDate ? p.endDate.slice(0, 10) : "",
      sortOrder: p.sortOrder,
    });
  };

  const handleSave = async () => {
    const body: any = {
      ...form,
      keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      productIds: form.productIds.split(",").map((k) => k.trim()).filter(Boolean),
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    };
    if (editing) body.id = editing;

    await fetch("/api/erp/seasonal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    resetForm();
    loadData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Видалити цю сезонну акцію?")) return;
    await fetch(`/api/erp/seasonal?id=${id}`, { method: "DELETE" });
    loadData();
  };

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-xl font-bold">Доступ заборонено</h1></div>;
  }

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
            <h1 style={{ fontSize: "26px", fontWeight: 700 }}>Сезонні товари</h1>
            <p style={{ fontSize: "13px", color: "#9CA3AF" }}>Керування сезонними рекомендаціями на головній та в каталозі</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Current season info */}
        <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
          <p style={{ fontSize: "14px", color: "#6B7280" }}>
            Поточний сезон (авто): <strong>{SEASONS.find((s) => s.value === (new Date().getMonth() >= 2 && new Date().getMonth() <= 4 ? "spring" : new Date().getMonth() >= 5 && new Date().getMonth() <= 7 ? "summer" : new Date().getMonth() >= 8 && new Date().getMonth() <= 10 ? "autumn" : "winter"))?.icon} {SEASONS.find((s) => s.value === (new Date().getMonth() >= 2 && new Date().getMonth() <= 4 ? "spring" : new Date().getMonth() >= 5 && new Date().getMonth() <= 7 ? "summer" : new Date().getMonth() >= 8 && new Date().getMonth() <= 10 ? "autumn" : "winter"))?.label}</strong>
          </p>
          <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>
            Якщо немає активних акцій — автоматично показуються сезонні товари за ключовими словами
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>
            {editing ? "Редагувати акцію" : "Нова сезонна акція"}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Назва</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Весняний розпродаж садової техніки"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: "#E5E7EB" }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Опис</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Актуальні товари для весняних робіт"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: "#E5E7EB" }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Сезон</label>
              <div className="flex gap-2">
                {SEASONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setForm({ ...form, season: s.value, icon: s.icon })}
                    className="px-3 py-2 rounded-lg text-sm font-medium border transition"
                    style={{
                      background: form.season === s.value ? "#0A0A0A" : "white",
                      color: form.season === s.value ? "#FFD600" : "#374151",
                      borderColor: form.season === s.value ? "#0A0A0A" : "#E5E7EB",
                    }}
                  >
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Колір акценту</label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, color: c })}
                    className="w-8 h-8 rounded-lg border-2 transition"
                    style={{ background: c, borderColor: form.color === c ? "#0A0A0A" : "transparent" }}
                  />
                ))}
              </div>
            </div>

            {form.season === "custom" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Дата початку</label>
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "#E5E7EB" }} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Дата кінця</label>
                  <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "#E5E7EB" }} />
                </div>
              </>
            )}

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Ключові слова (через кому) — для пошуку товарів по назві
              </label>
              <input
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                placeholder="тример, газонокосарка, обприскувач, шланг"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: "#E5E7EB" }}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">Категорії (опціонально)</label>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {categories.filter((c) => !/^\d+$/.test(c.name)).map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => {
                      const ids = form.categoryIds.includes(cat.id)
                        ? form.categoryIds.filter((id) => id !== cat.id)
                        : [...form.categoryIds, cat.id];
                      setForm({ ...form, categoryIds: ids });
                    }}
                    className="px-2 py-1 rounded text-xs font-medium border transition"
                    style={{
                      background: form.categoryIds.includes(cat.id) ? "#0A0A0A" : "white",
                      color: form.categoryIds.includes(cat.id) ? "#FFD600" : "#6B7280",
                      borderColor: form.categoryIds.includes(cat.id) ? "#0A0A0A" : "#E5E7EB",
                    }}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">
                ID конкретних товарів (через кому, опціонально)
              </label>
              <input
                value={form.productIds}
                onChange={(e) => setForm({ ...form, productIds: e.target.value })}
                placeholder="cmmxxxxxxx, cmmyyyyyyy"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: "#E5E7EB" }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={handleSave}
              disabled={!form.title}
              style={{
                padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px",
                background: "#FFD600", color: "#0A0A0A",
                opacity: form.title ? 1 : 0.5, cursor: form.title ? "pointer" : "not-allowed",
              }}
            >
              {editing ? "Зберегти" : "Створити"}
            </button>
            {editing && (
              <button onClick={resetForm} style={{ padding: "10px 20px", borderRadius: "8px", fontSize: "14px", color: "#6B7280", border: "1px solid #E5E7EB", background: "white" }}>
                Скасувати
              </button>
            )}
          </div>
        </div>

        {/* Existing promos */}
        {loading ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : promos.length > 0 ? (
          <div className="space-y-3">
            {promos.map((p) => (
              <div key={p.id} className="bg-white rounded-xl p-4 flex items-center gap-4" style={{ border: "1px solid #EFEFEF" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: `${p.color}20` }}>
                  {p.icon || SEASONS.find((s) => s.value === p.season)?.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: "15px", fontWeight: 600 }}>{p.title}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium" style={{
                      background: p.isActive ? "#DCFCE7" : "#FEE2E2",
                      color: p.isActive ? "#16A34A" : "#DC2626",
                    }}>
                      {p.isActive ? "Активна" : "Неактивна"}
                    </span>
                  </div>
                  <p style={{ fontSize: "12px", color: "#9CA3AF" }}>
                    {SEASONS.find((s) => s.value === p.season)?.label} | {p.keywords.length} ключових слів | {p.categoryIds.length} категорій | {p.productIds.length} товарів
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => editPromo(p)} style={{ padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, border: "1px solid #E5E7EB", background: "white" }}>
                    Редагувати
                  </button>
                  <button onClick={() => handleDelete(p.id)} style={{ padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, color: "#DC2626", border: "1px solid #FCA5A5", background: "white" }}>
                    Видалити
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl p-6 text-center" style={{ border: "1px solid #EFEFEF" }}>
            <p style={{ fontSize: "14px", color: "#9CA3AF" }}>Немає створених акцій — використовуються автоматичні сезонні рекомендації</p>
          </div>
        )}
      </div>
    </div>
  );
}
