"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { formatPrice } from "@/lib/utils";

const PAGE_SIZE = 50;

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; row: string }> = {};
const COLOR_PALETTE = [
  { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", row: "bg-blue-50/40" },
  { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", row: "bg-emerald-50/40" },
  { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", row: "bg-purple-50/40" },
  { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", row: "bg-amber-50/40" },
  { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", row: "bg-rose-50/40" },
  { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200", row: "bg-cyan-50/40" },
  { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", row: "bg-orange-50/40" },
  { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", row: "bg-indigo-50/40" },
  { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", row: "bg-teal-50/40" },
  { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200", row: "bg-pink-50/40" },
];

function getCategoryColor(categoryId: string) {
  if (!CATEGORY_COLORS[categoryId]) {
    const idx = Object.keys(CATEGORY_COLORS).length % COLOR_PALETTE.length;
    CATEGORY_COLORS[categoryId] = COLOR_PALETTE[idx];
  }
  return CATEGORY_COLORS[categoryId];
}

export default function AdminProductsPage() {
  const { data: session } = useSession();
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [form, setForm] = useState({ name: "", description: "", price: "", wholesalePrice: "", stock: "", categoryId: "", isPromo: false, promoPrice: "", promoLabel: "", priority: "0" });
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const role = (session?.user as any)?.role;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const fetchProducts = useCallback(async (p: number, search?: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p) });
    if (search) params.set("search", search);
    const res = await fetch(`/api/products?${params}`);
    const data = await res.json();
    setProducts(data.products || []);
    setTotal(data.total || 0);
    setPage(data.page || 1);
    setLoading(false);
  }, []);

  useEffect(() => {
    Promise.all([
      fetchProducts(1),
      fetch("/api/categories").then((r) => r.json()),
    ]).then(([, cats]) => {
      setCategories(cats);
    });
  }, [fetchProducts]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchProducts(1, searchQuery);
  };

  const goToPage = (p: number) => {
    fetchProducts(p, searchQuery);
  };

  const resetForm = () => {
    setForm({ name: "", description: "", price: "", wholesalePrice: "", stock: "", categoryId: "", isPromo: false, promoPrice: "", promoLabel: "", priority: "0" });
    setEditingProduct(null);
    setShowForm(false);
  };

  const togglePromo = async (product: any) => {
    const res = await fetch("/api/admin/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        wholesalePrice: product.wholesalePrice,
        stock: product.stock,
        categoryId: product.categoryId,
        isPromo: !product.isPromo,
        promoPrice: product.promoPrice,
        promoLabel: product.promoLabel,
        priority: product.priority || 0,
      }),
    });
    if (res.ok) fetchProducts(page, searchQuery);
  };

  const togglePriority = async (product: any) => {
    const newPriority = (product.priority || 0) > 0 ? 0 : 10;
    const res = await fetch("/api/admin/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        wholesalePrice: product.wholesalePrice,
        stock: product.stock,
        categoryId: product.categoryId,
        isPromo: product.isPromo,
        promoPrice: product.promoPrice,
        promoLabel: product.promoLabel,
        priority: newPriority,
      }),
    });
    if (res.ok) fetchProducts(page, searchQuery);
  };

  const startEdit = (product: any) => {
    setForm({
      name: product.name,
      description: product.description,
      price: String(product.price),
      wholesalePrice: product.wholesalePrice ? String(product.wholesalePrice) : "",
      stock: String(product.stock),
      categoryId: product.categoryId,
      isPromo: product.isPromo || false,
      promoPrice: product.promoPrice ? String(product.promoPrice) : "",
      promoLabel: product.promoLabel || "",
      priority: String(product.priority || 0),
    });
    setEditingProduct(product);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const url = "/api/admin/products";
    const method = editingProduct ? "PUT" : "POST";
    const body = editingProduct ? { ...form, id: editingProduct.id } : form;

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      resetForm();
      fetchProducts(page, searchQuery);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Деактивувати цей товар?")) return;
    const res = await fetch("/api/admin/products", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      fetchProducts(page, searchQuery);
    }
  };

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-red-600 font-bold">Доступ заборонено</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-bk">Управління товарами</h1>
          <p className="text-sm text-g400 mt-1">Всього: {total} товарів</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="btn-primary px-4 py-2 font-semibold transition"
        >
          + Додати товар
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Пошук за назвою..."
          className="flex-1 border border-g300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button type="submit" className="bg-bk text-white px-4 py-2 rounded-lg hover:bg-g600 transition">
          Знайти
        </button>
        {searchQuery && (
          <button
            type="button"
            onClick={() => { setSearchQuery(""); fetchProducts(1); }}
            className="px-4 py-2 border rounded-lg hover:bg-g50 transition"
          >
            Скинути
          </button>
        )}
      </form>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white border rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">
            {editingProduct ? "Редагувати товар" : "Додати новий товар"}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Назва</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Категорія</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                required
                className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Оберіть категорію</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Ціна (грн)</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
                min="0"
                className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Оптова ціна (грн)</label>
              <input
                type="number"
                value={form.wholesalePrice}
                onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })}
                min="0"
                placeholder="Залишити порожнім якщо немає"
                className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Кількість на складі</label>
              <input
                type="number"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                required
                min="0"
                className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="md:col-span-2 border-t pt-4 mt-2">
              <div className="flex items-center gap-4 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isPromo}
                    onChange={(e) => setForm({ ...form, isPromo: e.target.checked })}
                    className="w-4 h-4 text-red-600 rounded border-g300 focus:ring-primary"
                  />
                  <span className="text-sm font-medium text-g600">Акційний товар</span>
                </label>
              </div>
              {form.isPromo && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-g600 mb-1">Акційна ціна (грн)</label>
                    <input
                      type="number"
                      value={form.promoPrice}
                      onChange={(e) => setForm({ ...form, promoPrice: e.target.value })}
                      min="0"
                      placeholder="Залишити порожнім для показу без знижки"
                      className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-g600 mb-1">Мітка акції</label>
                    <input
                      type="text"
                      value={form.promoLabel}
                      onChange={(e) => setForm({ ...form, promoLabel: e.target.value })}
                      placeholder='Напр. "Розпродаж", "-30%", "Хіт"'
                      className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-g600 mb-1">Опис</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                rows={3}
                className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary px-6 py-2 font-semibold transition disabled:opacity-50"
              >
                {saving ? "Збереження..." : editingProduct ? "Зберегти зміни" : "Додати товар"}
              </button>
              <button type="button" onClick={resetForm} className="px-6 py-2 border rounded-lg hover:bg-g50 transition">
                Скасувати
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Products Table */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 bg-g200 rounded"></div>)}
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-bk text-white">
                  <th className="text-left px-4 py-3 text-sm font-semibold">Назва</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold">Категорія</th>
                  <th className="text-right px-4 py-3 text-sm font-semibold">Ціна</th>
                  <th className="text-right px-4 py-3 text-sm font-semibold">Опт. ціна</th>
                  <th className="text-center px-4 py-3 text-sm font-semibold">Акція</th>
                  <th className="text-center px-4 py-3 text-sm font-semibold">Склад</th>
                  <th className="text-center px-4 py-3 text-sm font-semibold" title="Закріпити зверху каталогу">⭐</th>
                  <th className="text-right px-4 py-3 text-sm font-semibold">Дії</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {products.map((product) => {
                  const catColor = product.categoryId ? getCategoryColor(product.categoryId) : null;
                  return (
                    <tr
                      key={product.id}
                      className={`transition-colors hover:bg-g100 ${product.stock === 0 ? "opacity-50" : ""} ${catColor ? catColor.row : ""}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-bk text-sm">{product.name}</span>
                      </td>
                      <td className="px-4 py-3">
                        {product.category?.name && catColor ? (
                          <div className="relative group/cat">
                            <span
                              className={`inline-block max-w-[160px] truncate px-2 py-0.5 rounded-full text-[11px] font-semibold ${catColor.bg} ${catColor.text} border ${catColor.border} cursor-default`}
                            >
                              {product.category.name}
                            </span>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2.5 py-1.5 bg-bk text-white text-xs rounded-lg shadow-lg whitespace-nowrap opacity-0 invisible group-hover/cat:opacity-100 group-hover/cat:visible transition-all duration-150 z-50 pointer-events-none">
                              {product.category.name}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-bk"></div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-g400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold text-bk">{formatPrice(product.price)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {product.wholesalePrice ? (
                          <span className="font-semibold text-primary bg-primary/5 px-2 py-0.5 rounded">
                            {formatPrice(product.wholesalePrice)}
                          </span>
                        ) : (
                          <span className="text-g300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => togglePromo(product)}
                          className={`px-2.5 py-1 rounded-full text-xs font-bold transition ${
                            product.isPromo
                              ? "bg-red-500 text-white hover:bg-red-600 shadow-sm"
                              : "bg-g100 text-g400 hover:bg-g200"
                          }`}
                          title={product.isPromo ? "Зняти акцію" : "Додати в акцію"}
                        >
                          {product.isPromo ? (product.promoLabel || "Акція") : "—"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {product.stock === 0 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                            Немає
                          </span>
                        ) : product.stock <= 5 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                            {product.stock} шт
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">
                            {product.stock} шт
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => togglePriority(product)}
                          className={`p-1.5 rounded-lg transition ${
                            (product.priority || 0) > 0
                              ? "text-amber-500 hover:bg-amber-50"
                              : "text-g300 hover:bg-g100"
                          }`}
                          title={(product.priority || 0) > 0 ? "Зняти закріплення" : "Закріпити зверху"}
                        >
                          <svg className="w-4 h-4" fill={(product.priority || 0) > 0 ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => startEdit(product)}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition"
                            title="Редагувати"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button
                            onClick={() => handleDelete(product.id)}
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition"
                            title="Видалити"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-g50">
              <p className="text-sm text-g400">
                Сторінка {page} з {totalPages}
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded border text-sm hover:bg-white transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  &larr; Назад
                </button>

                {paginationRange(page, totalPages).map((p, i) =>
                  p === "..." ? (
                    <span key={`dots-${i}`} className="px-2 py-1.5 text-g400 text-sm">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => goToPage(p as number)}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                        p === page
                          ? "bg-primary text-bk font-semibold"
                          : "border hover:bg-white"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded border text-sm hover:bg-white transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Далі &rarr;
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function paginationRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const items: (number | "...")[] = [];
  items.push(1);

  if (current > 3) items.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) items.push(i);

  if (current < total - 2) items.push("...");

  items.push(total);
  return items;
}
