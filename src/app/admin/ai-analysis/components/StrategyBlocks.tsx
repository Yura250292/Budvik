"use client";

/**
 * Секція «Стратегія»: підсумок для власника, пріоритети і фокус по людях.
 *
 * Це єдина секція, що не читає базу заново — вона зводить уже перевірені
 * висновки трьох інших. Тому й порядок читання такий: спершу абзац про стан
 * фірми, далі пріоритети, і в кінці — що робити з кожною людиною.
 */

import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { money, num } from "@/components/ui/Stat";
import { formatValue } from "@/app/admin/sales-analytics/components/InsightCard";
import { DrillLink } from "./DrillLink";
import { driverHref, repHref, turnoverHref } from "./links";
import type { InsightEvidence } from "@/lib/ai/insights";

type Payload = {
  summary: string;
  priorities: Array<{
    title: string;
    detail: string;
    area: "reps" | "products" | "logistics" | "finance";
    evidence?: InsightEvidence[];
  }>;
  people: Array<{ personId: string; role: "rep" | "driver"; focus: string }>;
};

type Person = { personId: string; імя: string };

type Facts = {
  компанія?: {
    оборот?: number | null;
    вал?: number | null;
    рентабельність_відсотків?: number | null;
    склад_без_руху_на_суму?: number | null;
    склад_частка_мертвих_грошей_відсотків?: number | null;
    логістика_зарплата?: number | null;
  };
  люди?: { торгові?: Person[]; водії?: Person[] };
};

const AREA_META: Record<string, { label: string; status: "bad" | "warn" | "info" | "good" }> = {
  reps: { label: "Торгові", status: "info" },
  products: { label: "Товари", status: "warn" },
  logistics: { label: "Логістика", status: "good" },
  finance: { label: "Гроші", status: "bad" },
};

export function StrategyBlocks({
  payload,
  facts,
  period,
}: {
  payload: unknown;
  facts: unknown;
  period: { from: string; to: string };
}) {
  const p = (payload ?? {}) as Payload;
  const f = (facts ?? {}) as Facts;
  const c = f.компанія;

  const names = new Map<string, { name: string; role: string }>();
  for (const r of f.люди?.торгові ?? []) names.set(r.personId, { name: r.імя, role: "торговий" });
  for (const d of f.люди?.водії ?? []) names.set(d.personId, { name: d.імя, role: "водій" });

  const reps = p.people?.filter((x) => x.role === "rep") ?? [];
  const drivers = p.people?.filter((x) => x.role === "driver") ?? [];

  return (
    <div className="flex flex-col gap-3">
      {c && (
        <Card>
          <CardHeader title="Фірма за період" />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Оборот" value={`${money(c.оборот ?? 0)} ₴`} />
            <Metric
              label="Вал"
              value={`${money(c.вал ?? 0)} ₴`}
              hint={
                c.рентабельність_відсотків != null
                  ? `рентабельність ${num(c.рентабельність_відсотків, 1)}%`
                  : undefined
              }
            />
            <Metric
              label="Мертвий склад"
              value={`${money(c.склад_без_руху_на_суму ?? 0)} ₴`}
              hint={
                c.склад_частка_мертвих_грошей_відсотків != null
                  ? `${num(c.склад_частка_мертвих_грошей_відсотків, 1)}% запасу`
                  : undefined
              }
              href={turnoverHref()}
              alarm
            />
            <Metric label="Зарплата водіїв" value={`${money(c.логістика_зарплата ?? 0)} ₴`} />
          </dl>
        </Card>
      )}

      {p.summary && (
        <Card>
          <CardHeader title="Підсумок" />
          <p className="whitespace-pre-line text-sm leading-relaxed text-g700">{p.summary}</p>
        </Card>
      )}

      <Card>
        <CardHeader title="Пріоритети" hint="Найважливіше — першим" />
        {p.priorities?.length ? (
          <ol className="flex flex-col gap-3">
            {p.priorities.map((item, i) => {
              const meta = AREA_META[item.area] ?? AREA_META.reps;
              return (
                <li
                  key={i}
                  className="rounded-[var(--radius-card)] border border-g200 p-3.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-bk">
                      {i + 1}. {item.title}
                    </span>
                    <Badge status={meta.status}>{meta.label}</Badge>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-g700">{item.detail}</p>
                  {item.evidence?.length ? (
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-g500">
                      {item.evidence.map((e, j) => (
                        <li key={j}>
                          {e.label}:{" "}
                          <span className="font-medium text-g700">
                            {formatValue(e.value, e.unit)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState title="Модель не виділила пріоритетів" />
        )}
      </Card>

      {(reps.length > 0 || drivers.length > 0) && (
        <Card>
          <CardHeader
            title="Фокус по людях"
            hint="Над чим працювати з кожним найближчий місяць"
          />

          <div className="flex flex-col gap-4">
            {[
              { title: "Торгові", list: reps },
              { title: "Водії", list: drivers },
            ]
              .filter((g) => g.list.length > 0)
              .map((group) => (
                <section key={group.title}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-g500">
                    {group.title}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {group.list.map((person) => {
                      const who = names.get(person.personId);
                      if (!who) return null;
                      const href =
                        person.role === "driver"
                          ? driverHref(person.personId, period.from, period.to)
                          : repHref(person.personId, period.from, period.to);
                      return (
                        <li
                          key={person.personId}
                          className="rounded-[var(--radius-card)] border border-g200 p-3"
                        >
                          <DrillLink href={href} className="text-sm font-medium text-bk">
                            {who.name}
                          </DrillLink>
                          <p className="mt-1 text-sm leading-relaxed text-g700">{person.focus}</p>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  href,
  alarm,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Куди «провалитись» за цією цифрою */
  href?: string;
  alarm?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-g500">{label}</dt>
      <dd className={`text-base font-semibold ${alarm ? "text-red-700" : "text-bk"}`}>
        {href ? (
          <DrillLink href={href} className={alarm ? "text-red-700" : "text-bk"}>
            {value}
          </DrillLink>
        ) : (
          value
        )}
      </dd>
      {hint && <p className="text-xs text-g400">{hint}</p>}
    </div>
  );
}
