"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = { PENDING: "Очікує", APPROVED: "Затверджено", PAID: "Виплачено" };
const STATUS_COLORS: Record<string, string> = { PENDING: "bg-primary/10 text-primary-dark", APPROVED: "bg-blue-50 text-blue-700", PAID: "bg-green-50 text-green-700" };

export default function CommissionsAdminPage() {
  const { data: session } = useSession();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const role = (session?.user as any)?.role;

  const fetchData = async () => {
    setLoading(true);
    // Fetch all commission records via admin endpoint
    const res = await fetch("/api/erp/commissions/rates");
    // We need a different endpoint for all records. For now, use a workaround.
    // Let's create a simple query via sales documents
    const salesRes = await fetch("/api/erp/sales?status=CONFIRMED");
    const salesDocs = await salesRes.json();

    // Collect all commission records from confirmed sales
    const allRecords: any[] = [];
    for (const doc of (Array.isArray(salesDocs) ? salesDocs : [])) {
      const detailRes = await fetch(`/api/erp/sales/${doc.id}`);
      const detail = await detailRes.json();
      if (detail.commissions) {
        for (const c of detail.commissions) {
          allRecords.push({
            ...c,
            docNumber: detail.number,
            docId: detail.id,
            salesRepName: detail.salesRep?.name,
            counterpartyName: detail.counterparty?.name,
            confirmedAt: detail.confirmedAt,
          });
        }
      }
    }

    setRecords(allRecords);
    setLoading(false);
  };

  useEffect(() => {
    if (role === "ADMIN") fetchData();
  }, [role]);

  const handleAction = async (id: string, action: "approve" | "pay") => {
    await fetch(`/api/erp/commissions/${id}/${action}`, { method: "POST" });
    fetchData();
  };

  if (role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const totalPending = records.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.commissionAmount, 0);
  const totalApproved = records.filter((r) => r.status === "APPROVED").reduce((s, r) => s + r.commissionAmount, 0);
  const totalPaid = records.filter((r) => r.status === "PAID").reduce((s, r) => s + r.commissionAmount, 0);

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
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Мотивація</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Комісії торгових менеджерів</p>
            </div>
          </div>
          <Link
            href="/admin/erp/commissions/rates"
            style={{ background: "#FFD600", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", textDecoration: "none" }}
          >
            Налаштувати ставки
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
            <p style={{ fontSize: "13px", color: "#6B7280" }}>Очікує затвердження</p>
            <p style={{ fontSize: "22px", fontWeight: 700, color: "#EAB308" }}>{formatPrice(totalPending)}</p>
          </div>
          <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
            <p style={{ fontSize: "13px", color: "#6B7280" }}>Затверджено (до виплати)</p>
            <p style={{ fontSize: "22px", fontWeight: 700, color: "#3B82F6" }}>{formatPrice(totalApproved)}</p>
          </div>
          <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
            <p style={{ fontSize: "13px", color: "#6B7280" }}>Виплачено</p>
            <p style={{ fontSize: "22px", fontWeight: 700, color: "#22C55E" }}>{formatPrice(totalPaid)}</p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : records.length === 0 ? (
          <div className="text-center py-12"><p style={{ color: "#9E9E9E" }}>Комісій поки немає</p></div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Документ</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Торговий</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Бренд</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Прибуток</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Ставка</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Комісія</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Статус</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Дії</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }} className="hover:bg-g50">
                      <td style={{ padding: "14px 16px" }}>
                        <Link href={`/admin/erp/sales/${r.docId}`} className="text-blue-600 hover:text-blue-800 text-sm font-semibold">
                          {r.docNumber}
                        </Link>
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "14px" }}>{r.salesRepName}</td>
                      <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 500 }}>{r.brand}</td>
                      <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", color: "#16A34A" }}>{formatPrice(r.profitAmount)}</td>
                      <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px" }}>{r.commissionRate}%</td>
                      <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", fontWeight: 700, color: "#F59E0B" }}>{formatPrice(r.commissionAmount)}</td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span className={`px-2 py-1 rounded-md text-xs font-medium ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <div className="flex items-center justify-center gap-1">
                          {r.status === "PENDING" && (
                            <button onClick={() => handleAction(r.id, "approve")} className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 bg-blue-50 rounded">
                              Затвердити
                            </button>
                          )}
                          {r.status === "APPROVED" && (
                            <button onClick={() => handleAction(r.id, "pay")} className="text-green-600 hover:text-green-800 text-xs font-medium px-2 py-1 bg-green-50 rounded">
                              Виплатити
                            </button>
                          )}
                          {r.status === "PAID" && (
                            <span style={{ fontSize: "12px", color: "#9CA3AF" }}>Виплачено</span>
                          )}
                        </div>
                      </td>
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
