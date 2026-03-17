"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { getCategoryGroup } from "@/lib/categoryGroups";

const STATUS_LABELS: Record<string, string> = { PENDING: "Очікує", APPROVED: "Затверджено", PAID: "Виплачено" };
const STATUS_COLORS: Record<string, string> = { PENDING: "bg-primary/10 text-primary-dark", APPROVED: "bg-blue-50 text-blue-700", PAID: "bg-green-50 text-green-700" };

const MEDAL_COLORS = ["#FFD600", "#C0C0C0", "#CD7F32"];

const resolveGroupName = (key: string) => getCategoryGroup(key)?.name || key;
const PERIOD_LABELS: Record<string, string> = { month: "Місяць", quarter: "Квартал", year: "Рік", all: "Весь час" };

type Tab = "leaderboard" | "commissions";

export default function MotivationPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>("leaderboard");
  const [period, setPeriod] = useState("month");
  const [leaderboard, setLeaderboard] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderboardCategory, setLeaderboardCategory] = useState<"turnover" | "quantity" | "docs" | "clients">("turnover");

  const role = (session?.user as any)?.role;

  const fetchLeaderboard = async () => {
    const res = await fetch(`/api/erp/leaderboard?period=${period}`);
    const data = await res.json();
    setLeaderboard(data);
  };

  const fetchCommissions = async () => {
    const salesRes = await fetch("/api/erp/sales?status=CONFIRMED");
    const salesDocs = await salesRes.json();
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
  };

  useEffect(() => {
    if (role !== "ADMIN" && role !== "MANAGER") return;
    setLoading(true);
    Promise.all([fetchLeaderboard(), fetchCommissions()]).then(() => setLoading(false));
  }, [role]);

  useEffect(() => {
    if (role !== "ADMIN" && role !== "MANAGER") return;
    fetchLeaderboard();
  }, [period]);

  const handleAction = async (id: string, action: "approve" | "pay") => {
    await fetch(`/api/erp/commissions/${id}/${action}`, { method: "POST" });
    setLoading(true);
    await fetchCommissions();
    setLoading(false);
  };

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const totalPending = records.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.commissionAmount, 0);
  const totalApproved = records.filter((r) => r.status === "APPROVED").reduce((s, r) => s + r.commissionAmount, 0);
  const totalPaid = records.filter((r) => r.status === "PAID").reduce((s, r) => s + r.commissionAmount, 0);

  const categoryLabels: Record<string, string> = {
    turnover: "Оборот",
    quantity: "Кількість",
    docs: "Документи",
    clients: "Клієнти",
  };

  const categoryIcons: Record<string, string> = {
    turnover: "💰",
    quantity: "📦",
    docs: "📄",
    clients: "👥",
  };

  const getLeaderboardData = () => {
    if (!leaderboard?.leaderboard) return [];
    const map: Record<string, any[]> = {
      turnover: leaderboard.leaderboard.byTurnover,
      quantity: leaderboard.leaderboard.byQuantity,
      docs: leaderboard.leaderboard.byDocs,
      clients: leaderboard.leaderboard.byClients,
    };
    return map[leaderboardCategory] || [];
  };

  const getValueForCategory = (rep: any) => {
    if (leaderboardCategory === "turnover") return formatPrice(rep.turnover);
    if (leaderboardCategory === "quantity") return `${rep.quantity} шт.`;
    if (leaderboardCategory === "docs") return `${rep.docs} док.`;
    if (leaderboardCategory === "clients") return `${rep.clients} кл.`;
    return "";
  };

  const getMaxForCategory = (data: any[]) => {
    if (data.length === 0) return 1;
    if (leaderboardCategory === "turnover") return data[0]?.turnover || 1;
    if (leaderboardCategory === "quantity") return data[0]?.quantity || 1;
    if (leaderboardCategory === "docs") return data[0]?.docs || 1;
    if (leaderboardCategory === "clients") return data[0]?.clients || 1;
    return 1;
  };

  const getBarValue = (rep: any) => {
    if (leaderboardCategory === "turnover") return rep.turnover;
    if (leaderboardCategory === "quantity") return rep.quantity;
    if (leaderboardCategory === "docs") return rep.docs;
    if (leaderboardCategory === "clients") return rep.clients;
    return 0;
  };

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
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Лідерборд та комісії торгових</p>
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
        {/* Tabs */}
        <div className="flex gap-1 mb-6" style={{ background: "#F3F4F6", borderRadius: "10px", padding: "3px", width: "fit-content" }}>
          <button onClick={() => setTab("leaderboard")}
            style={{ padding: "8px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, background: tab === "leaderboard" ? "white" : "transparent", boxShadow: tab === "leaderboard" ? "0 1px 3px rgba(0,0,0,0.1)" : "none", color: tab === "leaderboard" ? "#0A0A0A" : "#6B7280" }}>
            🏆 Лідерборд
          </button>
          <button onClick={() => setTab("commissions")}
            style={{ padding: "8px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, background: tab === "commissions" ? "white" : "transparent", boxShadow: tab === "commissions" ? "0 1px 3px rgba(0,0,0,0.1)" : "none", color: tab === "commissions" ? "#0A0A0A" : "#6B7280" }}>
            💵 Комісії
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : tab === "leaderboard" ? (
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

            {/* Category selector */}
            <div className="flex gap-2 mb-6 flex-wrap">
              {(["turnover", "quantity", "docs", "clients"] as const).map((cat) => (
                <button key={cat} onClick={() => setLeaderboardCategory(cat)}
                  style={{
                    padding: "8px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: 600,
                    background: leaderboardCategory === cat ? "#FFD600" : "white",
                    border: leaderboardCategory === cat ? "2px solid #EAB308" : "1px solid #E5E7EB",
                  }}>
                  {categoryIcons[cat]} {categoryLabels[cat]}
                </button>
              ))}
            </div>

            {/* Podium for top 3 */}
            {(() => {
              const data = getLeaderboardData();
              if (data.length === 0) return <div className="text-center py-12" style={{ color: "#9CA3AF" }}>Немає даних за цей період</div>;

              const top3 = data.slice(0, 3);
              // Display order: 2nd, 1st, 3rd
              const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;
              const podiumHeights = [140, 180, 110];
              const podiumIndexes = top3.length >= 3 ? [1, 0, 2] : top3.map((_, i) => i);

              return (
                <>
                  {/* Podium */}
                  <div className="bg-white rounded-2xl p-6 mb-6" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
                    <div className="flex items-end justify-center gap-4" style={{ minHeight: "240px" }}>
                      {podiumOrder.map((rep, idx) => {
                        const realIndex = podiumIndexes[idx];
                        const height = podiumHeights[idx] || 100;
                        return (
                          <div key={rep.id} className="flex flex-col items-center" style={{ width: "120px" }}>
                            {/* Avatar / Medal */}
                            <div
                              className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold mb-2"
                              style={{ background: MEDAL_COLORS[realIndex] || "#E5E7EB", color: realIndex === 0 ? "#0A0A0A" : "white" }}
                            >
                              {rep.name?.charAt(0) || "?"}
                            </div>
                            <p style={{ fontSize: "14px", fontWeight: 700, textAlign: "center", lineHeight: "1.2" }}>{rep.name}</p>
                            <p style={{ fontSize: "15px", fontWeight: 800, color: "#FFB800", marginTop: "4px" }}>
                              {getValueForCategory(rep)}
                            </p>
                            {/* Podium bar */}
                            <div
                              style={{
                                width: "100%",
                                height: `${height}px`,
                                background: `linear-gradient(to top, ${MEDAL_COLORS[realIndex]}40, ${MEDAL_COLORS[realIndex]}15)`,
                                borderRadius: "12px 12px 0 0",
                                marginTop: "8px",
                                display: "flex",
                                alignItems: "flex-start",
                                justifyContent: "center",
                                paddingTop: "12px",
                                border: `2px solid ${MEDAL_COLORS[realIndex]}60`,
                                borderBottom: "none",
                              }}
                            >
                              <span style={{ fontSize: "28px", fontWeight: 900, color: MEDAL_COLORS[realIndex] }}>{realIndex + 1}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Full ranking table */}
                  <div className="bg-white rounded-xl overflow-hidden mb-6" style={{ border: "1px solid #EFEFEF" }}>
                    <div className="p-4" style={{ borderBottom: "1px solid #EFEFEF" }}>
                      <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Повний рейтинг — {categoryLabels[leaderboardCategory]}</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                            <th style={{ padding: "10px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280", width: "50px" }}>#</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Торговий</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Оборот</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Кількість</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Документи</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Клієнти</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Комісія</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280", width: "200px" }}>Прогрес</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.map((rep: any, i: number) => {
                            const max = getMaxForCategory(data);
                            const barW = max > 0 ? (getBarValue(rep) / max) * 100 : 0;
                            return (
                              <tr key={rep.id} style={{ borderBottom: "1px solid #F3F4F6", background: i < 3 ? `${MEDAL_COLORS[i]}08` : "transparent" }}>
                                <td style={{ padding: "12px 16px", textAlign: "center", fontSize: "16px", fontWeight: 800 }}>
                                  {i < 3 ? (
                                    <span style={{ color: MEDAL_COLORS[i] }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}</span>
                                  ) : (
                                    <span style={{ color: "#9CA3AF" }}>{i + 1}</span>
                                  )}
                                </td>
                                <td style={{ padding: "12px 16px", fontSize: "14px", fontWeight: 600 }}>{rep.name}</td>
                                <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: leaderboardCategory === "turnover" ? 700 : 400, color: leaderboardCategory === "turnover" ? "#0A0A0A" : "#6B7280" }}>
                                  {formatPrice(rep.turnover)}
                                </td>
                                <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: leaderboardCategory === "quantity" ? 700 : 400, color: leaderboardCategory === "quantity" ? "#0A0A0A" : "#6B7280" }}>
                                  {rep.quantity} шт.
                                </td>
                                <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: leaderboardCategory === "docs" ? 700 : 400, color: leaderboardCategory === "docs" ? "#0A0A0A" : "#6B7280" }}>
                                  {rep.docs}
                                </td>
                                <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: leaderboardCategory === "clients" ? 700 : 400, color: leaderboardCategory === "clients" ? "#0A0A0A" : "#6B7280" }}>
                                  {rep.clients}
                                </td>
                                <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: 600, color: "#F59E0B" }}>
                                  {formatPrice(rep.commission)}
                                </td>
                                <td style={{ padding: "12px 16px" }}>
                                  <div style={{ height: "8px", background: "#F3F4F6", borderRadius: "4px", overflow: "hidden" }}>
                                    <div style={{
                                      height: "100%",
                                      width: `${barW}%`,
                                      background: i < 3 ? `linear-gradient(to right, ${MEDAL_COLORS[i]}, ${MEDAL_COLORS[i]}80)` : "#6366F1",
                                      borderRadius: "4px",
                                      transition: "width 0.5s ease",
                                    }} />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              );
            })()}
          </>
        ) : (
          /* Commissions tab */
          <>
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

            {records.length === 0 ? (
              <div className="text-center py-12"><p style={{ color: "#9E9E9E" }}>Комісій поки немає</p></div>
            ) : (
              <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Документ</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Торговий</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Група</th>
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
                          <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 500 }}>{resolveGroupName(r.brand)}</td>
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
          </>
        )}
      </div>
    </div>
  );
}
