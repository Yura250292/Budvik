"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

const PROMOTION_TYPES = [
  { value: "QUANTITY_PRICE", label: "Ступінчасті ціни", desc: "Різна ціна залежно від кількості" },
  { value: "AMOUNT_DISCOUNT", label: "Знижка від суми", desc: "Відсоткова знижка при досягненні суми замовлення" },
  { value: "CASHBACK_BOLTS", label: "Кешбек болтами", desc: "Повернення балів на рахунок клієнта" },
  { value: "PRODUCT_DISCOUNT", label: "Знижка на товари", desc: "Фіксована знижка на конкретні товари або категорії" },
];

const TYPE_COLORS: Record<string, string> = {
  QUANTITY_PRICE: "bg-blue-100 text-blue-800",
  AMOUNT_DISCOUNT: "bg-green-100 text-green-800",
  CASHBACK_BOLTS: "bg-yellow-100 text-yellow-800",
  PRODUCT_DISCOUNT: "bg-purple-100 text-purple-800",
};

interface Tier {
  minQty?: number;
  price?: number;
  minAmount?: number;
  discountPercent?: number;
  cashbackPercent?: number;
}

interface Promotion {
  id: string;
  name: string;
  description: string | null;
  type: string;
  conditions: Tier[];
  productIds: string[];
  categoryIds: string[];
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
}

const defaultTierForType = (type: string): Tier => {
  if (type === "QUANTITY_PRICE") return { minQty: 1, price: 0 };
  if (type === "AMOUNT_DISCOUNT") return { minAmount: 0, discountPercent: 0 };
  if (type === "CASHBACK_BOLTS") return { minAmount: 0, cashbackPercent: 0 };
  return { discountPercent: 0 };
};

const defaultForm = () => ({
  name: "",
  description: "",
  type: "QUANTITY_PRICE",
  tiers: [{ minQty: 1, price: 0 }] as Tier[],
  productIds: "",
  categoryIds: [] as string[],
  isActive: true,
  startDate: "",
  endDate: "",
  sortOrder: 0,
});

function describeTiers(type: string, tiers: Tier[]): string {
  if (!tiers || tiers.length === 0) return "—";
  if (type === "QUANTITY_PRICE") {
    return tiers.map((t) => `від ${t.minQty} шт → ${t.price} грн`).join(", ");
  }
  if (type === "AMOUNT_DISCOUNT") {
    return tiers.map((t) => `від ${t.minAmount} грн → -${t.discountPercent}%`).join(", ");
  }
  if (type === "CASHBACK_BOLTS") {
    return tiers.map((t) => `від ${t.minAmount} грн → кешбек ${t.cashbackPercent}%`).join(", ");
  }
  if (type === "PRODUCT_DISCOUNT") {
    return tiers.map((t) => `-${t.discountPercent}%`).join(", ");
  }
  return "—";
}

