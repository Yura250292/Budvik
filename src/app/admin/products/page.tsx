"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { formatPrice } from "@/lib/utils";

const PAGE_SIZE = 50;

export default function AdminProductsPage() {
  const { data: session } = useSession();
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [form, setForm] = useState({ name: "", description: "", price: "", stock: "", categoryId: "" });
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
    setForm({ name: "", description: "", price: "", stock: "", categoryId: "" });
    setEditingProduct(null);
    setShowForm(false);
  };

  const startEdit = (product: any) => {
    setForm({
      name: product.name,
      description: product.description,
      price: String(product.price),
      stock: String(product.stock),
      categoryId: product.categoryId,
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

  if (role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-red-600 font-bold">Доступ заборонено</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Управління товарами</h1>
          <p className="text-sm text-gray-500 mt-1">Всього: {total} товарів</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-orange-500 transition"
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
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <button type="submit" className="bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition">
          Знайти
        </button>
        {searchQuery && (
          <button
            type="button"
            onClick={() => { setSearchQuery(""); fetchProducts(1); }}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50 transition"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Назва</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Категорія</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="">Оберіть категорію</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ціна (грн)</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
                min="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Кількість на складі</label>
              <input
                type="number"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                required
                min="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Опис</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="bg-orange-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-orange-500 transition disabled:opacity-50"
              >
                {saving ? "Збереження..." : editingProduct ? "Зберегти зміни" : "Додати товар"}
              </button>
              <button type="button" onClick={resetForm} className="px-6 py-2 border rounded-lg hover:bg-gray-50 transition">
                Скасувати
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Products Table */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 bg-gray-200 rounded"></div>)}
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Назва</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Категорія</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Ціна</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Склад</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Дії</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {products.map((product) => (
                  <tr key={product.id} className={`hover:bg-gray-50 ${product.stock === 0 ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{product.name}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{product.category?.name}</td>
                    <td className="px-4 py-3 text-right font-medium text-orange-600">{formatPrice(product.price)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={product.stock > 5 ? "text-green-600" : product.stock > 0 ? "text-orange-600" : "text-red-600"}>
                        {product.stock}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => startEdit(product)}
                        className="text-blue-600 hover:text-blue-800 text-sm mr-3"
                      >
                        Редагувати
                      </button>
                      <button
                        onClick={() => handleDelete(product.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Видалити
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <p className="text-sm text-gray-500">
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
                    <span key={`dots-${i}`} className="px-2 py-1.5 text-gray-400 text-sm">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => goToPage(p as number)}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                        p === page
                          ? "bg-orange-600 text-white"
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
