"use client";

import type { SimulationResult } from "@/lib/simulation/engine";

interface Props {
  result: SimulationResult;
}

const TYPE_LABELS = { cutting: "Різання", grinding: "Шліфування", drilling: "Свердління" };
const WEAR_LABELS = { low: "Низький", medium: "Середній", high: "Високий" };
const HEAT_LABELS = { low: "Низький", medium: "Середній", high: "Високий", critical: "Критичний" };
const HEAT_COLORS = { low: "#22C55E", medium: "#F59E0B", high: "#EF4444", critical: "#DC2626" };
const WEAR_COLORS = { low: "#22C55E", medium: "#F59E0B", high: "#EF4444" };

const METRIC_LABELS: Record<string, string> = {
  speed: "Швидкість",
  precision: "Точність",
  durability: "Довговічність",
  safety: "Безпека",
  efficiency: "Ефективність",
};

function formatTime(sec: number): string {
  if (sec < 60) return `${sec} сек`;
  const min = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${min} хв ${s} сек` : `${min} хв`;
}

export default function ResultCard({ result }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-[#EFEFEF] p-6" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-[#0A0A0A]">{result.toolName || "Результат"}</h3>
          <p className="text-sm text-[#9E9E9E]">{TYPE_LABELS[result.type]}</p>
        </div>
        {/* Efficiency circle */}
        <div className="relative w-20 h-20">
          <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="#EFEFEF" strokeWidth="6" />
            <circle
              cx="40" cy="40" r="34" fill="none"
              stroke={result.efficiencyScore >= 70 ? "#22C55E" : result.efficiencyScore >= 40 ? "#F59E0B" : "#EF4444"}
              strokeWidth="6"
              strokeDasharray={`${(result.efficiencyScore / 100) * 213.6} 213.6`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-[#0A0A0A]">{result.efficiencyScore}</span>
            <span className="text-[9px] text-[#9E9E9E]">бали</span>
          </div>
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[#FAFAFA] rounded-xl p-3 text-center">
          <p className="text-[10px] text-[#9E9E9E] mb-1">Час</p>
          <p className="text-sm font-bold text-[#0A0A0A]">{formatTime(result.estimatedTimeSec)}</p>
        </div>
        <div className="bg-[#FAFAFA] rounded-xl p-3 text-center">
          <p className="text-[10px] text-[#9E9E9E] mb-1">Знос</p>
          <p className="text-sm font-bold" style={{ color: WEAR_COLORS[result.wearRate] }}>
            {WEAR_LABELS[result.wearRate]}
          </p>
        </div>
        <div className="bg-[#FAFAFA] rounded-xl p-3 text-center">
          <p className="text-[10px] text-[#9E9E9E] mb-1">Нагрів</p>
          <p className="text-sm font-bold" style={{ color: HEAT_COLORS[result.heatLevel] }}>
            {HEAT_LABELS[result.heatLevel]}
          </p>
        </div>
      </div>

      {/* Metrics bars */}
      <div className="space-y-3 mb-6">
        {(Object.keys(result.metrics) as (keyof typeof result.metrics)[]).map((key) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[#555]">{METRIC_LABELS[key]}</span>
              <span className="text-xs font-bold text-[#0A0A0A]">{result.metrics[key]}</span>
            </div>
            <div className="h-2 bg-[#EFEFEF] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${result.metrics[key]}%`,
                  backgroundColor: result.metrics[key] >= 70 ? "#22C55E" : result.metrics[key] >= 40 ? "#F59E0B" : "#EF4444",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="space-y-2">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 bg-[#FFF8E1] rounded-lg px-3 py-2">
              <svg className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-xs text-[#555]">{w}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
