"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const PAYMENT_LABELS: Record<string, string> = { UNPAID: "Не оплачено", PARTIAL: "Частково", PAID: "Оплачено" };
const PAYMENT_COLORS: Record<string, string> = { UNPAID: "bg-red-50 text-red-700", PARTIAL: "bg-primary/10 text-primary-dark", PAID: "bg-green-50 text-green-700" };
const METHOD_LABELS: Record<string, string> = { bank_transfer: "Безготівковий", cash: "Готівка", card: "Картка" };

export default function InvoiceDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const id = params.id as string;

  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", method: "bank_transfer", notes: "" });
  const [saving, setSaving] = useState(false);

  const role = (session?.user as any)?.role;

  const fetchInvoice = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/erp/invoices/${id}`);
    if (res.ok) setInvoice(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchInvoice(); }, [fetchInvoice]);

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/erp/invoices/${id}/payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payForm, amount: parseFloat(payForm.amount) }),
    });
    if (res.ok) {
      setShowPaymentForm(false);
      setPayForm({ amount: "", method: "bank_transfer", notes: "" });
      fetchInvoice();
    } else {
      const err = await res.json();
      alert(err.error || "Помилка");
    }
    setSaving(false);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ color: "#9E9E9E" }}>Завантаження...</div>;
  if (!invoice) return <div className="text-center py-16"><p>Накладну не знайдено</p></div>;

  const remaining = invoice.totalAmount - invoice.paidAmount;

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white print:hidden" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin/erp/invoices" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>{invoice.number}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${PAYMENT_COLORS[invoice.paymentStatus]}`}>
                  {PAYMENT_LABELS[invoice.paymentStatus]}
                </span>
                <span style={{ fontSize: "13px", color: "#9CA3AF" }}>{formatDate(invoice.createdAt)}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {invoice.paymentStatus !== "PAID" && role === "ADMIN" && (
              <button onClick={() => { setPayForm({ ...payForm, amount: String(remaining) }); setShowPaymentForm(true); }}
                style={{ background: "#22C55E", color: "white", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
                Записати оплату
              </button>
            )}
            <button onClick={handlePrint}
              style={{ background: "white", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", border: "1px solid #E5E7EB" }}>
              Друк
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Invoice info (printable) */}
        <div className="bg-white rounded-xl p-8 mb-6 print:shadow-none print:border-0" style={{ border: "1px solid #EFEFEF" }}>
          <div className="text-center mb-8 print:mb-4">
            <h2 style={{ fontSize: "24px", fontWeight: 700 }}>Видаткова накладна {invoice.number}</h2>
            <p style={{ fontSize: "14px", color: "#6B7280", marginTop: "4px" }}>від {formatDate(invoice.createdAt)}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <p style={{ fontSize: "12px", color: "#9CA3AF", textTransform: "uppercase", marginBottom: "4px" }}>Постачальник</p>
              <p style={{ fontSize: "16px", fontWeight: 600 }}>Budvik</p>
            </div>
            <div>
              <p style={{ fontSize: "12px", color: "#9CA3AF", textTransform: "uppercase", marginBottom: "4px" }}>Покупець</p>
              <p style={{ fontSize: "16px", fontWeight: 600 }}>{invoice.counterparty?.name}</p>
              {invoice.counterparty?.address && (
                <p style={{ fontSize: "13px", color: "#6B7280" }}>{invoice.counterparty.address}</p>
              )}
              {invoice.counterparty?.code && (
                <p style={{ fontSize: "13px", color: "#6B7280" }}>ЄДРПОУ: {invoice.counterparty.code}</p>
              )}
            </div>
          </div>

          {/* Items from linked sales document */}
          {invoice.salesDocument?.items && (
            <table className="w-full mb-6">
              <thead>
                <tr style={{ borderBottom: "2px solid #0A0A0A" }}>
                  <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px" }}>N</th>
                  <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px" }}>Найменування</th>
                  <th style={{ padding: "8px 0", textAlign: "center", fontSize: "13px" }}>Кількість</th>
                  <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px" }}>Ціна</th>
                  <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px" }}>Сума</th>
                </tr>
              </thead>
              <tbody>
                {invoice.salesDocument.items.map((item: any, idx: number) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #E5E7EB" }}>
                    <td style={{ padding: "8px 0", fontSize: "14px" }}>{idx + 1}</td>
                    <td style={{ padding: "8px 0", fontSize: "14px" }}>
                      {item.product?.name}
                      {item.product?.sku && <span style={{ color: "#9CA3AF", marginLeft: "8px", fontSize: "12px" }}>{item.product.sku}</span>}
                    </td>
                    <td style={{ padding: "8px 0", textAlign: "center", fontSize: "14px" }}>{item.quantity}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontSize: "14px" }}>{formatPrice(item.sellingPrice)}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontSize: "14px", fontWeight: 600 }}>{formatPrice(item.sellingPrice * item.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex justify-end">
            <div style={{ minWidth: "200px" }}>
              <div className="flex justify-between" style={{ padding: "8px 0", borderTop: "2px solid #0A0A0A" }}>
                <span style={{ fontSize: "16px", fontWeight: 700 }}>Всього:</span>
                <span style={{ fontSize: "18px", fontWeight: 700 }}>{formatPrice(invoice.totalAmount)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Payment history */}
        <div className="bg-white rounded-xl p-6 print:hidden" style={{ border: "1px solid #EFEFEF" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ fontSize: "16px", fontWeight: 600 }}>Оплати</h3>
            <div style={{ fontSize: "14px" }}>
              <span style={{ color: "#6B7280" }}>Оплачено: </span>
              <span style={{ fontWeight: 700, color: "#16A34A" }}>{formatPrice(invoice.paidAmount)}</span>
              <span style={{ color: "#6B7280" }}> / {formatPrice(invoice.totalAmount)}</span>
              {remaining > 0 && <span style={{ color: "#DC2626", marginLeft: "12px" }}>Залишок: {formatPrice(remaining)}</span>}
            </div>
          </div>

          {invoice.payments?.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #EFEFEF" }}>
                  <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px", color: "#6B7280" }}>Дата</th>
                  <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Сума</th>
                  <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px", color: "#6B7280" }}>Спосіб</th>
                  <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px", color: "#6B7280" }}>Примітка</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p: any) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "8px 0", fontSize: "14px" }}>{formatDate(p.createdAt)}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontSize: "14px", fontWeight: 600, color: "#16A34A" }}>{formatPrice(p.amount)}</td>
                    <td style={{ padding: "8px 0", fontSize: "14px" }}>{METHOD_LABELS[p.method] || p.method}</td>
                    <td style={{ padding: "8px 0", fontSize: "13px", color: "#6B7280" }}>{p.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: "#9CA3AF", fontSize: "14px" }}>Оплат поки немає</p>
          )}
        </div>

        {/* Payment form modal */}
        {showPaymentForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
              <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "20px" }}>Записати оплату</h2>
              <form onSubmit={handlePayment} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Сума *</label>
                  <input type="number" step="0.01" required value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Спосіб оплати</label>
                  <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}>
                    <option value="bank_transfer">Безготівковий</option>
                    <option value="cash">Готівка</option>
                    <option value="card">Картка</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Примітка</label>
                  <input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={saving}
                    style={{ flex: 1, background: "#22C55E", color: "white", padding: "12px", borderRadius: "8px", fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "..." : "Записати"}
                  </button>
                  <button type="button" onClick={() => setShowPaymentForm(false)}
                    style={{ padding: "12px 20px", borderRadius: "8px", border: "1px solid #E5E7EB" }}>
                    Скасувати
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
