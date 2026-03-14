"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

export default function ReportsPage() {
  const { data: session } = useSession();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const role = (session?.user as any)?.role;

  const fetchData = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const res = await fetch(`/api/erp/reports?${params}`);
    setReport(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    if (role === "ADMIN" || role === "MANAGER") fetchData();
  }, [role]);

  const exportCSV = () => {
    if (!report) return;
    const rows = [
      ["Звіт", "Budvik ERP"],
      ["Період", `${fromDate || "Початок"} — ${toDate || "Зараз"}`],
      [""],
      ["Показник", "Сума (грн)"],
      ["Виручка", report.revenue],
      ["Собівартість", report.costOfGoods],
      ["Валовий прибуток", report.grossProfit],
      ["Маржа (%)", report.revenue > 0 ? Math.round((report.grossProfit / report.revenue) * 100) : 0],
      [""],
      ["Закупівлі", report.purchases],
      ["Комісії (нараховані)", report.commissions],
      ["Комісії (до виплати)", report.pendingCommissions],
      [""],
      ["Дебіторська заборгованість", report.receivables?.total || 0],
      ["Вартість складу", report.inventoryValue],
    ];

    if (report.receivables?.items?.length > 0) {
      rows.push([""], ["Дебіторська заборгованість - деталі"]);
      rows.push(["Номер", "Контрагент", "Сума", "Оплачено", "Залишок"]);
      for (const inv of report.receivables.items) {
        rows.push([inv.number, inv.counterparty, inv.total, inv.paid, inv.remaining]);
      }
    }

    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${fromDate || "all"}_${toDate || "now"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (role !== "ADMIN" && role !== "MANAGER") {
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
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Бухгалтерські звіти</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Фінансова звітність</p>
            </div>
          </div>
          <button onClick={exportCSV} disabled={!report}
            style={{ background: "#FFD600", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: report ? 1 : 0.5 }}>
            Експорт CSV
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Date filter */}
        <div className="flex gap-3 mb-6 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Від</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">До</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
          </div>
          <button onClick={fetchData} style={{ background: "#FFD600", padding: "8px 16px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
            Застосувати
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : !report ? (
          <div className="text-center py-12"><p style={{ color: "#9E9E9E" }}>Помилка завантаження</p></div>
        ) : (
          <>
            {/* P&L */}
            <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF" }}>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>Прибутки та збитки</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center" style={{ padding: "12px 0", borderBottom: "1px solid #F3F4F6" }}>
                  <span style={{ fontSize: "15px", color: "#0A0A0A" }}>Виручка ({report.salesCount} документів)</span>
                  <span style={{ fontSize: "18px", fontWeight: 700 }}>{formatPrice(report.revenue)}</span>
                </div>
                <div className="flex justify-between items-center" style={{ padding: "12px 0", borderBottom: "1px solid #F3F4F6" }}>
                  <span style={{ fontSize: "15px", color: "#DC2626" }}>Собівартість</span>
                  <span style={{ fontSize: "18px", fontWeight: 700, color: "#DC2626" }}>-{formatPrice(report.costOfGoods)}</span>
                </div>
                <div className="flex justify-between items-center" style={{ padding: "16px 0", borderBottom: "2px solid #0A0A0A" }}>
                  <span style={{ fontSize: "16px", fontWeight: 700 }}>Валовий прибуток</span>
                  <div className="text-right">
                    <span style={{ fontSize: "22px", fontWeight: 700, color: report.grossProfit > 0 ? "#16A34A" : "#DC2626" }}>
                      {formatPrice(report.grossProfit)}
                    </span>
                    <span style={{ fontSize: "14px", color: "#6B7280", marginLeft: "8px" }}>
                      ({report.revenue > 0 ? Math.round((report.grossProfit / report.revenue) * 100) : 0}%)
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center" style={{ padding: "12px 0", borderBottom: "1px solid #F3F4F6" }}>
                  <span style={{ fontSize: "15px", color: "#F59E0B" }}>Комісії торгових</span>
                  <span style={{ fontSize: "16px", fontWeight: 600, color: "#F59E0B" }}>-{formatPrice(report.commissions)}</span>
                </div>
                <div className="flex justify-between items-center" style={{ padding: "12px 0" }}>
                  <span style={{ fontSize: "16px", fontWeight: 700 }}>Чистий прибуток (до податків)</span>
                  <span style={{ fontSize: "20px", fontWeight: 700, color: (report.grossProfit - report.commissions) > 0 ? "#16A34A" : "#DC2626" }}>
                    {formatPrice(report.grossProfit - report.commissions)}
                  </span>
                </div>
              </div>
            </div>

            {/* Overview cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Закупівлі</p>
                <p style={{ fontSize: "20px", fontWeight: 700 }}>{formatPrice(report.purchases)}</p>
                <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{report.purchasesCount} документів</p>
              </div>
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Вартість складу</p>
                <p style={{ fontSize: "20px", fontWeight: 700 }}>{formatPrice(report.inventoryValue)}</p>
                <p style={{ fontSize: "12px", color: "#9CA3AF" }}>за закупівельними цінами</p>
              </div>
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Дебіторська заборгованість</p>
                <p style={{ fontSize: "20px", fontWeight: 700, color: report.receivables?.total > 0 ? "#DC2626" : "#16A34A" }}>
                  {formatPrice(report.receivables?.total || 0)}
                </p>
              </div>
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Комісії до виплати</p>
                <p style={{ fontSize: "20px", fontWeight: 700, color: "#F59E0B" }}>{formatPrice(report.pendingCommissions)}</p>
              </div>
            </div>

            {/* Receivables detail */}
            {report.receivables?.items?.length > 0 && (
              <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>Дебіторська заборгованість</h3>
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #EFEFEF" }}>
                      <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px", color: "#6B7280" }}>Накладна</th>
                      <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px", color: "#6B7280" }}>Контрагент</th>
                      <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Сума</th>
                      <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Оплачено</th>
                      <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Борг</th>
                      <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px", color: "#6B7280" }}>Термін</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.receivables.items.map((inv: any) => (
                      <tr key={inv.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "10px 0" }}>
                          <Link href={`/admin/erp/invoices/${inv.id}`} className="text-blue-600 hover:text-blue-800 text-sm font-semibold">
                            {inv.number}
                          </Link>
                        </td>
                        <td style={{ padding: "10px 0", fontSize: "14px" }}>{inv.counterparty}</td>
                        <td style={{ padding: "10px 0", textAlign: "right", fontSize: "14px" }}>{formatPrice(inv.total)}</td>
                        <td style={{ padding: "10px 0", textAlign: "right", fontSize: "14px", color: "#16A34A" }}>{formatPrice(inv.paid)}</td>
                        <td style={{ padding: "10px 0", textAlign: "right", fontSize: "14px", fontWeight: 700, color: "#DC2626" }}>{formatPrice(inv.remaining)}</td>
                        <td style={{ padding: "10px 0", fontSize: "13px", color: inv.dueDate && new Date(inv.dueDate) < new Date() ? "#DC2626" : "#6B7280" }}>
                          {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
