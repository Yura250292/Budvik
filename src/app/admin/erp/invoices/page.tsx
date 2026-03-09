"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const PAYMENT_LABELS: Record<string, string> = { UNPAID: "Не оплачено", PARTIAL: "Частково", PAID: "Оплачено" };
const PAYMENT_COLORS: Record<string, string> = { UNPAID: "bg-red-50 text-red-700", PARTIAL: "bg-primary/10 text-primary-dark", PAID: "bg-green-50 text-green-700" };

export default function InvoicesPage() {
  const { data: session } = useSession();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPayment, setFilterPayment] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [salesDocs, setSalesDocs] = useState<any[]>([]);
  const [form, setForm] = useState({ counterpartyId: "", salesDocumentId: "", totalAmount: "", dueDate: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const role = (session?.user as any)?.role;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterPayment) params.set("paymentStatus", filterPayment);
    const res = await fetch(`/api/erp/invoices?${params}`);
    const data = await res.json();
    setInvoices(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [filterPayment]);

  useEffect(() => {
    if (role === "ADMIN" || role === "SALES") {
      fetchData();
      // Load customers for form
      Promise.all([
        fetch("/api/erp/counterparties?type=CUSTOMER").then((r) => r.json()),
        fetch("/api/erp/counterparties?type=BOTH").then((r) => r.json()),
        fetch("/api/erp/sales?status=CONFIRMED").then((r) => r.json()),
      ]).then(([cust, both, sales]) => {
        const all = [...(Array.isArray(cust) ? cust : []), ...(Array.isArray(both) ? both : [])];
        setCustomers(all.filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i));
        setSalesDocs(Array.isArray(sales) ? sales : []);
      });
    }
  }, [role, fetchData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/erp/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        totalAmount: parseFloat(form.totalAmount) || 0,
      }),
    });
    if (res.ok) {
      setShowCreateForm(false);
      setForm({ counterpartyId: "", salesDocumentId: "", totalAmount: "", dueDate: "", notes: "" });
      fetchData();
    } else {
      const err = await res.json();
      alert(err.error || "Помилка");
    }
    setSaving(false);
  };

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Видаткові накладні</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Генерація та трекінг оплат</p>
            </div>
          </div>
          {role === "ADMIN" && (
            <button onClick={() => setShowCreateForm(true)}
              style={{ background: "#FFD600", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
              + Нова накладна
            </button>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Filters */}
        <div className="flex gap-3 mb-6">
          {["", "UNPAID", "PARTIAL", "PAID"].map((s) => (
            <button key={s} onClick={() => setFilterPayment(s)}
              style={{
                padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 500,
                background: filterPayment === s ? "#FFD600" : "white",
                border: `1px solid ${filterPayment === s ? "#FFD600" : "#E5E7EB"}`,
              }}>
              {s === "" ? "Всі" : PAYMENT_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Create form modal */}
        {showCreateForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
              <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "20px" }}>Нова видаткова накладна</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Контрагент *</label>
                  <select value={form.counterpartyId} onChange={(e) => setForm({ ...form, counterpartyId: e.target.value })} required
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}>
                    <option value="">Оберіть...</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Документ продажу</label>
                  <select value={form.salesDocumentId} onChange={(e) => {
                    const docId = e.target.value;
                    setForm({ ...form, salesDocumentId: docId });
                    if (docId) {
                      const doc = salesDocs.find((d) => d.id === docId);
                      if (doc) {
                        setForm((f) => ({ ...f, salesDocumentId: docId, totalAmount: String(doc.totalAmount), counterpartyId: doc.counterpartyId || f.counterpartyId }));
                      }
                    }
                  }}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}>
                    <option value="">Без прив'язки</option>
                    {salesDocs.map((d) => <option key={d.id} value={d.id}>{d.number} — {formatPrice(d.totalAmount)}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-g600 mb-1">Сума *</label>
                    <input type="number" step="0.01" required value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-g600 mb-1">Дата оплати</label>
                    <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={saving}
                    style={{ flex: 1, background: "#FFD600", padding: "12px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: saving ? 0.6 : 1 }}>
                    {saving ? "..." : "Створити"}
                  </button>
                  <button type="button" onClick={() => setShowCreateForm(false)}
                    style={{ padding: "12px 20px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}>
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
        ) : invoices.length === 0 ? (
          <div className="text-center py-12"><p style={{ color: "#9E9E9E" }}>Накладних не знайдено</p></div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Номер</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Контрагент</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Документ</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Сума</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Оплачено</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Статус</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-g50 transition-colors" style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "14px 16px" }}>
                        <Link href={`/admin/erp/invoices/${inv.id}`} className="text-blue-600 hover:text-blue-800 font-semibold text-sm">
                          {inv.number}
                        </Link>
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 500 }}>{inv.counterparty?.name}</td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6B7280" }}>
                        {inv.salesDocument ? inv.salesDocument.number : "—"}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", fontWeight: 600 }}>{formatPrice(inv.totalAmount)}</td>
                      <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", color: inv.paidAmount > 0 ? "#16A34A" : "#6B7280" }}>
                        {formatPrice(inv.paidAmount)}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span className={`px-2 py-1 rounded-md text-xs font-medium ${PAYMENT_COLORS[inv.paymentStatus]}`}>
                          {PAYMENT_LABELS[inv.paymentStatus]}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6B7280" }}>{formatDate(inv.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
