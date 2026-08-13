"use client";

import { useEffect, useMemo, useState } from "react";
import type { MotivationRuleType } from "@prisma/client";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CardSkeleton } from "@/components/ui/Skeleton";
import {
  RULE_TYPES,
  RULE_TYPE_LABELS,
  RULE_TYPE_HINTS,
  RULE_FIELDS,
  SUPPORTED_PLAN_METRICS,
  PLAN_METRIC_LABELS,
} from "@/lib/motivation/labels";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

/**
 * Налаштування мотивації: з чого торговий заробляє.
 *
 * Правила схеми складаються в один підсумок: відсоток від зібраного, бонус
 * за виконаний план, утримання за прострочену дебіторку. Заробіток рахується
 * зі зібраних грошей, а не з обороту — продаж без оплати нічого не приносить.
 */

type RuleForm = {
  type: MotivationRuleType;
  value: string;
  brandId: string;
  planMetric: string;
  thresholdFrom: string;
  thresholdTo: string;
  overdueTolerance: string;
};

type Scheme = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isDefault: boolean;
  rules: Array<{
    id: string;
    type: MotivationRuleType;
    value: number;
    brandId: string | null;
    planMetric: string | null;
    thresholdFrom: number | null;
    thresholdTo: number | null;
    overdueTolerance: number | null;
    sortOrder: number;
  }>;
};

type MotivationResponse = {
  schemes: Scheme[];
  reps: Array<{ id: string; name: string; currentAssignment: { schemeId: string; validFrom: string } | null }>;
  brands: Array<{ id: string; name: string }>;
};

const emptyRule = (): RuleForm => ({
  type: "PERCENT_OF_COLLECTED",
  value: "",
  brandId: "",
  planMetric: "",
  thresholdFrom: "",
  thresholdTo: "",
  overdueTolerance: "",
});

const numOrEmpty = (v: number | null) => (v === null || v === undefined ? "" : String(v));

const inputClass =
  "w-full rounded-[var(--radius-btn)] border border-g200 px-2 py-1.5 text-sm focus:border-g400 focus:outline-none";

