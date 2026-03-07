"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/utils";

export default function AdminProductsPage() {
  const { data: session } = useSession();
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [form, setForm] = useState({ name: "", description: "", price: "", stock: "", categoryId: "" });
  const [saving, setSaving] = useState(false);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    Promise.all([
      fetch("/api/products").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
    ]).then(([prods, cats]) => {
      setProducts(prods);
      setCategories(cats);
      setLoading(false);
    });
  }, []);

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
      const saved = await res.json();
      if (editingProduct) {
        setProducts((prev) => prev.map((p) => (p.id === saved.id ? { ...p, ...saved } : p)));
      } else {
        setProducts((prev) => [saved, ...prev]);
      }
      resetForm();
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
      setProducts((prev) => prev.filter((p) => p.id !== id));
    }
  };

  if (role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-red-600 font-bold">Доступ заборонено</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Управління товарами</h1>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-orange-500 transition"
        >
          + Додати товар
        </button>
      </div>

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
                  <tr key={product.id} className="hover:bg-gray-50">
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
        </div>
      )}
    </div>
  );
}
