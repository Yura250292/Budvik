"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { getCategoryGroup } from "@/lib/categoryGroups";

const resolveGroupName = (key: string) => getCategoryGroup(key)?.name || key;

const STATUS_LABELS: Record<string, string> = { PENDING: "Очікує", APPROVED: "Затверджено", PAID: "Виплачено" };
const STATUS_COLORS: Record<string, string> = { PENDING: "bg-primary/10 text-primary-dark", APPROVED: "bg-blue-50 text-blue-700", PAID: "bg-green-50 text-green-700" };
const MEDAL_COLORS = ["#FFD600", "#C0C0C0", "#CD7F32"];
const PERIOD_LABELS: Record<string, string> = { month: "Місяць", quarter: "Квартал", year: "Рік" };

type Tab = "my" | "leaderboard";

export default function MyCommissionsPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>("my");
  const [data, setData] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [period, setPeriod] = useState("month");

  const role = (session?.user as any)?.role;
  const userId = (session?.user as any)?.id;

  const fetchData = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const [commRes, lbRes] = await Promise.all([
      fetch(`/api/erp/commissions/my?${params}`),
      fetch(`/api/erp/leaderboard?period=${period}`),
    ]);
    setData(await commRes.json());
    setLeaderboard(await lbRes.json());
    setLoading(false);
  };

  useEffect(() => {
    if (role === "SALES" || role === "ADMIN") fetchData();
  }, [role]);

  useEffect(() => {
    if (role === "SALES" || role === "ADMIN") {
      fetch(`/api/erp/leaderboard?period=${period}`).then((r) => r.json()).then(setLeaderboard);
    }
  }, [period]);

  if (role !== "SALES" && role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const summary = data?.summary || {};
  const records = data?.records || [];

  const brandBreakdown = new Map<string, { sales: number; commission: number }>();
  for (const r of records) {
    const existing = brandBreakdown.get(r.brand) || { sales: 0, commission: 0 };
    existing.sales += r.saleAmount;
    existing.commission += r.commissionAmount;
    brandBreakdown.set(r.brand, existing);
  }

  const lbData = leaderboard?.leaderboard?.byTurnover || [];
  const myRank = lbData.findIndex((r: any) => r.id === userId) + 1;
  const myLbStats = lbData.find((r: any) => r.id === userId);

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link href="/dashboard" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
            <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Мотивація</h1>
            <p style={{ fontSize: "14px", color: "#6B7280" }}>{session?.user?.name}</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* My rank badge */}
        {myLbStats && myRank > 0 && (
          <div className="bg-white rounded-2xl p-5 mb-6 flex items-center gap-4" style={{ border: "2px solid #FFD60040", background: "linear-gradient(135deg, #FFFBEB, white)" }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black"
              style={{ background: myRank <= 3 ? MEDAL_COLORS[myRank - 1] : "#E5E7EB", color: myRank === 1 ? "#0A0A0A" : "white" }}>
              {myRank <= 3 ? (myRank === 1 ? "🥇" : myRank === 2 ? "🥈" : "🥉") : `#${myRank}`}
            </div>
            <div className="flex-1">
              <p style={{ fontSize: "13px", color: "#6B7280" }}>Твоя позиція в рейтингу ({PERIOD_LABELS[period]})</p>
              <p style={{ fontSize: "22px", fontWeight: 800 }}>
                {myRank} місце <span style={{ fontSize: "14px", fontWeight: 400, color: "#6B7280" }}>з {lbData.length}</span>
              </p>
            </div>
            <div className="text-right">
              <p style={{ fontSize: "13px", color: "#6B7280" }}>Оборот</p>
              <p style={{ fontSize: "18px", fontWeight: 700 }}>{formatPrice(myLbStats.turnover)}</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6" style={{ background: "#F3F4F6", borderRadius: "10px", padding: "3px", width: "fit-content" }}>
          <button onClick={() => setTab("my")}
            style={{ padding: "8px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, background: tab === "my" ? "white" : "transparent", boxShadow: tab === "my" ? "0 1px 3px rgba(0,0,0,0.1)" : "none", color: tab === "my" ? "#0A0A0A" : "#6B7280" }}>
            💵 Мої комісії
          </button>
          <button onClick={() => setTab("leaderboard")}
            style={{ padding: "8px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, background: tab === "leaderboard" ? "white" : "transparent", boxShadow: tab === "leaderboard" ? "0 1px 3px rgba(0,0,0,0.1)" : "none", color: tab === "leaderboard" ? "#0A0A0A" : "#6B7280" }}>
            🏆 Рейтинг
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : tab === "my" ? (
          <>
            {/* Date filter */}
            <div className="flex gap-3 mb-6 items-end flex-wrap">
              <div>
                <label className="block text-xs text-g400 mb-1">Від</label>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
              <div>
                <label className="block text-xs text-g400 mb-1">До</label>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
              <button onClick={fetchData} style={{ background: "#FFD600", padding: "8px 16px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
                Фільтрувати
              </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Загальні продажі</p>
                <p style={{ fontSize: "22px", fontWeight: 700 }}>{formatPrice(summary.totalSales || 0)}</p>
              </div>
              <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Зароблена комісія</p>
                <p style={{ fontSize: "22px", fontWeight: 700, color: "#F59E0B" }}>{formatPrice(summary.totalCommission || 0)}</p>
              </div>
              <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Виплачено</p>
                <p style={{ fontSize: "22px", fontWeight: 700, color: "#22C55E" }}>{formatPrice(summary.paidCommission || 0)}</p>
              </div>
            </div>

            {/* Brand breakdown */}
            {brandBreakdown.size > 0 && (
              <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>По групах товарів</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Array.from(brandBreakdown.entries())
                    .sort((a, b) => b[1].commission - a[1].commission)
                    .map(([brand, bd]) => (
                      <div key={brand} className="p-3 rounded-lg" style={{ background: "#FAFAFA" }}>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "#0A0A0A" }}>{resolveGroupName(brand)}</p>
                        <p style={{ fontSize: "12px", color: "#6B7280" }}>Продажі: {formatPrice(bd.sales)}</p>
                        <p style={{ fontSize: "14px", fontWeight: 700, color: "#F59E0B", marginTop: "4px" }}>{formatPrice(bd.commission)}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Records table */}
            {records.length === 0 ? (
              <div className="text-center py-12"><p style={{ color: "#9E9E9E" }}>Комісій за цей період немає</p></div>
            ) : (
              <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Документ</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Покупець</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Група</th>
                        <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Продаж</th>
                        <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Комісія</th>
                        <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r: any) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 500 }}>{r.salesDocument?.number}</td>
                          <td style={{ padding: "14px 16px", fontSize: "14px", color: "#6B7280" }}>{r.salesDocument?.counterparty?.name || "—"}</td>
                          <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 500 }}>{resolveGroupName(r.brand)}</td>
                          <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px" }}>{formatPrice(r.saleAmount)}</td>
                          <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", fontWeight: 700, color: "#F59E0B" }}>{formatPrice(r.commissionAmount)}</td>
                          <td style={{ padding: "14px 16px", textAlign: "center" }}>
                            <span className={`px-2 py-1 rounded-md text-xs font-medium ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Leaderboard tab */
          <>
            {/* Period selector */}
            <div className="flex gap-2 mb-6">
              {Object.entries(PERIOD_LABELS).map(([key, label]) => (
                <button key={key} onClick={() => setPeriod(key)}
                  style={{
                    padding: "6px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                    background: period === key ? "#0A0A0A" : "white",
                    color: period === key ? "white" : "#6B7280",
                    border: period === key ? "none" : "1px solid #E5E7EB",
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {lbData.length === 0 ? (
              <div className="text-center py-12" style={{ color: "#9CA3AF" }}>Немає даних за цей період</div>
            ) : (
              <div className="space-y-3">
                {lbData.map((rep: any, i: number) => {
                  const isMe = rep.id === userId;
                  const maxTurnover = lbData[0]?.turnover || 1;
                  const barW = maxTurnover > 0 ? (rep.turnover / maxTurnover) * 100 : 0;
                  return (
                    <div
                      key={rep.id}
                      className="bg-white rounded-xl p-4 flex items-center gap-4"
                      style={{
                        border: isMe ? "2px solid #FFD600" : "1px solid #EFEFEF",
                        background: isMe ? "linear-gradient(135deg, #FFFBEB, white)" : "white",
                      }}
                    >
                      {/* Rank */}
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                        style={{ background: i < 3 ? MEDAL_COLORS[i] : "#F3F4F6", color: i === 0 ? "#0A0A0A" : i < 3 ? "white" : "#6B7280" }}>
                        {i < 3 ? (i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉") : i + 1}
                      </div>
                      {/* Name + details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p style={{ fontSize: "15px", fontWeight: 700 }}>{rep.name}{isMe ? " (ви)" : ""}</p>
                        </div>
                        <div className="flex gap-3 mt-1">
                          <span style={{ fontSize: "12px", color: "#6B7280" }}>{rep.docs} док.</span>
                          <span style={{ fontSize: "12px", color: "#6B7280" }}>{rep.quantity} шт.</span>
                          <span style={{ fontSize: "12px", color: "#6B7280" }}>{rep.clients} кл.</span>
                        </div>
                        {/* Progress bar */}
                        <div style={{ height: "6px", background: "#F3F4F6", borderRadius: "3px", marginTop: "6px" }}>
                          <div style={{
                            height: "100%",
                            width: `${barW}%`,
                            background: i < 3 ? MEDAL_COLORS[i] : isMe ? "#FFD600" : "#6366F1",
                            borderRadius: "3px",
                            transition: "width 0.5s ease",
                          }} />
                        </div>
                      </div>
                      {/* Turnover */}
                      <div className="text-right flex-shrink-0">
                        <p style={{ fontSize: "16px", fontWeight: 800, color: "#0A0A0A" }}>{formatPrice(rep.turnover)}</p>
                        <p style={{ fontSize: "12px", color: "#F59E0B", fontWeight: 600 }}>{formatPrice(rep.commission)} комісія</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