export function MotivationTab() {
  const { data, loading, error, reload } = useApi<MotivationResponse>("/api/admin/motivation");

  const [selected, setSelected] = useState<string | null>(null);
  const [rules, setRules] = useState<RuleForm[]>([]);
  const [meta, setMeta] = useState({ name: "", isActive: true, isDefault: false });
  const [newSchemeName, setNewSchemeName] = useState("");
  const [assignDraft, setAssignDraft] = useState<Record<string, { schemeId: string; validFrom: string }>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const schemes = useMemo(() => data?.schemes ?? [], [data]);
  const current = schemes.find((s) => s.id === selected) ?? null;

  // Перша схема відкривається сама: порожній редактор поруч зі списком
  // виглядає як помилка завантаження.
  useEffect(() => {
    if (!selected && schemes.length > 0) setSelected(schemes[0].id);
  }, [schemes, selected]);

  useEffect(() => {
    if (!current) return;
    setMeta({ name: current.name, isActive: current.isActive, isDefault: current.isDefault });
    setRules(
      current.rules.map((r) => ({
        type: r.type,
        value: String(r.value),
        brandId: r.brandId ?? "",
        planMetric: r.planMetric ?? "",
        thresholdFrom: numOrEmpty(r.thresholdFrom),
        thresholdTo: numOrEmpty(r.thresholdTo),
        overdueTolerance: numOrEmpty(r.overdueTolerance),
      }))
    );
  }, [current]);

  async function send(url: string, method: string, body: unknown, okMessage: string) {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      setNotice(okMessage);
      reload();
      return json;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Помилка збереження");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return null;

  const brandName = (id: string) => data.brands.find((b) => b.id === id)?.name ?? "бренд";

  return (
    <div className="space-y-4">
      {failure && <ErrorBox message={failure} />}
      {notice && (
        <div className="rounded-[var(--radius-card)] border border-g200 bg-g50 px-4 py-2.5 text-sm text-g600">
          {notice}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader title="Схеми" hint="Набір правил, за якими рахується заробіток." />

          {schemes.length === 0 && (
            <p className="mb-3 text-xs text-g500">Схем ще немає. Створіть першу — і призначте її торговим.</p>
          )}

          <div className="space-y-1">
            {schemes.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-btn)] px-3 py-2 text-left text-sm transition-colors ${
                  selected === s.id ? "bg-bk text-white" : "text-g600 hover:bg-g100"
                }`}
              >
                <span className="truncate">{s.name}</span>
                <span className="flex shrink-0 gap-1">
                  {s.isDefault && <Badge status="info">типова</Badge>}
                  {!s.isActive && <Badge status="neutral">вимкнена</Badge>}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 border-t border-g100 pt-3">
            <input
              value={newSchemeName}
              onChange={(e) => setNewSchemeName(e.target.value)}
              placeholder="Назва нової схеми"
              className={inputClass}
            />
            <button
              type="button"
              disabled={busy || !newSchemeName.trim()}
              onClick={async () => {
                const json = await send("/api/admin/motivation/schemes", "POST", { name: newSchemeName.trim() }, "Схему створено");
                if (json?.scheme?.id) {
                  setSelected(json.scheme.id);
                  setNewSchemeName("");
                }
              }}
              className="mt-2 w-full cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Створити схему
            </button>
          </div>
        </Card>

        <Card>
          {!current ? (
            <EmptyState title="Схему не обрано" hint="Оберіть схему зліва або створіть нову." />
          ) : (
            <>
              <CardHeader
                title="Правила схеми"
                hint="Правила складаються в один підсумок. Утримання застосовуються після нарахувань."
                action={
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      send(
                        `/api/admin/motivation/schemes/${current.id}`,
                        "PUT",
                        {
                          name: meta.name,
                          isActive: meta.isActive,
                          isDefault: meta.isDefault,
                          rules: rules.map((r, i) => ({
                            type: r.type,
                            value: Number(r.value) || 0,
                            sortOrder: i,
                            brandId: r.brandId || null,
                            planMetric: r.planMetric || null,
                            thresholdFrom: r.thresholdFrom === "" ? null : Number(r.thresholdFrom),
                            thresholdTo: r.thresholdTo === "" ? null : Number(r.thresholdTo),
                            overdueTolerance:
                              r.overdueTolerance === "" ? null : Number(r.overdueTolerance),
                          })),
                        },
                        "Схему збережено"
                      )
                    }
                    className="shrink-0 cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3.5 py-2 text-[13px] font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Зберегти
                  </button>
                }
              />

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <input
                  value={meta.name}
                  onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                  className={`${inputClass} max-w-xs`}
                  placeholder="Назва схеми"
                />
                <label className="flex cursor-pointer items-center gap-2 text-sm text-g600">
                  <input
                    type="checkbox"
                    checked={meta.isActive}
                    onChange={(e) => setMeta({ ...meta, isActive: e.target.checked })}
                    className="cursor-pointer"
                  />
                  Активна
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-g600">
                  <input
                    type="checkbox"
                    checked={meta.isDefault}
                    onChange={(e) => setMeta({ ...meta, isDefault: e.target.checked })}
                    className="cursor-pointer"
                  />
                  Типова
                  <span className="text-xs text-g400">(для торгових без призначення)</span>
                </label>
              </div>

              {rules.length === 0 && (
                <p className="mb-3 text-xs text-g500">
                  Правил немає — заробіток за цією схемою буде нульовий. Додайте хоча б одне.
                </p>
              )}

              <div className="space-y-3">
                {rules.map((rule, i) => {
                  const fields = RULE_FIELDS[rule.type];
                  const update = (patch: Partial<RuleForm>) =>
                    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

                  return (
                    <div key={i} className="rounded-[var(--radius-card)] border border-g200 p-3">
                      <div className="flex items-start gap-2">
                        <select
                          value={rule.type}
                          onChange={(e) => update({ type: e.target.value as MotivationRuleType })}
                          className={`${inputClass} max-w-xs`}
                        >
                          {RULE_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {RULE_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setRules(rules.filter((_, j) => j !== i))}
                          aria-label="Видалити правило"
                          className="ml-auto shrink-0 cursor-pointer rounded-[var(--radius-btn)] px-2 py-1.5 text-sm text-g400 transition-colors hover:bg-g100 hover:text-bk"
                        >
                          ✕
                        </button>
                      </div>

                      <p className="mt-1.5 text-xs text-g500">{RULE_TYPE_HINTS[rule.type]}</p>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <label className="block">
                          <span className="mb-1 block text-xs text-g500">{fields.value}</span>
                          <input
                            type="number"
                            step="0.01"
                            value={rule.value}
                            onChange={(e) => update({ value: e.target.value })}
                            className={inputClass}
                          />
                        </label>

                        {fields.brand && (
                          <label className="block">
                            <span className="mb-1 block text-xs text-g500">Бренд</span>
                            <select
                              value={rule.brandId}
                              onChange={(e) => update({ brandId: e.target.value })}
                              className={inputClass}
                            >
                              <option value="">Усі бренди</option>
                              {data.brands.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        {fields.plan && (
                          <label className="block">
                            <span className="mb-1 block text-xs text-g500">Метрика плану</span>
                            <select
                              value={rule.planMetric}
                              onChange={(e) => update({ planMetric: e.target.value })}
                              className={inputClass}
                            >
                              <option value="">— не обрано —</option>
                              {SUPPORTED_PLAN_METRICS.map((m) => (
                                <option key={m} value={m}>
                                  {PLAN_METRIC_LABELS[m]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        {fields.thresholds && (
                          <>
                            <label className="block">
                              <span className="mb-1 block text-xs text-g500">Виконання від, %</span>
                              <input
                                type="number"
                                value={rule.thresholdFrom}
                                onChange={(e) => update({ thresholdFrom: e.target.value })}
                                placeholder="100"
                                className={inputClass}
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-xs text-g500">до, % (не обов&apos;язково)</span>
                              <input
                                type="number"
                                value={rule.thresholdTo}
                                onChange={(e) => update({ thresholdTo: e.target.value })}
                                className={inputClass}
                              />
                            </label>
                          </>
                        )}

                        {fields.tolerance && (
                          <label className="block">
                            <span className="mb-1 block text-xs text-g500">Допуск простроченої, %</span>
                            <input
                              type="number"
                              value={rule.overdueTolerance}
                              onChange={(e) => update({ overdueTolerance: e.target.value })}
                              placeholder="10"
                              className={inputClass}
                            />
                          </label>
                        )}
                      </div>

                      {fields.plan && !rule.planMetric && (
                        <p className="mt-2 text-xs" style={{ color: "var(--color-g500)" }}>
                          Без метрики плану правило не спрацює: рушію нема з чим звіряти виконання.
                        </p>
                      )}
                      {rule.brandId && (
                        <p className="mt-2 text-xs text-g500">
                          Діє лише на «{brandName(rule.brandId)}».
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setRules([...rules, emptyRule()])}
                className="mt-3 cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-3 py-2 text-sm font-medium text-g600 transition-colors hover:bg-g100 hover:text-bk"
              >
                + Додати правило
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Видалити схему «${current.name}»?`)) return;
                  send(`/api/admin/motivation/schemes/${current.id}`, "DELETE", undefined, "Схему видалено").then(
                    (ok) => ok && setSelected(null)
                  );
                }}
                className="ml-2 mt-3 cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-3 py-2 text-sm text-g500 transition-colors hover:bg-g100"
              >
                Видалити схему
              </button>
            </>
          )}
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Призначення"
            hint="Історія зберігається: минулі місяці рахуються за схемою, яка діяла тоді."
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Торговий</th>
                <th className="px-4 py-2.5">Схема</th>
                <th className="px-4 py-2.5">Діє з</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {data.reps.map((rep) => {
                const draft = assignDraft[rep.id];
                const schemeId = draft?.schemeId ?? rep.currentAssignment?.schemeId ?? "";
                const validFrom = draft?.validFrom ?? new Date().toISOString().slice(0, 10);
                const changed = !!draft;

                return (
                  <tr key={rep.id} className="hover:bg-g50">
                    <td className="px-4 py-3 font-medium text-bk">{rep.name}</td>
                    <td className="px-4 py-3">
                      <select
                        value={schemeId}
                        onChange={(e) =>
                          setAssignDraft({
                            ...assignDraft,
                            [rep.id]: { schemeId: e.target.value, validFrom },
                          })
                        }
                        className={`${inputClass} max-w-xs`}
                      >
                        <option value="">— без схеми —</option>
                        {schemes
                          .filter((s) => s.isActive)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="date"
                        value={validFrom}
                        onChange={(e) =>
                          setAssignDraft({
                            ...assignDraft,
                            [rep.id]: { schemeId, validFrom: e.target.value },
                          })
                        }
                        className={`${inputClass} max-w-[160px]`}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={busy || !changed}
                        onClick={async () => {
                          await send(
                            "/api/admin/motivation/assignments",
                            "PUT",
                            { repId: rep.id, schemeId: schemeId || null, validFrom },
                            `Схему для «${rep.name}» оновлено`
                          );
                          setAssignDraft((d) => {
                            const next = { ...d };
                            delete next[rep.id];
                            return next;
                          });
                        }}
                        className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-3 py-1.5 text-xs font-medium text-g600 transition-colors hover:bg-g100 hover:text-bk disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Зберегти
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
