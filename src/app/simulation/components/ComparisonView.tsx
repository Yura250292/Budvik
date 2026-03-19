"use client";

import type { SimulationResult } from "@/lib/simulation/engine";
import { compareSimulations } from "@/lib/simulation/engine";

interface Props {
  results: SimulationResult[];
}

function formatTime(sec: number): string {
  if (sec < 60) return `${sec} сек`;
  const min = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${min} хв ${s} сек` : `${min} хв`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#22C55E";
  if (score >= 60) return "#84CC16";
  if (score >= 40) return "#F59E0B";
  return "#EF4444";
}

function efficiencyLabel(score: number): string {
  if (score >= 88) return "Ідеально підходить";
  if (score >= 72) return "Добре підходить";
  if (score >= 52) return "Підходить";
  if (score >= 35) return "Слабко підходить";
  return "Не підходить";
}

function safetyLabel(score: number): string {
  if (score >= 80) return "Безпечно";
  if (score >= 62) return "Потрібна обережність";
  if (score >= 42) return "Підвищений ризик";
  return "Небезпечно";
}

function speedLabel(score: number): string {
  if (score >= 78) return "Дуже швидко";
  if (score >= 55) return "Швидко";
  if (score >= 35) return "Помірно";
  return "Повільно";
}

function precisionLabel(score: number): string {
  if (score >= 80) return "Чистий рез / отвір";
  if (score >= 63) return "Хороша якість";
  if (score >= 43) return "Задовільна якість";
  return "Груба обробка";
}

const WEAR_INFO: Record<string, { label: string; sub: string; color: string }> = {
  low:    { label: "Мінімальний",   sub: "Диск / свердло служить довго",      color: "#22C55E" },
  medium: { label: "Середній",      sub: "Звичайне спрацювання",              color: "#F59E0B" },
  high:   { label: "Швидкий",       sub: "Часта заміна ріжучого елементу",    color: "#EF4444" },
};

const HEAT_INFO: Record<string, { label: string; sub: string; color: string }> = {
  low:      { label: "Слабкий",    sub: "Можна працювати без пауз",           color: "#22C55E" },
  medium:   { label: "Помірний",   sub: "Пауза кожні 10–15 хв",              color: "#F59E0B" },
  high:     { label: "Сильний",    sub: "Пауза кожні 3–5 хв, ризик опіку",   color: "#EF4444" },
  critical: { label: "Критичний",  sub: "Ризик перегріву та поломки",         color: "#DC2626" },
};

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 bg-[#F0F0F0] rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-bold w-7 text-right" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

function WinnerBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-yellow-700 bg-yellow-50 border border-yellow-300 rounded-full px-1.5 py-0.5">
      ★ {label}
    </span>
  );
}

export default function ComparisonView({ results }: Props) {
  const comparison = compareSimulations(results);
  const { winners } = comparison;

  const names = results.map(r => r.consumableName || r.toolName || "Інструмент");

  const fastestTime = results[winners.fastest].estimatedTimeSec;
  const timeDiffs = results.map(r =>
    r.estimatedTimeSec > fastestTime
      ? `+${Math.round((r.estimatedTimeSec - fastestTime) / fastestTime * 100)}%`
      : null
  );

  return (
    <div className="space-y-2">

      {/* ── Verdict strip ── */}
      {results.length > 1 && (
        <div className="grid grid-cols-2 gap-2 mb-1">
          <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl p-3">
            <div className="text-[11px] text-[#15803D] font-semibold mb-0.5">⚡ Швидший результат</div>
            <div className="text-xs font-bold text-[#166534] line-clamp-2">{names[winners.fastest]}</div>
            <div className="text-[11px] text-[#15803D] mt-0.5">{formatTime(fastestTime)}</div>
          </div>
          <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-3">
            <div className="text-[11px] text-[#B45309] font-semibold mb-0.5">🎯 Краща ефективність</div>
            <div className="text-xs font-bold text-[#92400E] line-clamp-2">{names[winners.mostEfficient]}</div>
            <div className="text-[11px] text-[#B45309] mt-0.5">{results[winners.mostEfficient].efficiencyScore}% відповідність</div>
          </div>
        </div>
      )}

      {/* ── Column headers ── */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `140px repeat(${results.length}, 1fr)` }}>
        <div />
        {results.map((r, i) => (
          <div key={i} className="bg-white border border-[#EFEFEF] rounded-xl p-2.5 text-center">
            <div className="text-[11px] font-bold text-[#0A0A0A] line-clamp-3 leading-tight">
              {names[i]}
            </div>
          </div>
        ))}
      </div>

      {/* ── Time ── */}
      <MetricRow
        icon="⏱"
        title="Час виконання"
        desc="Скільки займе ця операція"
      >
        {results.map((r, i) => (
          <Cell key={i} isWinner={i === winners.fastest}>
            <div className="text-sm font-bold text-[#0A0A0A]">{formatTime(r.estimatedTimeSec)}</div>
            {timeDiffs[i] && (
              <div className="text-[11px] text-[#EF4444] font-medium">повільніше на {timeDiffs[i]}</div>
            )}
            {i === winners.fastest && <WinnerBadge label="Швидший" />}
          </Cell>
        ))}
      </MetricRow>

      {/* ── Efficiency ── */}
      <MetricRow
        icon="⚡"
        title="Відповідність завданню"
        desc="Чи правильно підібрана потужність для цього матеріалу"
      >
        {results.map((r, i) => {
          const c = scoreColor(r.efficiencyScore);
          return (
            <Cell key={i} isWinner={i === winners.mostEfficient}>
              <ScoreBar score={r.efficiencyScore} color={c} />
              <div className="text-xs font-semibold mt-1" style={{ color: c }}>
                {efficiencyLabel(r.efficiencyScore)}
              </div>
              {i === winners.mostEfficient && <WinnerBadge label="Кращий" />}
            </Cell>
          );
        })}
      </MetricRow>

      {/* ── Speed ── */}
      <MetricRow
        icon="🚀"
        title="Швидкість обробки"
        desc="Скільки матеріалу знімає за секунду"
      >
        {results.map((r, i) => {
          const c = scoreColor(r.metrics.speed);
          return (
            <Cell key={i} isWinner={false}>
              <ScoreBar score={r.metrics.speed} color={c} />
              <div className="text-xs font-semibold mt-1" style={{ color: c }}>
                {speedLabel(r.metrics.speed)}
              </div>
            </Cell>
          );
        })}
      </MetricRow>

      {/* ── Precision ── */}
      <MetricRow
        icon="🎯"
        title="Якість обробки"
        desc="Наскільки рівний і чистий рез або отвір"
      >
        {results.map((r, i) => {
          const c = scoreColor(r.metrics.precision);
          return (
            <Cell key={i} isWinner={false}>
              <ScoreBar score={r.metrics.precision} color={c} />
              <div className="text-xs font-semibold mt-1" style={{ color: c }}>
                {precisionLabel(r.metrics.precision)}
              </div>
            </Cell>
          );
        })}
      </MetricRow>

      {/* ── Safety ── */}
      <MetricRow
        icon="🛡"
        title="Безпека роботи"
        desc="Ризик опіку, вібрації та пошкодження від перегріву"
      >
        {results.map((r, i) => {
          const c = scoreColor(r.metrics.safety);
          return (
            <Cell key={i} isWinner={i === winners.safest}>
              <ScoreBar score={r.metrics.safety} color={c} />
              <div className="text-xs font-semibold mt-1" style={{ color: c }}>
                {safetyLabel(r.metrics.safety)}
              </div>
              {i === winners.safest && <WinnerBadge label="Безпечніший" />}
            </Cell>
          );
        })}
      </MetricRow>

      {/* ── Wear ── */}
      <MetricRow
        icon="🔧"
        title="Знос ріжучого елементу"
        desc="Як швидко зноситься диск або свердло"
      >
        {results.map((r, i) => {
          const info = WEAR_INFO[r.wearRate];
          return (
            <Cell key={i} isWinner={i === winners.leastWear}>
              <div className="text-sm font-bold" style={{ color: info.color }}>{info.label}</div>
              <div className="text-[11px] text-[#6B7280] mt-0.5">{info.sub}</div>
              {i === winners.leastWear && <WinnerBadge label="Довше служить" />}
            </Cell>
          );
        })}
      </MetricRow>

      {/* ── Heat ── */}
      <MetricRow
        icon="🌡"
        title="Нагрів під час роботи"
        desc="Температура інструменту — впливає на безпеку та ресурс"
      >
        {results.map((r, i) => {
          const info = HEAT_INFO[r.heatLevel];
          return (
            <Cell key={i} isWinner={false}>
              <div className="text-sm font-bold" style={{ color: info.color }}>{info.label}</div>
              <div className="text-[11px] text-[#6B7280] mt-0.5">{info.sub}</div>
            </Cell>
          );
        })}
      </MetricRow>

      {/* ── Warnings ── */}
      {results.some(r => r.warnings.length > 0) && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-3 space-y-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-[#92400E]">
            <span>⚠️</span> Важливо знати
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${results.length}, 1fr)` }}>
            {results.map((r, i) => (
              <div key={i}>
                {r.warnings.length > 0 ? (
                  <ul className="space-y-1">
                    {r.warnings.map((w, wi) => (
                      <li key={wi} className="text-[11px] text-[#78350F] flex items-start gap-1">
                        <span className="mt-0.5 shrink-0">•</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[11px] text-[#15803D]">✓ Без зауважень</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Layout helpers ──

function MetricRow({ icon, title, desc, children }: {
  icon: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  const count = Array.isArray(children) ? children.length : 1;
  return (
    <div
      className="grid gap-2 bg-white border border-[#EFEFEF] rounded-xl p-3 items-start"
      style={{ gridTemplateColumns: `140px repeat(${count}, 1fr)` }}
    >
      <div className="flex items-start gap-1.5 pt-0.5">
        <span className="text-base shrink-0">{icon}</span>
        <div>
          <div className="text-xs font-semibold text-[#0A0A0A] leading-tight">{title}</div>
          <div className="text-[10px] text-[#9E9E9E] leading-tight mt-0.5">{desc}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Cell({ isWinner, children }: { isWinner: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg p-2 space-y-0.5 ${isWinner ? "bg-[#FFFDE7] border border-[#FFD600]/50" : "bg-[#F9F9F9]"}`}>
      {children}
    </div>
  );
}
