"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CATEGORY_GROUPS } from "@/lib/categoryGroups";

export default function CommissionRatesPage() {
  const { data: session } = useSession();
  const [rates, setRates] = useState<any[]>([]);
  const [salesReps, setSalesReps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedRep, setSelectedRep] = useState<string | null>(null);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (role !== "ADMIN" && role !== "MANAGER") return;
    Promise.all([
      fetch("/api/erp/commissions/rates").then((r) => r.json()),
      fetch("/api/admin/users").then((r) => r.json()),
    ]).then(([ratesData, users]) => {
      setRates(Array.isArray(ratesData) ? ratesData : []);
      const reps = (Array.isArray(users) ? users : []).filter((u: any) => u.role === "SALES");
      setSalesReps(reps);
      if (reps.length > 0) setSelectedRep(reps[0].id);
      setLoading(false);
    });
  }, [role]);

  const getRate = (salesRepId: string, groupKey: string) => {
    return rates.find((r) => r.salesRepId === salesRepId && r.brand === groupKey)?.percentage ?? "";
  };

  const updateRate = async (salesRepId: string, groupKey: string, value: string) => {
    const percentage = parseFloat(value);
    if (isNaN(percentage) || percentage < 0) return;

    setSaving(`${salesRepId}-${groupKey}`);
    const res = await fetch("/api/erp/commissions/rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salesRepId, brand: groupKey, percentage }),
    });

    if (res.ok) {
      const updated = await res.json();
      setRates((prev) => {
        const idx = prev.findIndex((r) => r.salesRepId === salesRepId && r.brand === groupKey);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], percentage: updated.percentage };
          return next;
        }
        return [...prev, updated];
      });
    }
    setSaving(null);
  };

  const applyToAll = async (groupKey: string, value: string) => {
    const percentage = parseFloat(value);
    if (isNaN(percentage) || percentage < 0) return;
    for (const rep of salesReps) {
      await updateRate(rep.id, groupKey, value);
    }
  };

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const currentRep = salesReps.find((r) => r.id === selectedRep);

  // Count configured rates for each rep
  const repRateCounts = new Map<string, number>();
  for (const rep of salesReps) {
    const count = rates.filter((r) => r.salesRepId === rep.id && r.percentage > 0).length;
    repRateCounts.set(rep.id, count);
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link href="/admin/erp/commissions" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
            <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Ставки комісій</h1>
            <p style={{ fontSize: "14px", color: "#6B7280" }}>Відсоток від прибутку по групах товарів</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : salesReps.length === 0 ? (
          <div className="text-center py-12">
            <p style={{ color: "#9E9E9E" }}>Немає торгових менеджерів. Призначте роль SALES користувачам.</p>
          </div>
        ) : (
          <div className="flex gap-6">
            {/* Left: Sales rep selector */}
            <div className="w-56 flex-shrink-0">
              <p style={{ fontSize: "13px", fontWeight: 600, color: "#6B7280", marginBottom: "8px" }}>Торговий менеджер</p>
              <div className="space-y-2">
                {salesReps.map((rep) => (
                  <button
                    key={rep.id}
                    onClick={() => setSelectedRep(rep.id)}
                    className="w-full text-left rounded-xl p-3 cursor-pointer active:scale-[0.98] transition-[box-shadow,border-color,background-color] duration-150"
                    style={{
                      background: selectedRep === rep.id ? "white" : "transparent",
                      border: selectedRep === rep.id ? "2px solid #FFD600" : "1px solid #E5E7EB",
                      boxShadow: selectedRep === rep.id ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                    }}
                  >
                    <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{rep.name}</p>
                    <p style={{ fontSize: "12px", color: "#9CA3AF" }}>
                      {repRateCounts.get(rep.id) || 0} / {CATEGORY_GROUPS.length} груп
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Category groups grid */}
            {selectedRep && currentRep && (
              <div className="flex-1">
                <div className="flex items-center justify-between mb-4">
                  <h2 style={{ fontSize: "18px", fontWeight: 700 }}>
                    {currentRep.name}
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {CATEGORY_GROUPS.map((group) => {
                    const key = `${selectedRep}-${group.key}`;
                    const currentValue = getRate(selectedRep, group.key);
                    return (
                      <div
                        key={group.key}
                        className="bg-white rounded-xl p-4 flex items-center gap-3"
                        style={{
                          border: saving === key ? "2px solid #FFD600" : currentValue ? "1px solid #FFD60060" : "1px solid #EFEFEF",
                          background: currentValue ? "#FFFEF5" : "white",
                        }}
                      >
                        <span style={{ fontSize: "24px" }}>{group.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p style={{ fontSize: "13px", fontWeight: 600, color: "#0A0A0A", lineHeight: "1.2" }} className="truncate">
                            {group.name}
                          </p>
                          <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{group.slugs.length} категорій</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            value={currentValue}
                            placeholder="—"
                            onChange={(e) => {
                              setRates((prev) => {
                                const idx = prev.findIndex((r) => r.salesRepId === selectedRep && r.brand === group.key);
                                const val = parseFloat(e.target.value) || 0;
                                if (idx >= 0) {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], percentage: val };
                                  return next;
                                }
                                return [...prev, { salesRepId: selectedRep, brand: group.key, percentage: val }];
                              });
                            }}
                            onBlur={(e) => updateRate(selectedRep, group.key, e.target.value)}
                            style={{
                              width: "60px",
                              padding: "6px 4px",
                              borderRadius: "6px",
                              border: "1px solid #E5E7EB",
                              fontSize: "14px",
                              fontWeight: 700,
                              textAlign: "center",
                            }}
                          />
                          <span style={{ fontSize: "14px", color: "#6B7280", fontWeight: 600 }}>%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <p style={{ fontSize: "13px", color: "#9CA3AF", marginTop: "16px" }}>
          Значення — відсоток від прибутку (ціна продажу - вхідна ціна). Зміни зберігаються автоматично.
        </p>
      </div>
    </div>
  );
}