export default function PromotionsPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(defaultForm());

  const loadData = useCallback(async () => {
    setLoading(true);
    const [promosRes, catsRes] = await Promise.all([
      fetch("/api/admin/promotions").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
    ]);
    setPromotions(Array.isArray(promosRes) ? promosRes : []);
    setCategories(Array.isArray(catsRes) ? catsRes : []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setEditing(null);
    setShowForm(false);
    setForm(defaultForm());
  };

  const openNew = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (p: Promotion) => {
    setEditing(p.id);
    setForm({
      name: p.name,
      description: p.description || "",
      type: p.type,
      tiers: p.conditions.length > 0 ? p.conditions : [defaultTierForType(p.type)],
      productIds: p.productIds.join(", "),
      categoryIds: p.categoryIds,
      isActive: p.isActive,
      startDate: p.startDate ? p.startDate.slice(0, 16) : "",
      endDate: p.endDate ? p.endDate.slice(0, 16) : "",
      sortOrder: p.sortOrder,
    });
    setShowForm(true);
  };

  const handleTypeChange = (newType: string) => {
    setForm((f) => ({ ...f, type: newType, tiers: [defaultTierForType(newType)] }));
  };

  const addTier = () => {
    setForm((f) => ({ ...f, tiers: [...f.tiers, defaultTierForType(f.type)] }));
  };

  const removeTier = (idx: number) => {
    setForm((f) => ({ ...f, tiers: f.tiers.filter((_, i) => i !== idx) }));
  };

  const updateTier = (idx: number, field: string, value: number) => {
    setForm((f) => {
      const tiers = [...f.tiers];
      tiers[idx] = { ...tiers[idx], [field]: value };
      return { ...f, tiers };
    });
  };

  const toggleCategory = (id: string) => {
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(id)
        ? f.categoryIds.filter((c) => c !== id)
        : [...f.categoryIds, id],
    }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return alert("Введіть назву акції");
    if (form.tiers.length === 0) return alert("Додайте хоча б один тир умов");

    setSaving(true);
    const body: any = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      type: form.type,
      conditions: form.tiers,
      productIds: form.productIds.split(",").map((s) => s.trim()).filter(Boolean),
      categoryIds: form.categoryIds,
      isActive: form.isActive,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      sortOrder: form.sortOrder,
    };
    if (editing) body.id = editing;

    const res = await fetch("/api/admin/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);
    if (res.ok) {
      resetForm();
      loadData();
    } else {
      const err = await res.json();
      alert(err.error || "Помилка збереження");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Видалити акцію "${name}"?`)) return;
    await fetch(`/api/admin/promotions?id=${id}`, { method: "DELETE" });
    loadData();
  };

  if (role !== "ADMIN" && role !== "MANAGER") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <p className="text-g400">Доступ заборонено</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-g200 px-4 sm:px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-btn)] border border-g200 text-g400 hover:text-bk hover:border-g300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-lg font-bold text-bk leading-tight">Акції</h1>
              <p className="text-xs text-g400">Знижки, кешбек, об'ємні ціни</p>
            </div>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-semibold text-bk bg-primary hover:bg-primary-hover rounded-[var(--radius-btn)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Нова акція
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-[var(--radius-card)] border border-g200 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5">
            <h2 className="text-[15px] font-bold text-bk mb-4">
              {editing ? "Редагувати акцію" : "Нова акція"}
            </h2>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-[12px] font-semibold text-g400 uppercase tracking-wide mb-1">Назва</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Наприклад: Літній розпродаж кругів"
                  className="w-full border border-g200 rounded-[var(--radius-btn)] px-3 py-2 text-sm text-bk focus:outline-none focus:border-bk"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-[12px] font-semibold text-g400 uppercase tracking-wide mb-1">Опис (необов'язково)</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full border border-g200 rounded-[var(--radius-btn)] px-3 py-2 text-sm text-bk focus:outline-none focus:border-bk resize-none"
                />
              </div>

              {/* Type */}
              <div>
                <label className="block text-[12px] font-semibold text-g400 uppercase tracking-wide mb-1.5">Тип акції</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PROMOTION_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => handleTypeChange(t.value)}
                      className={`text-left px-3 py-2.5 rounded-[var(--radius-btn)] border transition-colors ${
                        form.type === t.value
                          ? "border-bk bg-bk text-white"
                          : "border-g200 hover:border-g300 text-bk"
                      }`}
                    >
                      <div className="text-[13px] font-semibold">{t.label}</div>
                      <div className={`text-[11px] mt-0.5 ${form.type === t.value ? "text-white/70" : "text-g400"}`}>{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Conditions / Tiers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[12px] font-semibold text-g400 uppercase tracking-wide">Умови</label>
                  {form.type !== "PRODUCT_DISCOUNT" && (
                    <button onClick={addTier} className="text-[12px] font-semibold text-bk hover:text-primary-dark transition-colors flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Додати рядок
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {form.tiers.map((tier, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      {form.type === "QUANTITY_PRICE" && (
                        <>
                          <span className="text-[12px] text-g400 whitespace-nowrap">від</span>
                          <input
                            type="number" min={1}
                            value={tier.minQty ?? ""}
                            onChange={(e) => updateTier(idx, "minQty", Number(e.target.value))}
                            className="w-20 border border-g200 rounded-[var(--radius-btn)] px-2 py-1.5 text-sm text-bk focus:outline-none focus:border-bk"
                          />
                          <span className="text-[12px] text-g400 whitespace-nowrap">шт →</span>
                          <input
                            type="number" min={0} step={0.01}
                            value={tier.price ?? ""}
                            onChange={(e) => updateTier(idx, "price", Number(e.target.value))}
                            className="w-24 border border-g200 rounded-[var(--radius-btn)] px-2 py-1.5 text-sm text-bk focus:outline-none focus:border-bk"
                          />
                          <span className="text-[12px] text-g400">грн/шт</span>
                        </>
                      )}
                      {form.type === "AMOUNT_DISCOUNT" && (
                        <>
                          <span className="text-[12px] text-g400 whitespace-nowrap">від</span>
                          <input
                            type="number" min={0}
                            value={tier.minAmount ?? ""}
                            onChange={(e) => updateTier(idx, "minAmount", Number(e.target.value))}
                            className="w-28 border border-g200 rounded-[var(--radius-btn)] px-2 py-1.5 text-sm text-bk focus:outline-none focus:border-bk"
                          />
                          <span className="text-[12px] text-g400 whitespace-nowrap">грн → знижка</span>
                          <input
                            type="number" min={0} max={100} step={0.1}
                            value={tier.discountPercent ?? ""}
                            onChange={(e) => updateTier(idx, "discountPercent", Number(e.target.value))}
                            className="w-20 border border-g200 rounded-[var(--radius-btn)] px-2 py-1.5 text-sm text-bk focus:outline-none focus:border-bk"
                          />
                          <span className="text-[12px] text-g400">%</span>
                        </>
                      )}
                      {form.type === "CASHBACK_BOLTS" && (
                        <>
                          <span className="text-[12px] text-g400 whitespace-nowrap">від</span>
                          <input
                            type="number" min={0}
                            value={tier.minAmount ?? ""}
                            onChange={(e) => updateTier(idx, "minAmount", Number(e.target.value))}
                            className="w-28 border border-g200 rounded-[var(--radius-btn)] px-2 py-1.5 text-sm text-bk focus:outline-none focus:border-bk"
                          />
                          <span className="text-[12px] text-g400 whitespace-nowrap">грн → кешбек</span>
                          <input
                            type="number" min={0} max={100} step={0.1}
                            value={tier.cashbackPercent ?? ""}
                            onChange={(e) => updateTier(idx, "cashbackPercent", Number(e.target.value))}
                            className="w-20 border border-g200 rounded-[var(--radius-btn)] px-2 py-1.5 text-sm text-bk focus:outline-none focus:border-bk"
                          />
                          <span className="text-[12px] text-g400">%</span>
                        </>
                      )}
                      {form.type === "PRODUCT_DISCOUNT" && (
                        <>
                          <span className="text-[12px] text-g400 whitespace-nowrap">Знижка</span>
                          <input
                            type="number" min={0} max={100} step={0.1}
                            value={tier.discountPercent ?? ""}
                            onChange={(e) => updateTier(idx, "discountPercent", Number(e.target.value))}
                            className="w-20 border border-g200 rounded-[var(--radius-btn)] px-2 py-1.5 text-sm text-bk focus:outline-none focus:border-bk"
                          />
                          <span className="text-[12px] text-g400">%</span>
                        </>
                      )}
                      {form.tiers.length > 1 && (
                        <button onClick={() => removeTier(idx)} className="ml-auto text-g300 hover:text-red-500 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Categories */}
              {categories.length > 0 && (
                <div>
                  <label className="block text-[12px] font-semibold text-g400 uppercase tracking-wide mb-1.5">Категорії (необов'язково)</label>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => toggleCategory(cat.id)}
                        className={`px-2.5 py-1 text-[12px] font-medium rounded-full border transition-colors ${
                          form.categoryIds.includes(cat.id)
                            ? "border-bk bg-bk text-white"
                            : "border-g200 text-g400 hover:border-g300"
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Product IDs */}
              {(form.type === "QUANTITY_PRICE" || form.type === "PRODUCT_DISCOUNT") && (
                <div>
                  <label className="block text-[12px] font-semibold text-g400 uppercase tracking-wide mb-1">ID товарів (через кому)</label>
                  <input
                    type="text"
                    value={form.productIds}
                    onChange={(e) => setForm((f) => ({ ...f, productIds: e.target.value }))}
                    placeholder="clxxx1, clxxx2, ..."
                    className="w-full border border-g200 rounded-[var(--radius-btn)] px-3 py-2 text-sm text-bk focus:outline-none focus:border-bk font-mono"
                  />
                </div>
              )}

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-g400 uppercase tracking-wide mb-1">Дата початку</label>
                  <input
                    type="datetime-local"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                    className="w-full border border-g200 rounded-[var(--radius-btn)] px-3 py-2 text-sm text-bk focus:outline-none focus:border-bk"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-g400 uppercase tracking-wide mb-1">Дата закінчення</label>
                  <input
                    type="datetime-local"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                    className="w-full border border-g200 rounded-[var(--radius-btn)] px-3 py-2 text-sm text-bk focus:outline-none focus:border-bk"
                  />
                </div>
              </div>

              {/* Sort + Active */}
              <div className="flex items-center gap-4">
                <div>
                  <label className="block text-[12px] font-semibold text-g400 uppercase tracking-wide mb-1">Порядок</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
                    className="w-20 border border-g200 rounded-[var(--radius-btn)] px-3 py-2 text-sm text-bk focus:outline-none focus:border-bk"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-4">
                  <div
                    onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                    className={`w-10 h-6 rounded-full transition-colors relative ${form.isActive ? "bg-bk" : "bg-g200"}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${form.isActive ? "translate-x-5" : "translate-x-1"}`} />
                  </div>
                  <span className="text-[13px] font-medium text-bk">Активна</span>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-g100">
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-5 py-2 text-[13px] font-semibold text-bk bg-primary hover:bg-primary-hover disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors"
              >
                {saving ? "Зберігається..." : editing ? "Зберегти зміни" : "Створити акцію"}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 text-[13px] font-medium text-g400 hover:text-bk border border-g200 rounded-[var(--radius-btn)] transition-colors"
              >
                Скасувати
              </button>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="text-center py-12 text-g400 text-sm">Завантаження...</div>
        ) : promotions.length === 0 ? (
          <div className="bg-white rounded-[var(--radius-card)] border border-g200 p-10 text-center">
            <div className="w-12 h-12 bg-g100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-g400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185z" />
              </svg>
            </div>
            <p className="text-[13px] font-semibold text-bk">Акцій ще немає</p>
            <p className="text-[12px] text-g400 mt-1">Натисніть "Нова акція", щоб створити першу</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {promotions.map((promo) => {
              const typeInfo = PROMOTION_TYPES.find((t) => t.value === promo.type);
              const now = new Date();
              const expired = promo.endDate && new Date(promo.endDate) < now;
              const notStarted = promo.startDate && new Date(promo.startDate) > now;
              return (
                <div
                  key={promo.id}
                  className={`bg-white rounded-[var(--radius-card)] border px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex items-start gap-3 ${
                    !promo.isActive || expired ? "border-g200 opacity-60" : "border-g200"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[promo.type] || "bg-g100 text-g400"}`}>
                        {typeInfo?.label || promo.type}
                      </span>
                      {!promo.isActive && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-g100 text-g400">Неактивна</span>
                      )}
                      {promo.isActive && expired && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Завершена</span>
                      )}
                      {promo.isActive && notStarted && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Не почалась</span>
                      )}
                      {promo.isActive && !expired && !notStarted && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">Активна</span>
                      )}
                    </div>
                    <h3 className="text-[14px] font-bold text-bk">{promo.name}</h3>
                    {promo.description && (
                      <p className="text-[12px] text-g400 mt-0.5">{promo.description}</p>
                    )}
                    <p className="text-[12px] text-g500 mt-1 font-medium">
                      {describeTiers(promo.type, promo.conditions)}
                    </p>
                    {(promo.startDate || promo.endDate) && (
                      <p className="text-[11px] text-g300 mt-1">
                        {promo.startDate && `З ${new Date(promo.startDate).toLocaleDateString("uk-UA")}`}
                        {promo.startDate && promo.endDate && " — "}
                        {promo.endDate && `до ${new Date(promo.endDate).toLocaleDateString("uk-UA")}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(promo)}
                      className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-btn)] border border-g200 text-g400 hover:text-bk hover:border-g300 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(promo.id, promo.name)}
                      className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-btn)] border border-g200 text-g400 hover:text-red-500 hover:border-red-200 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
