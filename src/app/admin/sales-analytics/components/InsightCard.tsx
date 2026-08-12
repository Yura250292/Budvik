"use client";

import { money, num } from "@/components/ui/Stat";
import type { Insight, InsightSeverity, InsightSource, InsightUnit } from "@/lib/ai/insights";

/**
 * Картка інсайту й секційний вивід звіту.
 *
 * Винесено з InsightsPanel, бо той самий вигляд потрібен у двох місцях:
 * у свіжому аналізі й у збереженому звіті з архіву. Дублювати розмітку
 * означало б, що колись вони розійдуться — і той самий інсайт виглядатиме
 * по-різному залежно від того, звідки на нього дивишся.
 *
 * Звіт читається секціями за гостротою — п'ять кольорів, від червоного до
 * зеленого: керівник із першого погляду бачить, скільки «горить», а що
 * просто до відома. Порожні секції не показуються.
 */

/**
 * Тони секцій. Палітра власна, а не зі STATUS: там немає окремих
 * помаранчевого і жовтого, а тут це різні рівні тривоги — «вже негативна
 * тенденція» проти «поки лише тримати на оці».
 */
type Tone = { fg: string; bg: string; border: string; mark: string };

export const SEVERITY_META: Record<
  InsightSeverity,
  { label: string; section: string; tone: Tone }
> = {
  critical: {
    label: "Критично",
    section: "Критично — реагувати зараз",
    tone: { fg: "#B91C1C", bg: "#FEF2F2", border: "#FECACA", mark: "#DC2626" },
  },
  warning: {
    label: "Тривожно",
    section: "Тривожні тенденції",
    tone: { fg: "#C2410C", bg: "#FFF7ED", border: "#FED7AA", mark: "#EA580C" },
  },
  watch: {
    label: "На оці",
    section: "Тримати на оці",
    tone: { fg: "#A16207", bg: "#FEFCE8", border: "#FDE68A", mark: "#CA8A04" },
  },
  info: {
    label: "До відома",
    section: "До відома",
    tone: { fg: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE", mark: "#2563EB" },
  },
  positive: {
    label: "Добре",
    section: "Що працює добре",
    tone: { fg: "#047857", bg: "#ECFDF5", border: "#A7F3D0", mark: "#059669" },
  },
};

/** Найгостріші зверху — керівник читає згори вниз і не мусить шукати. */
export const SEVERITY_ORDER: InsightSeverity[] = [
  "critical",
  "warning",
  "watch",
  "info",
  "positive",
];

/**
 * Куди «провалюватись» за кожним джерелом. Якорі стоять на блоках даних у
 * профілі торгового та на вкладці порівняння — див. RepProfile,
 * PortfolioSection і BenchmarkTab.
 */
export const SOURCE_META: Record<InsightSource, { label: string; anchor: string }> = {
  summary: { label: "Підсумок періоду", anchor: "rep-summary" },
  dynamics: { label: "Темп роботи", anchor: "rep-dynamics" },
  portfolio: { label: "Портфель клієнтів", anchor: "rep-portfolio" },
  receivables: { label: "Дебіторка", anchor: "rep-receivables" },
  returns: { label: "Документи з поверненнями", anchor: "rep-documents" },
  benchmark: { label: "Таблиця порівняння", anchor: "team-benchmark" },
  strengths: { label: "Сильні та слабкі сторони", anchor: "team-strengths" },
  brands: { label: "Бренди по торгових", anchor: "team-brands" },
};

/** Посилання на блок даних, з якого взяті числа інсайту. */
export type SourceLink = { href: string; onClick?: () => void };
export type SourceResolver = (source: InsightSource) => SourceLink | null;

/** Резолвер для сторінки, де блоки даних стоять поруч — просто якір. */
export function anchorResolver(source: InsightSource): SourceLink | null {
  const meta = SOURCE_META[source];
  return meta ? { href: `#${meta.anchor}` } : null;
}

export function sortInsights(list: Insight[]): Insight[] {
  return [...list].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );
}

