"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { kyivToday } from "@/components/ui/PeriodPicker";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { RepFilter, useRepFilter } from "@/components/ui/RepFilter";
import { TableScroll } from "@/components/ui/TableScroll";
import { StatCard, money } from "@/components/ui/Stat";
import { STATUS, attainmentStatus } from "@/lib/analytics/colors";
import {
  computeRow,
  CURRENCY_LABELS,
  PAYROLL_CURRENCIES,
  type PayrollCurrency,
  type PayrollTiers,
} from "@/lib/motivation/payroll";

/**
 * Розрахунок мотивації по валу — електронна версія таблиці «Мотивація
 * Торговий Відділ». Вал по валютах поки вноситься вручну з 1С-звіту
 * «Валовая прибыль вал» (обмін собівартість ще не передає), а курси,
 * сходинки, переведення в гривню і бонуси сайт рахує сам — наживо,
 * поки адмін друкує цифри.
 *
 * «Фірми за дужками» (APRO та інші індивідуальні умови) в загальний вал
 * не входять: їхній бонус — окремий, з ручним відсотком, бо рентабельність
 * там — рішення торгового, а не шкали.
 */

type Group = { id: string; name: string; brands: string; currency: PayrollCurrency; isActive: boolean };

type PayrollResponse = {
  month: string;
  exists: boolean;
  settings: { usdRate: number; eurRate: number; plnRate: number; tiers: PayrollTiers };
  reps: Array<{ id: string; name: string }>;
  groups: Group[];
  entries: Array<{
    repId: string;
    workDays: number;
    planAmount: number;
    factAmount: number;
    grossUah: number;
    grossUsd: number;
    grossEur: number;
    grossPln: number;
    clientBonuses: number;
  }>;
  termEntries: Array<{
    groupId: string;
    repId: string;
    salesAmount: number;
    rentCoef: number | null;
    bonusPercent: number;
  }>;
  suggested: {
    plan: Record<string, number>;
    fact: Record<string, number>;
    /** Вал із 1С: сума в грн і частка обороту, для якої собівартість відома. */
    gross?: Record<string, { uah: number; covered: number }>;
  };
};

/** Поля рядка торгового, що вводяться руками. */
type EntryField =
  | "workDays"
  | "planAmount"
  | "factAmount"
  | "grossUah"
  | "grossUsd"
  | "grossEur"
  | "grossPln"
  | "clientBonuses";
type EntryDraft = Record<EntryField, string>;

const TERM_FIELDS = ["salesAmount", "rentCoef", "bonusPercent"] as const;
type TermField = (typeof TERM_FIELDS)[number];
type TermDraft = Record<TermField, string>;

/** «45,1» з буфера обміну — теж число: кому міняємо на крапку. */
const parseNum = (v: string): number => {
  const n = Number(v.replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number) =>
  n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

const inputClass =
  "w-full rounded-[var(--radius-btn)] border border-g200 bg-white px-2 py-1.5 text-right text-sm tabular-nums transition-colors placeholder:text-g300 hover:border-g300 focus:border-g400 focus:outline-none";

const toolbarBtn =
  "flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-[13px] font-medium text-g600 transition-colors hover:bg-g100 hover:text-bk disabled:cursor-not-allowed disabled:opacity-50";

const emptyEntry = (): EntryDraft => ({
  workDays: "",
  planAmount: "",
  factAmount: "",
  grossUah: "",
  grossUsd: "",
  grossEur: "",
  grossPln: "",
  clientBonuses: "",
});

const emptyTerm = (): TermDraft => ({ salesAmount: "", rentCoef: "", bonusPercent: "" });

/** Числове поле в чернетку: нуль показуємо порожнім, щоб не друкувати поверх нього. */
const draft = (n: number): string => (n === 0 ? "" : String(n));

/** Іконки — SVG, як усюди в адмінці. */
const RefreshIcon = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
    />
  </svg>
);

const TrashIcon = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  </svg>
);

const BuildingIcon = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
    />
  </svg>
);

