"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { kyivToday } from "@/components/ui/PeriodPicker";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { RepFilter, useRepFilter } from "@/components/ui/RepFilter";
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
  suggested: { plan: Record<string, number>; fact: Record<string, number> };
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

const fmtPct = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}%`);

const inputClass =
  "w-full rounded-[var(--radius-btn)] border border-g200 px-2 py-1.5 text-sm text-right focus:border-g400 focus:outline-none";
const cellInput = `${inputClass} min-w-[88px]`;

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
  // губляться свідомо: тягнути чернетку травня у червень було б гірше.
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
  const visibleReps = repFilter.apply(data?.reps ?? []);

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
    for (const rep of visibleReps) {
      const e = entryOf(rep.id);
      const r = rows.get(rep.id);
      plan += parseNum(e.planAmount);
      fact += parseNum(e.factAmount);
      gross += r?.totalGrossUah ?? 0;
      base += r?.baseBonus ?? 0;
      total += r?.total ?? 0;
    }
    return { plan, fact, gross, base, total, attainment: plan > 0 ? (fact / plan) * 100 : null };
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

  return (
    <div className="space-y-4">
      {failure && <ErrorBox message={failure} />}
      {notice && (
        <div className="rounded-[var(--radius-card)] border border-g200 bg-g50 px-4 py-2.5 text-sm text-g600">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="payroll-month" className="text-xs font-medium text-g500">
            Місяць:
          </label>
          <input
            id="payroll-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || kyivToday().slice(0, 7))}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
          />
          {data && !data.exists && (
            <span className="text-xs text-g400">місяць ще не зберігався</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RepFilter
            reps={data?.reps ?? []}
            hiddenIds={repFilter.hiddenIds}
            onChange={repFilter.setHidden}
          />
          <button
            type="button"
            onClick={pullSuggested}
            disabled={!data || busy}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-3 py-1.5 text-xs font-medium text-g600 transition-colors hover:bg-g100 hover:text-bk disabled:cursor-not-allowed disabled:opacity-50"
            title="План — з вкладки «Плани», факт — оборот по відвантаженню з документів 1С"
          >
            ⟳ План і факт із сайту
          </button>
          <button
            type="button"
            onClick={() => setShowGroups((v) => !v)}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-3 py-1.5 text-xs font-medium text-g600 transition-colors hover:bg-g100 hover:text-bk"
          >
            Індивідуальні умови фірм{activeGroups.length ? ` (${activeGroups.length})` : ""}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!data || busy || !dirty}
            className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3.5 py-1.5 text-xs font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Збереження…" : dirty ? "Зберегти зміни" : "Збережено"}
          </button>
        </div>
      </div>

      {showGroups && <GroupsEditor groups={data?.groups ?? []} onChanged={reload} />}

      <Card>
        <CardHeader
          title="Курси та сходинки місяця"
          hint="Курси фіксуються на місяць нарахування. Сходинка — % від валу залежно від виконання плану."
        />
        <div className="flex flex-wrap items-end gap-4">
          {(
            [
              ["usd", "Курс $"],
              ["eur", "Курс €"],
              ["pln", "Курс zł"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs text-g500">{label}</span>
              <input
                value={rates[key]}
                onChange={(e) => {
                  setRates((r) => ({ ...r, [key]: e.target.value }));
                  setDirty(true);
                }}
                inputMode="decimal"
                placeholder="0"
                className={`${inputClass} w-24`}
              />
            </label>
          ))}

          <div className="flex flex-wrap items-end gap-2">
            {tiers.steps.map((s, i) => (
              <div key={i} className="flex items-end gap-1">
                <label className="block">
                  <span className="mb-1 block text-xs text-g500">
                    {i === 0 ? "до, %" : "до, % включно"}
                  </span>
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
                    inputMode="decimal"
                    className={`${inputClass} w-16`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-g500">→ %</span>
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
                    inputMode="decimal"
                    className={`${inputClass} w-16`}
                  />
                </label>
              </div>
            ))}
            <label className="block">
              <span className="mb-1 block text-xs text-g500">понад → %</span>
              <input
                value={String(tiers.topPercent)}
                onChange={(e) => {
                  setTiers((t) => ({ ...t, topPercent: parseNum(e.target.value) }));
                  setDirty(true);
                }}
                inputMode="decimal"
                className={`${inputClass} w-16`}
              />
            </label>
          </div>
        </div>
        <p className="mt-2 text-xs text-g400">
          Читається: виконання менше {tiers.steps[0]?.limit ?? 100}% →{" "}
          {tiers.steps[0]?.percent ?? 30}%
          {tiers.steps.slice(1).map((s, i) => (
            <span key={i}>
              , {tiers.steps[i].limit}–{s.limit}% → {s.percent}%
            </span>
          ))}
          , понад {tiers.steps[tiers.steps.length - 1]?.limit ?? 120}% → {tiers.topPercent}%.
        </p>
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Вал і бонус за місяць"
            hint="Вал по валютах — з 1С-звіту «Валовая прибыль вал», без ПДВ і без фірм з індивідуальними умовами. Бонуси клієнтам віднімаються від валу."
          />
        </div>
        {loading && !data ? (
          <div className="p-4">
            <TableSkeleton />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="sticky left-0 bg-g50 px-4 py-2.5">Торговий</th>
                  <th className="px-2 py-2.5 text-right">Дні</th>
                  <th className="px-2 py-2.5 text-right">План, ₴</th>
                  <th className="px-2 py-2.5 text-right">Факт, ₴</th>
                  <th className="px-2 py-2.5 text-right">% вик.</th>
                  <th className="px-2 py-2.5 text-right">Вал ₴</th>
                  <th className="px-2 py-2.5 text-right">Вал $</th>
                  <th className="px-2 py-2.5 text-right">Вал €</th>
                  <th className="px-2 py-2.5 text-right">Вал zł</th>
                  <th className="px-2 py-2.5 text-right">Бонуси кл., ₴</th>
                  <th className="px-2 py-2.5 text-right">Вал загал., ₴</th>
                  <th className="px-2 py-2.5 text-right">Ставка</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Бонус за вал, ₴</th>
                  {activeGroups.map((g) => (
                    <th key={g.id} className="px-2 py-2.5 text-right">
                      {g.name}, ₴
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-semibold">Разом, ₴</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {visibleReps.map((rep) => {
                  const e = entryOf(rep.id);
                  const r = rows.get(rep.id);
                  const num = (field: EntryField, title?: string) => (
                    <input
                      value={e[field]}
                      onChange={(ev) => setEntryField(rep.id, field, ev.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      title={title}
                      className={cellInput}
                    />
                  );
                  const suggestedPlan = data?.suggested.plan[rep.id];
                  const suggestedFact = data?.suggested.fact[rep.id];
                  return (
                    <tr key={rep.id} className="hover:bg-g50">
                      <td className="sticky left-0 bg-white px-4 py-2 font-medium text-bk">
                        {rep.name}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={e.workDays}
                          onChange={(ev) => setEntryField(rep.id, "workDays", ev.target.value)}
                          inputMode="numeric"
                          placeholder="0"
                          className={`${inputClass} w-14`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        {num(
                          "planAmount",
                          suggestedPlan !== undefined ? `З вкладки «Плани»: ${fmt(suggestedPlan)}` : undefined
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {num(
                          "factAmount",
                          suggestedFact !== undefined ? `Оборот із сайту: ${fmt(suggestedFact)}` : undefined
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-g600">
                        {fmtPct(r?.attainment ?? null)}
                      </td>
                      <td className="px-2 py-2">{num("grossUah")}</td>
                      <td className="px-2 py-2">{num("grossUsd")}</td>
                      <td className="px-2 py-2">{num("grossEur")}</td>
                      <td className="px-2 py-2">{num("grossPln")}</td>
                      <td className="px-2 py-2">{num("clientBonuses")}</td>
                      <td
                        className={`px-2 py-2 text-right tabular-nums ${
                          (r?.totalGrossUah ?? 0) < 0 ? "text-red-600" : "text-bk"
                        }`}
                      >
                        {fmt(r?.totalGrossUah ?? 0)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-g600">
                        {r?.appliedPercent ? `${r.appliedPercent}%` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-bk">
                        {fmt(r?.baseBonus ?? 0)}
                      </td>
                      {activeGroups.map((g) => {
                        const b = r?.termBonuses.find((x) => x.groupId === g.id);
                        return (
                          <td key={g.id} className="px-2 py-2 text-right tabular-nums text-g600">
                            {fmt(b?.bonusUah ?? 0)}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-bk">
                        {fmt(r?.total ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-g200 bg-g50 text-xs font-semibold text-bk">
                  <td className="sticky left-0 bg-g50 px-4 py-2.5">Разом</td>
                  <td />
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(totals.plan)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(totals.fact)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtPct(totals.attainment)}</td>
                  <td colSpan={5} />
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(totals.gross)}</td>
                  <td />
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(totals.base)}</td>
                  <td colSpan={activeGroups.length} />
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {activeGroups.map((g) => (
        <Card key={g.id} padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title={`Індивідуальні умови — ${g.name}`}
              hint={`Продажі групи в ${CURRENCY_LABELS[g.currency]} без ПДВ. Відсоток — ручний: коефіцієнт рентабельності поруч підказує, чи прогинався торговий по ціні. Бонус = продажі × % × курс.${
                g.brands ? ` Бренди: ${g.brands}.` : ""
              }`}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Торговий</th>
                  <th className="px-2 py-2.5 text-right">
                    Продажі, {CURRENCY_LABELS[g.currency]}
                  </th>
                  <th className="px-2 py-2.5 text-right">Коеф. рент.</th>
                  <th className="px-2 py-2.5 text-right">% для бонусу</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Бонус, ₴</th>
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
                            inputMode="decimal"
                            placeholder={field === "rentCoef" ? "—" : "0"}
                            className={cellInput}
                          />
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-bk">
                        {fmt(b?.bonusUah ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Редактор груп «за дужками». Зміни застосовуються одразу (це довідник,
 * а не місячні цифри), тому тут свої запити, окремо від «Зберегти зміни».
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
            <span className="text-xs text-g400">{CURRENCY_LABELS[g.currency]}</span>
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
                onClick={() => {
                  if (
                    !confirm(
                      `Видалити групу «${g.name}»? Зникнуть і її цифри в минулих місяцях. Щоб просто прибрати з нових місяців — «Вимкнути».`
                    )
                  )
                    return;
                  call(`/api/admin/motivation/term-groups/${g.id}`, "DELETE");
                }}
                className="cursor-pointer rounded-[var(--radius-btn)] px-2 py-1 text-xs text-g400 transition-colors hover:bg-g100 hover:text-bk disabled:opacity-50"
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-g100 pt-3">
        <label className="block">
          <span className="mb-1 block text-xs text-g500">Назва групи</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="APRO + Сила + UNIFIX + 12Atelie"
            className="w-64 rounded-[var(--radius-btn)] border border-g200 px-2 py-1.5 text-sm focus:border-g400 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-g500">Бренди (довідково)</span>
          <input
            value={brands}
            onChange={(e) => setBrands(e.target.value)}
            placeholder="APRO, Сила, UNIFIX, 12Atelie"
            className="w-64 rounded-[var(--radius-btn)] border border-g200 px-2 py-1.5 text-sm focus:border-g400 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-g500">Валюта продажів</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as PayrollCurrency)}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-2 py-1.5 text-sm focus:border-g400 focus:outline-none"
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