export function formatValue(value: number, unit: InsightUnit): string {
  if (unit === "uah") return `${money(value)} ₴`;
  if (unit === "pct") return `${num(Math.round(value))}%`;
  if (unit === "days") return `${num(value)} дн.`;
  return num(value);
}

/** Старі звіти можуть нести невідому severity — кладемо в «До відома». */
function metaOf(severity: InsightSeverity) {
  return SEVERITY_META[severity] ?? SEVERITY_META.info;
}

export function InsightCard({
  insight,
  resolveSource,
}: {
  insight: Insight;
  /** Без нього рядок «джерело» не рендериться (старі звіти без source) */
  resolveSource?: SourceResolver;
}) {
  const meta = metaOf(insight.severity);
  const tone = meta.tone;
  const evidence = Array.isArray(insight.evidence) ? insight.evidence : [];

  const sourceMeta = insight.source ? SOURCE_META[insight.source] : undefined;
  const sourceLink =
    insight.source && sourceMeta && resolveSource ? resolveSource(insight.source) : null;

  return (
    <li
      className="rounded-[var(--radius-card)] border p-3"
      style={{ borderColor: tone.border, backgroundColor: tone.bg }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className="rounded-[var(--radius-badge)] px-1.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: tone.mark, color: "#fff" }}
        >
          {meta.label}
        </span>
        <span className="font-semibold text-bk">{insight.title}</span>
      </div>

      <p className="mt-1.5 text-sm text-g600">{insight.detail}</p>

      {evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {evidence.map((e, i) => (
            <span
              key={`${e.label}-${i}`}
              className="inline-flex items-baseline gap-1.5 rounded-[var(--radius-badge)] border border-white/60 bg-white/70 px-2 py-1 text-xs"
            >
              <span className="text-g600">{e.label}</span>
              <span className="font-semibold tabular-nums text-bk">
                {formatValue(e.value, e.unit)}
              </span>
            </span>
          ))}
        </div>
      )}

      {insight.action && (
        <p className="mt-2 text-sm font-medium" style={{ color: tone.fg }}>
          → {insight.action}
        </p>
      )}

      {/* Період і джерело: що з чим порівняно і де лежать сирі числа.
          Старі звіти цих полів не мають — рядок тоді не рендериться. */}
      {(insight.period || sourceLink) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/60 pt-2 text-xs">
          {insight.period ? <span className="text-g500">Період: {insight.period}</span> : <span />}
          {sourceLink && sourceMeta && (
            <a
              href={sourceLink.href}
              onClick={sourceLink.onClick}
              className="cursor-pointer font-medium underline underline-offset-2"
              style={{ color: tone.fg }}
            >
              Джерело: {sourceMeta.label} →
            </a>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Звіт секціями за гостротою: заголовок із лічильником, під ним картки.
 * Порожні секції зникають — «Критично: 0» лише додавав би шуму.
 */
export function InsightSections({
  insights,
  resolveSource,
}: {
  insights: Insight[];
  resolveSource?: SourceResolver;
}) {
  return (
    <div className="mt-3 space-y-4">
      {SEVERITY_ORDER.map((severity) => {
        const meta = SEVERITY_META[severity];
        const list = insights.filter((i) => metaOf(i.severity) === meta);
        if (list.length === 0) return null;
        return (
          <section key={severity}>
            <div className="mb-2 flex items-center gap-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: meta.tone.mark }}
              />
              <h4 className="text-sm font-semibold" style={{ color: meta.tone.fg }}>
                {meta.section}
              </h4>
              <span className="text-xs text-g400">{list.length}</span>
            </div>
            <ul className="space-y-2.5">
              {list.map((insight, i) => (
                <InsightCard
                  key={`${insight.title}-${i}`}
                  insight={insight}
                  resolveSource={resolveSource}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
