"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = { DRAFT: "Чернетка", CONFIRMED: "Підтверджений", CANCELLED: "Скасований" };
const STATUS_COLORS: Record<string, string> = { DRAFT: "#F59E0B", CONFIRMED: "#16A34A", CANCELLED: "#DC2626" };

export default function ClientDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch(`/api/erp/counterparties/${id}/summary`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [session, id]);

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ color: "#9CA3AF" }}>Завантаження...</div>;
  if (!data?.counterparty) return <div className="min-h-screen flex items-center justify-center"><p>Клієнта не знайдено</p></div>;

  const { counterparty: cp, debt, sales } = data;

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "12px 16px" }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/sales/clients" className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#F3F4F6" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 style={{ fontSize: "18px", fontWeight: 700 }} className="truncate">{cp.name}</h1>
            {cp.code && <p style={{ fontSize: "12px", color: "#9CA3AF" }}>ЄДРПОУ: {cp.code}</p>}
          </div>
          <Link href={`/sales/new?clientId=${id}`}
            className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#22C55E" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: "16px", paddingBottom: "40px" }}>
        {/* Contact info */}
        <div className="bg-white rounded-xl p-4 mb-4" style={{ border: "1px solid #EFEFEF" }}>
          {cp.phone && (
            <a href={`tel:${cp.phone}`} className="flex items-center gap-3 py-2" style={{ textDecoration: "none", color: "#0A0A0A" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#3B82F6" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              <span style={{ fontSize: "15px" }}>{cp.phone}</span>
            </a>
          )}
          {cp.address && (
            <div className="flex items-center gap-3 py-2" style={{ borderTop: cp.phone ? "1px solid #F3F4F6" : "none" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#6B7280" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              <span style={{ fontSize: "14px", color: "#6B7280" }}>{cp.address}</span>
            </div>
          )}
          {cp.contactPerson && (
            <div className="flex items-center gap-3 py-2" style={{ borderTop: "1px solid #F3F4F6" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#6B7280" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <span style={{ fontSize: "14px", color: "#6B7280" }}>{cp.contactPerson}</span>
            </div>
          )}
        </div>

        {/* Debt card */}
        <div className="bg-white rounded-xl p-4 mb-4" style={{
          border: debt.total > 0 ? "1px solid #FECACA" : "1px solid #EFEFEF",
          background: debt.total > 0 ? "#FEF2F2" : "white",
        }}>
          <div className="flex items-center justify-between mb-2">
            <p style={{ fontSize: "14px", fontWeight: 600, color: debt.total > 0 ? "#DC2626" : "#6B7280" }}>
              Дебіторська заборгованість
            </p>
            <p style={{ fontSize: "22px", fontWeight: 700, color: debt.total > 0 ? "#DC2626" : "#16A34A" }}>
              {formatPrice(debt.total)}
            </p>
          </div>
          {debt.invoices.length > 0 && (
            <div className="space-y-2 mt-3">
              {debt.invoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between" style={{ fontSize: "13px" }}>
                  <span style={{ color: "#6B7280" }}>{inv.number}</span>
                  <span style={{ fontWeight: 600, color: "#DC2626" }}>
                    {formatPrice(inv.totalAmount - inv.paidAmount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sales summary */}
        <div className="bg-white rounded-xl p-4 mb-4" style={{ border: "1px solid #EFEFEF" }}>
          <div className="flex items-center justify-between mb-3">
            <p style={{ fontSize: "14px", fontWeight: 600 }}>Продажі</p>
            <p style={{ fontSize: "14px", color: "#6B7280" }}>{sales.count} підтверджених, {formatPrice(sales.totalAmount)}</p>
          </div>
          {sales.items.length > 0 ? (
            <div className="space-y-2">
              {sales.items.slice(0, 10).map((s: any) => (
                <div key={s.id} className="flex items-center justify-between py-1" style={{ borderBottom: "1px solid #F9FAFB" }}>
                  <div>
                    <span style={{ fontSize: "14px", fontWeight: 500 }}>{s.number}</span>
                    <span style={{ fontSize: "12px", color: STATUS_COLORS[s.status], marginLeft: "6px" }}>
                      {STATUS_LABELS[s.status]}
                    </span>
                  </div>
                  <div className="text-right">
                    <p style={{ fontSize: "14px", fontWeight: 600 }}>{formatPrice(s.totalAmount)}</p>
                    <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{formatDate(s.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: "13px", color: "#9CA3AF" }}>Продажів поки немає</p>
          )}
        </div>

        {/* Action button */}
        <Link href={`/sales/new?clientId=${id}`}
          className="block w-full text-center"
          style={{
            background: "#22C55E", color: "white", padding: "14px", borderRadius: "12px",
            fontWeight: 700, fontSize: "16px", textDecoration: "none",
          }}>
          Нове замовлення для {cp.name.length > 20 ? cp.name.slice(0, 20) + "..." : cp.name}
        </Link>
      </div>
    </div>
  );
}
