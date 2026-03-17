"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Counterparty = {
  id: string;
  name: string;
  code: string | null;
  type: "SUPPLIER" | "CUSTOMER" | "BOTH";
  phone: string | null;
  email: string | null;
  address: string | null;
  deliveryAddress: string | null;
  contactPerson: string | null;
  notes: string | null;
  isActive: boolean;
  _count: { purchaseOrders: number; salesDocuments: number; invoices: number };
};

const TYPE_LABELS: Record<string, string> = {
  SUPPLIER: "Постачальник",
  CUSTOMER: "Покупець",
  BOTH: "Постачальник/Покупець",
};

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  SUPPLIER: { bg: "bg-blue-50", text: "text-blue-700" },
  CUSTOMER: { bg: "bg-emerald-50", text: "text-emerald-700" },
  BOTH: { bg: "bg-purple-50", text: "text-purple-700" },
};

export default function CounterpartiesPage() {
  const { data: session } = useSession();
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    type: "BOTH" as string,
    phone: "",
    email: "",
    address: "",
    deliveryAddress: "",
    contactPerson: "",
    notes: "",
  });

  const role = (session?.user as any)?.role;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filterType) params.set("type", filterType);
    const res = await fetch(`/api/erp/counterparties?${params}`);
    const data = await res.json();
    setCounterparties(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [search, filterType]);

  useEffect(() => {
    if (role === "ADMIN" || role === "SALES") fetchData();
  }, [role, fetchData]);

  const resetForm = () => {
    setForm({ name: "", code: "", type: "BOTH", phone: "", email: "", address: "", deliveryAddress: "", contactPerson: "", notes: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (c: Counterparty) => {
    setForm({
      name: c.name,
      code: c.code || "",
      type: c.type,
      phone: c.phone || "",
      email: c.email || "",
      address: c.address || "",
      deliveryAddress: c.deliveryAddress || "",
      contactPerson: c.contactPerson || "",
      notes: c.notes || "",
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const url = editingId
      ? `/api/erp/counterparties/${editingId}`
      : "/api/erp/counterparties";
    const method = editingId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (res.ok) {
      resetForm();
      fetchData();
    } else {
      const err = await res.json();
      alert(err.error || "Помилка збереження");
    }
    setSaving(false);
  };

  const toggleActive = async (c: Counterparty) => {
    await fetch(`/api/erp/counterparties/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !c.isActive }),
    });
    fetchData();
  };

  const handleDelete = async (c: Counterparty) => {
    if (!confirm(`Видалити контрагента "${c.name}"?`)) return;
    const res = await fetch(`/api/erp/counterparties/${c.id}`, { method: "DELETE" });
    if (res.ok) {
      fetchData();
    } else {
      const err = await res.json();
      alert(err.error || "Помилка видалення");
    }
  };

  if (role !== "ADMIN" && role !== "SALES") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-[#0A0A0A]">Доступ заборонено</h1>
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
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Контрагенти</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Постачальники та покупці</p>
            </div>
          </div>
          {role === "ADMIN" && (
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              style={{ background: "#FFD600", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}
            >
              + Додати контрагента
            </button>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <form onSubmit={(e) => { e.preventDefault(); fetchData(); }} className="flex gap-2 flex-1 min-w-[200px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук за назвою, кодом, контактом..."
              style={{ flex: 1, padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
            />
            <button type="submit" style={{ background: "#FFD600", padding: "10px 16px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
              Шукати
            </button>
          </form>
          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); }}
            style={{ padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
          >
            <option value="">Всі типи</option>
            <option value="SUPPLIER">Постачальники</option>
            <option value="CUSTOMER">Покупці</option>
            <option value="BOTH">Постачальник/Покупець</option>
          </select>
        </div>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
              <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "20px" }}>
                {editingId ? "Редагувати контрагента" : "Новий контрагент"}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Назва *</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-g600 mb-1">Код (ЄДРПОУ)</label>
                    <input
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-g600 mb-1">Тип</label>
                    <select
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value })}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                    >
                      <option value="BOTH">Постачальник/Покупець</option>
                      <option value="SUPPLIER">Постачальник</option>
                      <option value="CUSTOMER">Покупець</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-g600 mb-1">Телефон</label>
                    <input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-g600 mb-1">Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Юридична / фактична адреса</label>
                  <input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="вул. Незалежності 1, Вінниця"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">
                    Адреса доставки (НП відділення / адресна доставка)
                  </label>
                  <input
                    value={form.deliveryAddress}
                    onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
                    placeholder="Нова Пошта, відд. №5, Вінниця / або: вул. Соборна 10"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                  />
                  <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "4px" }}>
                    Використовується для дорожніх листів та планувальника маршрутів
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Контактна особа</label>
                  <input
                    value={form.contactPerson}
                    onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Примітки</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px", resize: "vertical" }}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    style={{ flex: 1, background: "#FFD600", color: "#0A0A0A", padding: "12px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: saving ? 0.6 : 1 }}
                  >
                    {saving ? "Збереження..." : editingId ? "Зберегти" : "Створити"}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    style={{ padding: "12px 20px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px", fontWeight: 500 }}
                  >
                    Скасувати
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : counterparties.length === 0 ? (
          <div className="text-center py-12">
            <p style={{ color: "#9E9E9E", fontSize: "16px" }}>Контрагентів не знайдено</p>
            {role === "ADMIN" && (
              <button
                onClick={() => setShowForm(true)}
                style={{ marginTop: "12px", color: "#FFD600", fontWeight: 600, fontSize: "14px" }}
              >
                Додати першого контрагента
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Назва</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Код</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Тип</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Контакт</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Документи</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Статус</th>
                    {role === "ADMIN" && (
                      <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Дії</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {counterparties.map((c) => {
                    const typeColor = TYPE_COLORS[c.type] || TYPE_COLORS.BOTH;
                    const docCount = c._count.purchaseOrders + c._count.salesDocuments + c._count.invoices;
                    return (
                      <tr
                        key={c.id}
                        style={{ borderBottom: "1px solid #F3F4F6", opacity: c.isActive ? 1 : 0.5 }}
                        className="hover:bg-g50 transition-colors"
                      >
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontWeight: 600, fontSize: "14px", color: "#0A0A0A" }}>{c.name}</div>
                          {c.contactPerson && (
                            <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "2px" }}>{c.contactPerson}</div>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: "14px", color: "#6B7280", fontFamily: "monospace" }}>
                          {c.code || "—"}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span className={`${typeColor.bg} ${typeColor.text} px-2 py-1 rounded-md text-xs font-medium`}>
                            {TYPE_LABELS[c.type]}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6B7280" }}>
                          {c.phone && <div>{c.phone}</div>}
                          {c.email && <div>{c.email}</div>}
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "center", fontSize: "14px", color: "#6B7280" }}>
                          {docCount}
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "center" }}>
                          <span
                            className={`px-2 py-1 rounded-md text-xs font-medium ${
                              c.isActive ? "bg-green-50 text-green-700" : "bg-g100 text-g400"
                            }`}
                          >
                            {c.isActive ? "Активний" : "Неактивний"}
                          </span>
                        </td>
                        {role === "ADMIN" && (
                          <td style={{ padding: "14px 16px", textAlign: "center" }}>
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => startEdit(c)}
                                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                              >
                                Ред.
                              </button>
                              <button
                                onClick={() => toggleActive(c)}
                                className="text-amber-600 hover:text-amber-800 text-sm font-medium"
                              >
                                {c.isActive ? "Вимк." : "Увімк."}
                              </button>
                              {docCount === 0 && (
                                <button
                                  onClick={() => handleDelete(c)}
                                  className="text-red-500 hover:text-red-700 text-sm font-medium"
                                >
                                  Вид.
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
