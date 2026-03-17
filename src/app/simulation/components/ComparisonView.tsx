"use client";

import type { SimulationResult } from "@/lib/simulation/engine";
import { compareSimulations } from "@/lib/simulation/engine";

interface Props {
  results: SimulationResult[];
}

const WEAR_LABELS = { low: "Низький", medium: "Середній", high: "Високий" };
const HEAT_LABELS = { low: "Низький", medium: "Середній", high: "Високий", critical: "Критичний" };
const WEAR_COLORS = { low: "#22C55E", medium: "#F59E0B", high: "#EF4444" };
const HEAT_COLORS = { low: "#22C55E", medium: "#F59E0B", high: "#EF4444", critical: "#DC2626" };

function formatTime(sec: number): string {
  if (sec < 60) return `${sec} сек`;
  const min = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${min} хв ${s} сек` : `${min} хв`;
}

export default function ComparisonView({ results }: Props) {
  const comparison = compareSimulations(results);
  const { winners } = comparison;

  const rows: { label: string; getValue: (r: SimulationResult, i: number) => { text: string; isWinner: boolean; color?: string } }[] = [
    {
      label: "Ефективність",
      getValue: (r, i) => ({
        text: `${r.efficiencyScore}/100`,
        isWinner: i === winners.mostEfficient,
        color: r.efficiencyScore >= 70 ? "#22C55E" : r.efficiencyScore >= 40 ? "#F59E0B" : "#EF4444",
      }),
    },
    {
      label: "Час",
      getValue: (r, i) => ({
        text: formatTime(r.estimatedTimeSec),
        isWinner: i === winners.fastest,
      }),
    },
    {
      label: "Знос",
      getValue: (r, i) => ({
        text: WEAR_LABELS[r.wearRate],
        isWinner: i === winners.leastWear,
        color: WEAR_COLORS[r.wearRate],
      }),
    },
    {
      label: "Нагрів",
      getValue: (r) => ({
        text: HEAT_LABELS[r.heatLevel],
        isWinner: false,
        color: HEAT_COLORS[r.heatLevel],
      }),
    },
    {
      label: "Безпека",
      getValue: (r, i) => ({
        text: `${r.metrics.safety}/100`,
        isWinner: i === winners.safest,
      }),
    },
    {
      label: "Швидкість",
      getValue: (r) => ({ text: `${r.metrics.speed}/100`, isWinner: false }),
    },
    {
      label: "Точність",
      getValue: (r) => ({ text: `${r.metrics.precision}/100`, isWinner: false }),
    },
  ];

  return (
    <div className="overflow-x-auto -mx-3 px-3">
      <table className="w-full min-w-[500px]">
        <thead>
          <tr>
            <th className="text-left text-xs font-medium text-[#9E9E9E] pb-3 w-28"></th>
            {results.map((r, i) => (
              <th key={i} className="text-center pb-3 px-2">
                <div className="bg-white border border-[#EFEFEF] rounded-xl p-3">
                  <h4 className="text-xs font-bold text-[#0A0A0A] line-clamp-2">{r.consumableName || r.toolName || `Інструмент ${i + 1}`}</h4>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[#EFEFEF]">
              <td className="py-3 text-xs font-medium text-[#9E9E9E]">{row.label}</td>
              {results.map((r, i) => {
                const val = row.getValue(r, i);
                return (
                  <td key={i} className="py-3 text-center px-2">
                    <span
                      className={`text-sm font-semibold ${val.isWinner ? "bg-[#FFFDE7] px-2 py-0.5 rounded-md border border-[#FFD600]" : ""}`}
                      style={{ color: val.color || "#0A0A0A" }}
                    >
                      {val.text}
                      {val.isWinner && " ★"}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
          {/* Warnings row */}
          <tr className="border-t border-[#EFEFEF]">
            <td className="py-3 text-xs font-medium text-[#9E9E9E]">Попередження</td>
            {results.map((r, i) => (
              <td key={i} className="py-3 text-center px-2">
                <span className={`text-xs ${r.warnings.length > 0 ? "text-[#F59E0B]" : "text-[#22C55E]"}`}>
                  {r.warnings.length > 0 ? `${r.warnings.length} ⚠️` : "Немає ✓"}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