export function PayrollTab() {
  const [month, setMonth] = useState(() => kyivToday().slice(0, 7));
  const { data, loading, error, reload } = useApi<PayrollResponse>(
    `/api/admin/motivation/payroll?month=${month}`
  );
  const repFilter = useRepFilter("kpi.payroll.hiddenReps");

  const [rates, setRates] = useState({ usd: "", eur: "", pln: "" });
  const [tiers, setTiers] = useState<PayrollTiers>({ steps: [], topPercent: 40 });
  const [entries, setEntries] = useState<Record<string, EntryDraft>>({});
  const [terms, setTerms] = useState<Record<string, TermDraft>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [showGroups, setShowGroups] = useState(false);

  // Свіжі дані місяця → чернетки. Незбережені правки при зміні місяця
  // губляться свідомо (з попередженням у switchMonth): тягнути чернетку
  // травня у червень було б гірше.
  useEffect(() => {
    if (!data) return;
    setRates({
      usd: draft(data.settings.usdRate),
      eur: draft(data.settings.eurRate),
      pln: draft(data.settings.plnRate),
    });
    setTiers(data.settings.tiers);
    const e: Record<string, EntryDraft> = {};
    for (const row of data.entries) {
      e[row.repId] = {
        workDays: draft(row.workDays),
        planAmount: draft(row.planAmount),
        factAmount: draft(row.factAmount),
        grossUah: draft(row.grossUah),
        grossUsd: draft(row.grossUsd),
        grossEur: draft(row.grossEur),
        grossPln: draft(row.grossPln),
        clientBonuses: draft(row.clientBonuses),
      };
    }
    setEntries(e);
    const t: Record<string, TermDraft> = {};
    for (const row of data.termEntries) {
      t[`${row.groupId}:${row.repId}`] = {
        salesAmount: draft(row.salesAmount),
        rentCoef: row.rentCoef === null ? "" : String(row.rentCoef),
        bonusPercent: draft(row.bonusPercent),
      };
    }
    setTerms(t);
    setDirty(false);
  }, [data]);

  const activeGroups = useMemo(() => (data?.groups ?? []).filter((g) => g.isActive), [data]);

  /**
   * Фокус на одному торговому. Окремо від repFilter: той ховає давно
   * неактивні акаунти надовго (лежить у localStorage), а це — разовий
   * «покажи мені лише його», щоб внести цифри одній людині й не
   * промахнутись рядком у широкій таблиці.
   */
  const [focusRep, setFocusRep] = useState<string | null>(null);
  const allReps = useMemo(() => data?.reps ?? [], [data]);
  const filteredReps = repFilter.apply(allReps);
  const focusedName = focusRep ? allReps.find((r) => r.id === focusRep)?.name : null;
  // Торговий, якого сховали фільтром, фокус не воскрешає — інакше два
  // фільтри сперечалися б, і було б незрозуміло, який переміг.
  const visibleReps = focusRep ? filteredReps.filter((r) => r.id === focusRep) : filteredReps;
  const hiddenCount = allReps.length - filteredReps.length;

  // Фокус на комусь, кого прибрали фільтром або хто зник зі списку,
  // мовчки скидається: порожня таблиця без пояснень читається як помилка.
  useEffect(() => {
    if (focusRep && !filteredReps.some((r) => r.id === focusRep)) setFocusRep(null);
  }, [focusRep, filteredReps]);

  const parsedRates = {
    usdRate: parseNum(rates.usd),
    eurRate: parseNum(rates.eur),
    plnRate: parseNum(rates.pln),
  };

  const entryOf = (repId: string): EntryDraft => entries[repId] ?? emptyEntry();
  const termOf = (groupId: string, repId: string): TermDraft =>
    terms[`${groupId}:${repId}`] ?? emptyTerm();

  const setEntryField = (repId: string, field: EntryField, value: string) => {
    setEntries((prev) => ({ ...prev, [repId]: { ...(prev[repId] ?? emptyEntry()), [field]: value } }));
    setDirty(true);
  };
  const setTermField = (groupId: string, repId: string, field: TermField, value: string) => {
    const key = `${groupId}:${repId}`;
    setTerms((prev) => ({ ...prev, [key]: { ...(prev[key] ?? emptyTerm()), [field]: value } }));
    setDirty(true);
  };

  /** Зміна місяця з захистом від втрати незбережених правок. */
  const switchMonth = (next: string) => {
    if (dirty && !confirm("Є незбережені зміни — при зміні місяця вони зникнуть. Продовжити?")) {
      return;
    }
    setNotice(null);
    setFailure(null);
    setMonth(next || kyivToday().slice(0, 7));
  };

  // Розрахунок наживо тими самими функціями, що й сервер
  const rows = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeRow>>();
    for (const rep of data?.reps ?? []) {
      const e = entryOf(rep.id);
      map.set(
        rep.id,
        computeRow(
          {
            repId: rep.id,
            workDays: Math.round(parseNum(e.workDays)),
            planAmount: parseNum(e.planAmount),
            factAmount: parseNum(e.factAmount),
            grossUah: parseNum(e.grossUah),
            grossUsd: parseNum(e.grossUsd),
            grossEur: parseNum(e.grossEur),
            grossPln: parseNum(e.grossPln),
            clientBonuses: parseNum(e.clientBonuses),
          },
          parsedRates,
          tiers,
          activeGroups,
          activeGroups.flatMap((g) =>
            (data?.reps ?? []).map((r) => {
              const t = termOf(g.id, r.id);
              return {
                groupId: g.id,
                repId: r.id,
                salesAmount: parseNum(t.salesAmount),
                rentCoef: t.rentCoef === "" ? null : parseNum(t.rentCoef),
                bonusPercent: parseNum(t.bonusPercent),
              };
            })
          )
        )
      );
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, entries, terms, rates, tiers, activeGroups]);

  const totals = useMemo(() => {
    let plan = 0,
      fact = 0,
      gross = 0,
      base = 0,
      total = 0;
    const perGroup = new Map<string, number>();
    for (const rep of visibleReps) {
      const e = entryOf(rep.id);
      const r = rows.get(rep.id);
      plan += parseNum(e.planAmount);
      fact += parseNum(e.factAmount);
      gross += r?.totalGrossUah ?? 0;
      base += r?.baseBonus ?? 0;
      total += r?.total ?? 0;
      for (const b of r?.termBonuses ?? []) {
        perGroup.set(b.groupId, (perGroup.get(b.groupId) ?? 0) + b.bonusUah);
      }
    }
    return { plan, fact, gross, base, total, perGroup, attainment: plan > 0 ? (fact / plan) * 100 : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleReps, rows, entries]);

  async function save() {
    if (!data) return;
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/motivation/payroll", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          usdRate: parsedRates.usdRate,
          eurRate: parsedRates.eurRate,
          plnRate: parsedRates.plnRate,
          tiers,
          entries: data.reps.map((rep) => {
            const e = entryOf(rep.id);
            return {
              repId: rep.id,
              workDays: Math.round(parseNum(e.workDays)),
              planAmount: parseNum(e.planAmount),
              factAmount: parseNum(e.factAmount),
              grossUah: parseNum(e.grossUah),
              grossUsd: parseNum(e.grossUsd),
              grossEur: parseNum(e.grossEur),
              grossPln: parseNum(e.grossPln),
              clientBonuses: parseNum(e.clientBonuses),
            };
          }),
          termEntries: activeGroups.flatMap((g) =>
            data.reps.map((rep) => {
              const t = termOf(g.id, rep.id);
              return {
                groupId: g.id,
                repId: rep.id,
                salesAmount: parseNum(t.salesAmount),
                rentCoef: t.rentCoef === "" ? null : parseNum(t.rentCoef),
                bonusPercent: parseNum(t.bonusPercent),
              };
            })
          ),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      setNotice("Розрахунок збережено");
      setDirty(false);
      reload();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  /** План і факт із сайту: плани з вкладки «Плани», факт — оборот по відвантаженню. */
  function pullSuggested() {
    if (!data) return;
    setEntries((prev) => {
      const next = { ...prev };
      for (const rep of data.reps) {
        const e = { ...(next[rep.id] ?? emptyEntry()) };
        const plan = data.suggested.plan[rep.id];
        const fact = data.suggested.fact[rep.id];
        if (plan !== undefined) e.planAmount = draft(Math.round(plan * 100) / 100);
        if (fact !== undefined) e.factAmount = draft(Math.round(fact * 100) / 100);
        next[rep.id] = e;
      }
      return next;
    });
    setDirty(true);
    setNotice("План і факт підтягнуто з сайту. Перевірте і збережіть.");
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const teamStatus = totals.attainment === null ? "neutral" : attainmentStatus(totals.attainment);

  return (
    <div className="space-y-4 pb-16">
      {failure && <ErrorBox message={failure} />}
      {notice && !dirty && (
        <div className="rounded-[var(--radius-card)] border border-g200 bg-g50 px-4 py-2.5 text-sm text-g600">
          {notice}
        </div>
      )}

      {/* Панель керування місяцем */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="payroll-month" className="text-xs font-medium text-g500">
            Місяць:
          </label>
          <input
            id="payroll-month"
            type="month"
            value={month}
            onChange={(e) => switchMonth(e.target.value)}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-[13px] text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
          />
          {data && !data.exists && (
            <span className="rounded-full border border-g200 bg-g50 px-2.5 py-1 text-[11px] font-medium text-g500">
              чернетка — ще не зберігався
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Швидкий вибір одного торгового: найчастіший сценарій — внести
              цифри конкретній людині, а не читати всю команду. */}
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-g500">Показати:</span>
            <select
              value={focusRep ?? ""}
              onChange={(e) => setFocusRep(e.target.value || null)}
              disabled={filteredReps.length === 0}
              aria-label="Показати одного торгового"
              className={`max-w-[190px] cursor-pointer rounded-[var(--radius-btn)] border px-2.5 py-2 text-[13px] transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                focusRep ? "border-bk bg-bk font-medium text-white" : "border-g200 bg-white text-g600 hover:border-g300"
              }`}
            >
              <option value="">
                Усі торгові{filteredReps.length ? ` (${filteredReps.length})` : ""}
              </option>
              {filteredReps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <RepFilter
            reps={allReps}
            hiddenIds={repFilter.hiddenIds}
            onChange={repFilter.setHidden}
          />
          <button
            type="button"
            onClick={pullSuggested}
            disabled={!data || busy}
            className={toolbarBtn}
            title="План — з вкладки «Плани», факт — оборот по відвантаженню з документів 1С"
          >
            {RefreshIcon}
            <span className="hidden sm:inline">План і факт із сайту</span>
            <span className="sm:hidden">План/факт</span>
          </button>
          <button
            type="button"
            onClick={() => setShowGroups((v) => !v)}
            aria-expanded={showGroups}
            className={`${toolbarBtn} ${showGroups ? "border-g400 bg-g100 text-bk" : ""}`}
          >
            {BuildingIcon}
            <span className="hidden sm:inline">Індивідуальні умови</span>
            <span className="sm:hidden">Інд. умови</span>
            {activeGroups.length > 0 && (
              <span className="rounded-full bg-bk px-1.5 text-[10px] font-semibold leading-4 text-white">
                {activeGroups.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Що саме зараз на екрані: підсумки нижче рахуються лише по видимих,
          тож стан фільтрів має бути видно, а не здогадуватись про нього. */}
      {(focusRep || hiddenCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-g500">
          <span>Показано:</span>
          {focusedName && (
            <button
              type="button"
              onClick={() => setFocusRep(null)}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-bk bg-bk px-2.5 py-1 font-medium text-white transition-opacity hover:opacity-80"
            >
              {focusedName}
              <span aria-hidden>✕</span>
              <span className="sr-only">Показати всіх торгових</span>
            </button>
          )}
          {hiddenCount > 0 && (
            <span className="rounded-full border border-g200 bg-g50 px-2.5 py-1">
              приховано фільтром: {hiddenCount}
            </span>
          )}
          <span className="text-g400">— підсумки й «Разом» рахуються лише по видимих рядках</span>
        </div>
      )}

      {showGroups && <GroupsEditor groups={data?.groups ?? []} onChanged={reload} />}

      {/* Підсумки місяця: скільки виплатимо і з чого воно складається */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Разом до виплати"
          value={money(totals.total)}
          unit="₴"
          accent="var(--color-primary, #FFD600)"
          hint="Бонус за вал + індивідуальні умови"
        />
        <StatCard
          label="Бонус за вал"
          value={money(totals.base)}
          unit="₴"
          hint="K × ставка сходинки"
        />
        <StatCard
          label="Вал загальний"
          value={money(totals.gross)}
          unit="₴"
          hint="Після курсів, мінус бонуси клієнтам"
        />
        <StatCard
          label="Виконання плану"
          value={totals.attainment === null ? "—" : totals.attainment.toFixed(1)}
          unit={totals.attainment === null ? undefined : "%"}
          tone={teamStatus}
          hint={`Команда: ${money(totals.fact)} із ${money(totals.plan)} ₴`}
        />
      </div>

      {/* Курси і сходинки: два компактні блоки в одній карті */}
      <Card>
        <div className="grid gap-5 sm:grid-cols-[auto_1px_1fr]">
          <div>
            <h3 className="text-sm font-semibold text-bk">Курси місяця</h3>
            <p className="mt-0.5 text-xs text-g500">Фіксуються на місяць нарахування.</p>
            <div className="mt-3 flex gap-3">
              {(
                [
                  ["usd", "$"],
                  ["eur", "€"],
                  ["pln", "zł"],
                ] as const
              ).map(([key, symbol]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-center text-xs font-medium text-g500">{symbol}</span>
                  <input
                    value={rates[key]}
                    onChange={(e) => {
                      setRates((r) => ({ ...r, [key]: e.target.value }));
                      setDirty(true);
                    }}
                    onFocus={(e) => e.target.select()}
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Курс ${symbol}`}
                    className={`${inputClass} w-20 text-center`}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="hidden bg-g200 sm:block" aria-hidden />

          <div>
            <h3 className="text-sm font-semibold text-bk">Сходинки бонусу</h3>
            <p className="mt-0.5 text-xs text-g500">
              Відсоток від валу залежно від виконання плану.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tiers.steps.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-g200 bg-g50 px-2.5 py-1.5"
                >
                  <span className="text-xs text-g500">{i === 0 ? "до" : `${tiers.steps[i - 1].limit}–`}</span>
                  <input
                    value={String(s.limit)}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      setTiers((t) => ({
                        ...t,
                        steps: t.steps.map((x, j) => (j === i ? { ...x, limit: v } : x)),
                      }));
                      setDirty(true);
                    }}
                    onFocus={(e) => e.target.select()}
                    inputMode="decimal"
                    aria-label={`Межа сходинки ${i + 1}, %`}
                    className={`${inputClass} w-12 px-1 text-center`}
                  />
                  <span className="text-xs text-g500">% →</span>
                  <input
                    value={String(s.percent)}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      setTiers((t) => ({
                        ...t,
                        steps: t.steps.map((x, j) => (j === i ? { ...x, percent: v } : x)),
                      }));
                      setDirty(true);
                    }}
                    onFocus={(e) => e.target.select()}
                    inputMode="decimal"
                    aria-label={`Ставка сходинки ${i + 1}, %`}
                    className={`${inputClass} w-12 px-1 text-center font-semibold`}
                  />
                  <span className="text-xs font-medium text-g500">%</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-g200 bg-g50 px-2.5 py-1.5">
                <span className="text-xs text-g500">
                  понад {tiers.steps[tiers.steps.length - 1]?.limit ?? 120}% →
                </span>
                <input
                  value={String(tiers.topPercent)}
                  onChange={(e) => {
                    setTiers((t) => ({ ...t, topPercent: parseNum(e.target.value) }));
                    setDirty(true);
                  }}
                  onFocus={(e) => e.target.select()}
                  inputMode="decimal"
                  aria-label="Ставка понад останню межу, %"
                  className={`${inputClass} w-12 px-1 text-center font-semibold`}
                />
                <span className="text-xs font-medium text-g500">%</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Головна таблиця */}
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Вал і бонус за місяць"
            hint="Вал — з 1С: Отчеты → Продажи → Анализ продаж → «Валовая прибыль вал», без ПДВ і без фірм з індивідуальними умовами."
          />
        </div>
        {loading && !data ? (
          <div className="p-4">
            <TableSkeleton />
          </div>
        ) : (
          <TableScroll minWidth={1280}>
            <table className="w-full text-sm">
              <thead>
                {/* Груповий рядок: що вводиться, а що рахується само */}
                <tr className="border-y border-g200 bg-g50 text-[11px] font-semibold uppercase tracking-wide text-g400">
                  <th className="sticky left-0 z-10 bg-g50 px-4 py-2" aria-label="Торговий" />
                  <th colSpan={4} className="border-l border-g200 px-2 py-2 text-left">
                    План
                  </th>
                  <th colSpan={5} className="border-l border-g200 px-2 py-2 text-left">
                    Вал із 1С за валютами
                  </th>
                  <th
                    colSpan={3 + activeGroups.length + 1}
                    className="border-l border-g200 px-2 py-2 text-left"
                  >
                    Рахується само
                  </th>
                </tr>
                <tr className="border-b border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="sticky left-0 z-10 bg-g50 px-4 py-2.5">Торговий</th>
                  <th className="border-l border-g200 px-2 py-2.5 text-right">Дні</th>
                  <th className="px-2 py-2.5 text-right">План, ₴</th>
                  <th className="px-2 py-2.5 text-right">Факт, ₴</th>
                  <th className="px-2 py-2.5 text-right">Вик.</th>
                  <th className="border-l border-g200 px-2 py-2.5 text-right">₴</th>
                  <th className="px-2 py-2.5 text-right">$</th>
                  <th className="px-2 py-2.5 text-right">€</th>
                  <th className="px-2 py-2.5 text-right">zł</th>
                  <th className="px-2 py-2.5 text-right">Бонуси кл., ₴</th>
                  <th className="border-l border-g200 px-2 py-2.5 text-right">Вал загал., ₴</th>
                  <th className="px-2 py-2.5 text-center">Ставка</th>
                  <th className="px-2 py-2.5 text-right">Бонус за вал, ₴</th>
                  {activeGroups.map((g) => (
                    <th key={g.id} className="px-2 py-2.5 text-right" title={g.brands || g.name}>
                      {g.name.length > 14 ? `${g.name.slice(0, 13)}…` : g.name}, ₴
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-semibold text-bk">Разом, ₴</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {visibleReps.length === 0 && (
                  <tr>
                    <td colSpan={14 + activeGroups.length} className="px-4 py-8 text-center text-xs text-g500">
                      {data?.reps.length === 0
                        ? "Немає жодного торгового з роллю SALES."
                        : "Усіх торгових приховано фільтром."}
                    </td>
                  </tr>
                )}
                {visibleReps.map((rep) => {
                  const e = entryOf(rep.id);
                  const r = rows.get(rep.id);
                  const att = r?.attainment ?? null;
                  const attTone = att === null ? null : STATUS[attainmentStatus(att)];
                  const numInput = (field: EntryField, width = "w-[92px]") => (
                    <input
                      value={e[field]}
                      onChange={(ev) => setEntryField(rep.id, field, ev.target.value)}
                      onFocus={(ev) => ev.target.select()}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`${rep.name}: ${field}`}
                      className={`${inputClass} ${width}`}
                    />
                  );
                  const hint = (suggested: number | undefined, field: EntryField) => {
                    if (suggested === undefined) return null;
                    const rounded = Math.round(suggested * 100) / 100;
                    if (parseNum(e[field]) === rounded) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => setEntryField(rep.id, field, draft(rounded))}
                        title="Підставити значення з сайту"
                        className="mt-0.5 block w-full cursor-pointer truncate text-right text-[10px] leading-3 text-g400 transition-colors hover:text-bk"
                      >
                        сайт: {money(rounded)}
                      </button>
                    );
                  };
                  return (
                    <tr key={rep.id} className="group hover:bg-g50">
                      <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium text-bk shadow-[1px_0_0_var(--color-g200,#e5e5e5)] group-hover:bg-g50">
                        {/* Клік по імені лишає в таблиці лише цього торгового —
                            найкоротший шлях до «внести цифри одному». */}
                        <button
                          type="button"
                          onClick={() => setFocusRep(focusRep === rep.id ? null : rep.id)}
                          title={focusRep === rep.id ? "Показати всіх" : `Показати лише «${rep.name}»`}
                          className="cursor-pointer text-left transition-colors hover:text-g600"
                        >
                          {rep.name}
                        </button>
                      </td>
                      <td className="border-l border-g100 px-2 py-2 align-top">
                        <input
                          value={e.workDays}
                          onChange={(ev) => setEntryField(rep.id, "workDays", ev.target.value)}
                          onFocus={(ev) => ev.target.select()}
                          inputMode="numeric"
                          placeholder="0"
                          aria-label={`${rep.name}: робочі дні`}
                          className={`${inputClass} w-14`}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        {numInput("planAmount", "w-[104px]")}
                        {hint(data?.suggested.plan[rep.id], "planAmount")}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {numInput("factAmount", "w-[104px]")}
                        {hint(data?.suggested.fact[rep.id], "factAmount")}
                      </td>
                      <td className="px-2 py-2 text-right align-middle">
                        {att === null ? (
                          <span className="text-g400">—</span>
                        ) : (
                          <span
                            className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                            style={{ color: attTone!.fg, backgroundColor: attTone!.bg }}
                          >
                            {fmtPct(att)}
                          </span>
                        )}
                      </td>
                      <td className="border-l border-g100 px-2 py-2 align-top">
                        {numInput("grossUah")}
                        {/* Вал із 1С. Підставляється тільки в гривневе поле:
                            собівартість регістр віддає в грн, розкласти її
                            назад по валютах закупівлі неможливо. Частка
                            покриття підписана — вал із половини документів і
                            вал із усіх виглядають однаково, поки не сказати. */}
                        {(() => {
                          const g = data?.suggested.gross?.[rep.id];
                          if (!g || g.uah <= 0) return null;
                          const rounded = Math.round(g.uah * 100) / 100;
                          if (parseNum(e.grossUah) === rounded) return null;
                          return (
                            <button
                              type="button"
                              onClick={() => setEntryField(rep.id, "grossUah", draft(rounded))}
                              title={`Вал із 1С за собівартістю. Собівартість відома для ${Math.round(g.covered)}% обороту.`}
                              className="mt-0.5 block w-full cursor-pointer truncate text-right text-[10px] leading-3 text-g400 transition-colors hover:text-bk"
                            >
                              1С: {money(rounded)}
                              {g.covered < 95 && <span className="text-amber-600"> ({Math.round(g.covered)}%)</span>}
                            </button>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-2 align-top">{numInput("grossUsd", "w-[84px]")}</td>
                      <td className="px-2 py-2 align-top">{numInput("grossEur", "w-[76px]")}</td>
                      <td className="px-2 py-2 align-top">{numInput("grossPln", "w-[76px]")}</td>
                      <td className="px-2 py-2 align-top">{numInput("clientBonuses")}</td>
                      <td
                        className={`border-l border-g100 bg-g50/60 px-2 py-2 text-right tabular-nums ${
                          (r?.totalGrossUah ?? 0) < 0 ? "font-medium text-red-600" : "text-bk"
                        }`}
                      >
                        {fmt(r?.totalGrossUah ?? 0)}
                      </td>
                      <td className="bg-g50/60 px-2 py-2 text-center">
                        {r?.appliedPercent ? (
                          <span className="inline-block rounded-full bg-bk px-2 py-0.5 text-xs font-semibold text-white">
                            {r.appliedPercent}%
                          </span>
                        ) : (
                          <span className="text-g400">—</span>
                        )}
                      </td>
                      <td className="bg-g50/60 px-2 py-2 text-right font-medium tabular-nums text-bk">
                        {fmt(r?.baseBonus ?? 0)}
                      </td>
                      {activeGroups.map((g) => {
                        const b = r?.termBonuses.find((x) => x.groupId === g.id);
                        return (
                          <td key={g.id} className="bg-g50/60 px-2 py-2 text-right tabular-nums text-g600">
                            {fmt(b?.bonusUah ?? 0)}
                          </td>
                        );
                      })}
                      <td className="bg-g50/60 px-4 py-2 text-right font-semibold tabular-nums text-bk">
                        {fmt(r?.total ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-g200 bg-g50 text-xs font-semibold text-bk">
                  <td className="sticky left-0 z-10 bg-g50 px-4 py-2.5">Разом</td>
                  <td className="border-l border-g200" />
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(totals.plan)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(totals.fact)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtPct(totals.attainment)}</td>
                  <td colSpan={5} className="border-l border-g200" />
                  <td className="border-l border-g200 px-2 py-2.5 text-right tabular-nums">
                    {fmt(totals.gross)}
                  </td>
                  <td />
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(totals.base)}</td>
                  {activeGroups.map((g) => (
                    <td key={g.id} className="px-2 py-2.5 text-right tabular-nums">
                      {fmt(totals.perGroup.get(g.id) ?? 0)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        )}
      </Card>

      {/* Таблиці груп «за дужками» */}
      {activeGroups.map((g) => {
        const groupTotal = { sales: 0, bonus: 0 };
        for (const rep of visibleReps) {
          const t = termOf(g.id, rep.id);
          groupTotal.sales += parseNum(t.salesAmount);
          groupTotal.bonus += rows.get(rep.id)?.termBonuses.find((x) => x.groupId === g.id)?.bonusUah ?? 0;
        }
        return (
          <Card key={g.id} padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title={`Індивідуальні умови — ${g.name}`}
                hint={`Продажі групи в ${CURRENCY_LABELS[g.currency]} без ПДВ. Відсоток — ручний: коефіцієнт рентабельності поруч підказує, чи прогинався торговий по ціні. Бонус = продажі × % × курс.${
                  g.brands ? ` Бренди: ${g.brands}.` : ""
                }`}
              />
            </div>
            <TableScroll minWidth={640}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                    <th className="px-4 py-2.5">Торговий</th>
                    <th className="px-2 py-2.5 text-right">
                      Продажі, {CURRENCY_LABELS[g.currency]}
                    </th>
                    <th className="px-2 py-2.5 text-right">Коеф. рент.</th>
                    <th className="px-2 py-2.5 text-right">% для бонусу</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-bk">Бонус, ₴</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-g100">
                  {visibleReps.map((rep) => {
                    const t = termOf(g.id, rep.id);
                    const b = rows.get(rep.id)?.termBonuses.find((x) => x.groupId === g.id);
                    return (
                      <tr key={rep.id} className="hover:bg-g50">
                        <td className="px-4 py-2 font-medium text-bk">{rep.name}</td>
                        {TERM_FIELDS.map((field) => (
                          <td key={field} className="px-2 py-2">
                            <input
                              value={t[field]}
                              onChange={(ev) => setTermField(g.id, rep.id, field, ev.target.value)}
                              onFocus={(ev) => ev.target.select()}
                              inputMode="decimal"
                              placeholder={field === "rentCoef" ? "—" : "0"}
                              aria-label={`${rep.name}: ${
                                field === "salesAmount"
                                  ? "продажі"
                                  : field === "rentCoef"
                                    ? "коефіцієнт рентабельності"
                                    : "% для бонусу"
                              }`}
                              className={`${inputClass} min-w-[88px]`}
                            />
                          </td>
                        ))}
                        <td className="bg-g50/60 px-4 py-2 text-right font-semibold tabular-nums text-bk">
                          {fmt(b?.bonusUah ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-g200 bg-g50 text-xs font-semibold text-bk">
                    <td className="px-4 py-2.5">Разом</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{fmt(groupTotal.sales)}</td>
                    <td colSpan={2} />
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmt(groupTotal.bonus)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableScroll>
          </Card>
        );
      })}

      {/* Липка панель збереження: таблиця довга, кнопка завжди під рукою */}
      {dirty && (
        <div className="sticky bottom-4 z-30">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3 rounded-[var(--radius-card)] border border-g200 bg-white px-4 py-3 shadow-lg">
            <span className="text-sm text-g600">
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary align-middle" aria-hidden />
              Є незбережені зміни
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm("Відкинути всі незбережені зміни?")) reload();
                }}
                className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-3 py-2 text-[13px] font-medium text-g600 transition-colors hover:bg-g100 hover:text-bk disabled:opacity-50"
              >
                Скасувати
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={save}
                className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-[13px] font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Збереження…" : "Зберегти"}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Редактор груп «за дужками». Зміни застосовуються одразу (це довідник,
 * а не місячні цифри), тому тут свої запити, окремо від «Зберегти».
 */
function GroupsEditor({ groups, onChanged }: { groups: Group[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [brands, setBrands] = useState("");
  const [currency, setCurrency] = useState<PayrollCurrency>("USD");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      onChanged();
      return true;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Помилка збереження");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "w-full rounded-[var(--radius-btn)] border border-g200 px-2.5 py-2 text-sm transition-colors placeholder:text-g300 hover:border-g300 focus:border-g400 focus:outline-none";

  return (
    <Card>
      <CardHeader
        title="Фірми з індивідуальними умовами"
        hint="Ці групи виносяться за дужки загального валу — бонус по них рахується окремо, з ручним відсотком."
      />
      {failure && <ErrorBox message={failure} />}

      <div className="space-y-2">
        {groups.length === 0 && (
          <p className="text-xs text-g500">
            Груп ще немає. Додайте першу — наприклад «APRO + Сила + UNIFIX + 12Atelie».
          </p>
        )}
        {groups.map((g) => (
          <div
            key={g.id}
            className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-g200 p-2.5"
          >
            <span className={`text-sm font-medium ${g.isActive ? "text-bk" : "text-g400 line-through"}`}>
              {g.name}
            </span>
            <span className="rounded-full bg-g100 px-2 py-0.5 text-[11px] font-medium text-g500">
              {CURRENCY_LABELS[g.currency]}
            </span>
            {g.brands && <span className="truncate text-xs text-g500">({g.brands})</span>}
            <span className="ml-auto flex gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  call(`/api/admin/motivation/term-groups/${g.id}`, "PUT", { isActive: !g.isActive })
                }
                className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-2.5 py-1 text-xs text-g600 transition-colors hover:bg-g100 hover:text-bk disabled:opacity-50"
              >
                {g.isActive ? "Вимкнути" : "Увімкнути"}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Видалити групу «${g.name}»`}
                onClick={() => {
                  if (
                    !confirm(
                      `Видалити групу «${g.name}»? Зникнуть і її цифри в минулих місяцях. Щоб просто прибрати з нових місяців — «Вимкнути».`
                    )
                  )
                    return;
                  call(`/api/admin/motivation/term-groups/${g.id}`, "DELETE");
                }}
                className="cursor-pointer rounded-[var(--radius-btn)] px-2 py-1 text-g400 transition-colors hover:bg-g100 hover:text-red-600 disabled:opacity-50"
              >
                {TrashIcon}
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 border-t border-g100 pt-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-xs text-g500">Назва групи</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="APRO + Сила + UNIFIX + 12Atelie"
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-g500">Бренди (довідково)</span>
          <input
            value={brands}
            onChange={(e) => setBrands(e.target.value)}
            placeholder="APRO, Сила, UNIFIX, 12Atelie"
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-g500">Валюта</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as PayrollCurrency)}
            className={`${fieldClass} cursor-pointer`}
          >
            {PAYROLL_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c} ({CURRENCY_LABELS[c]})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={async () => {
            const ok = await call("/api/admin/motivation/term-groups", "POST", {
              name: name.trim(),
              brands: brands.trim(),
              currency,
            });
            if (ok) {
              setName("");
              setBrands("");
            }
          }}
          className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3.5 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Додати групу
        </button>
      </div>
    </Card>
  );
}
