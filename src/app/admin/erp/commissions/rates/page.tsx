"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BRANDS } from "@/lib/brands";

const BRAND_NAMES = BRANDS.map((b) => b.name);

export default function CommissionRatesPage() {
  const { data: session } = useSession();
  const [rates, setRates] = useState<any[]>([]);
  const [salesReps, setSalesReps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (role !== "ADMIN" && role !== "MANAGER") return;
    Promise.all([
      fetch("/api/erp/commissions/rates").then((r) => r.json()),
      fetch("/api/admin/users").then((r) => r.json()),
    ]).then(([ratesData, users]) => {
      setRates(Array.isArray(ratesData) ? ratesData : []);
      setSalesReps((Array.isArray(users) ? users : []).filter((u: any) => u.role === "SALES"));
      setLoading(false);
    });
  }, [role]);

  const getRate = (salesRepId: string, brand: string) => {
    return rates.find((r) => r.salesRepId === salesRepId && r.brand === brand)?.percentage ?? "";
  };

  const updateRate = async (salesRepId: string, brand: string, value: string) => {
    const percentage = parseFloat(value);
    if (isNaN(percentage) || percentage < 0) return;

    setSaving(`${salesRepId}-${brand}`);
    const res = await fetch("/api/erp/commissions/rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salesRepId, brand, percentage }),
    });

    if (res.ok) {
      const updated = await res.json();
      setRates((prev) => {
        const idx = prev.findIndex((r) => r.salesRepId === salesRepId && r.brand === brand);
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

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
            <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Ставки комісій</h1>
            <p style={{ fontSize: "14px", color: "#6B7280" }}>Відсоток від прибутку для кожного торгового по брендах</p>
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
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280", position: "sticky", left: 0, background: "#FAFAFA", minWidth: "160px" }}>
                      Торговий
                    </th>
                    {BRAND_NAMES.map((brand) => (
                      <th key={brand} style={{ padding: "12px 8px", textAlign: "center", fontSize: "12px", fontWeight: 600, color: "#6B7280", minWidth: "70px" }}>
                        {brand}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {salesReps.map((rep) => (
                    <tr key={rep.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "12px 16px", fontSize: "14px", fontWeight: 600, color: "#0A0A0A", position: "sticky", left: 0, background: "white" }}>
                        {rep.name}
                      </td>
                      {BRAND_NAMES.map((brand) => {
                        const key = `${rep.id}-${brand}`;
                        const currentValue = getRate(rep.id, brand);
                        return (
                          <td key={brand} style={{ padding: "8px 4px", textAlign: "center" }}>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={currentValue}
                              placeholder="—"
                              onChange={(e) => {
                                // Optimistic update
                                setRates((prev) => {
                                  const idx = prev.findIndex((r) => r.salesRepId === rep.id && r.brand === brand);
                                  const val = parseFloat(e.target.value) || 0;
                                  if (idx >= 0) {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], percentage: val };
                                    return next;
                                  }
                                  return [...prev, { salesRepId: rep.id, brand, percentage: val }];
                                });
                              }}
                              onBlur={(e) => updateRate(rep.id, brand, e.target.value)}
                              style={{
                                width: "60px",
                                padding: "6px 4px",
                                borderRadius: "6px",
                                border: saving === key ? "2px solid #FFD600" : "1px solid #E5E7EB",
                                fontSize: "13px",
                                textAlign: "center",
                                background: currentValue ? "#FEFCE8" : "white",
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p style={{ fontSize: "13px", color: "#9CA3AF", marginTop: "16px" }}>
          Значення — відсоток від прибутку (ціна продажу - вхідна ціна). Зміни зберігаються автоматично при втраті фокусу.
        </p>
      </div>
    </div>
  );
}
