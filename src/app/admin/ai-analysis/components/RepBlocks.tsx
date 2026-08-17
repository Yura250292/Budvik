"use client";

/**
 * Секція «Торгові»: блок на кожну людину з чеклістом дій по клієнтах.
 *
 * Головне правило рендера: імена клієнтів, суми боргів і дати беруться з
 * ФАКТІВ за ідентифікатором, а не з тексту моделі. Модель вирішує лише
 * порядок і коментар — вигадати клієнта або суму вона не може навіть у разі
 * збою, бо рядок без збігу в фактах просто не малюється.
 */

import { useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { attainmentStatus } from "@/lib/analytics/colors";
import { money, num } from "@/components/ui/Stat";
import { InsightSections } from "@/app/admin/sales-analytics/components/InsightCard";
import type { Insight } from "@/lib/ai/insights";

type Action = {
  clientId: string;
  kind: string;
  priority: number;
  comment: string;
};

type RepBlock = {
  repId: string;
  strengths: string[];
  weaknesses: string[];
  insights: Insight[];
  actions: Action[];
};

type Payload = { team: Insight[]; reps: RepBlock[] };

type Candidate = {
  clientId: string;
  клієнт: string;
  тип: string;
  тип_підпис: string;
  чому: string;
  оборот_за_період: number;
  днів_без_замовлень: number;
  звичний_ритм_днів: number;
  борг: number;
  прострочено: number;
  позицій: number;
  брендів: number;
};

type RepFacts = {
  repId: string;
  торговий: string;
  за_період: {
    оборот: number | null;
    документів: number;
    клієнтів: number;
    рентабельність_відсотків: number | null;
    покриття_собівартістю_відсотків: number | null;
  };
  дебіторка_станом_на_зараз: {
    усього: number | null;
    прострочено: number | null;
    частка_простроченого_відсотків: number | null;
  } | null;
  план_на_місяць: { виконання_відсотків: number | null } | string;
  портфель: { активних: number; відстають: number; втрачених: number } | null;
  кандидати_дій: Candidate[];
};

type Facts = {
  підсумок_компанії?: { медіанна_рентабельність_відсотків?: number | null };
  торгові?: RepFacts[];
};

/** Порядок груп у чеклісті: від «гроші вже наші» до «закріпити хороше». */
const KIND_ORDER = [
  "COLLECT_DEBT",
  "CHURN_RISK",
  "REACTIVATE",
  "DEVELOP",
  "OFFER_BONUS",
] as const;

const KIND_META: Record<string, { label: string; tone: string }> = {
  COLLECT_DEBT: { label: "Забрати борг", tone: "bg-red-50 text-red-700 border-red-200" },
  CHURN_RISK: { label: "Ризик втрати", tone: "bg-orange-50 text-orange-700 border-orange-200" },
  REACTIVATE: { label: "Відновити", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  DEVELOP: { label: "Розпрацювати", tone: "bg-blue-50 text-blue-700 border-blue-200" },
  OFFER_BONUS: { label: "Запропонувати бонус", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

const PRIORITY_LABEL: Record<number, string> = {
  1: "сьогодні",
  2: "цього тижня",
  3: "коли буде час",
};

export function RepBlocks({ payload, facts }: { payload: unknown; facts: unknown }) {
  const p = (payload ?? {}) as Payload;
  const f = (facts ?? {}) as Facts;
  const byId = new Map((f.торгові ?? []).map((r) => [r.repId, r]));
  const [open, setOpen] = useState<string | null>(p.reps?.[0]?.repId ?? null);

  if (!p.reps?.length) {
    return (
      <Card>
        <EmptyState title="Немає блоків по торгових" hint="Спробуйте згенерувати ще раз." />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {p.team?.length > 0 && (
        <Card>
          <CardHeader title="Команда загалом" hint="Висновки, що стосуються всіх торгових" />
          <InsightSections insights={p.team} />
        </Card>
      )}

      <Card padded={false}>
        <div className="border-b border-g200 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-bk">По кожному торговому</h2>
          <p className="mt-0.5 text-xs text-g500">
            Натисніть на рядок, щоб розгорнути сильні й слабкі сторони та список дзвінків.
          </p>
        </div>

        <ul className="divide-y divide-g200">
          {p.reps.map((block) => {
            const rf = byId.get(block.repId);
            if (!rf) return null;
            const isOpen = open === block.repId;
            const plan =
              typeof rf.план_на_місяць === "object" ? rf.план_на_місяць.виконання_відсотків : null;

            return (
              <li key={block.repId}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : block.repId)}
                  aria-expanded={isOpen}
                  className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-g50 sm:px-5"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-bk">{rf.торговий}</span>
                    <span className="text-xs text-g500">
                      {money(rf.за_період.оборот ?? 0)} ₴ · {rf.за_період.документів} реалізацій ·{" "}
                      {rf.за_період.клієнтів} клієнтів
                    </span>
                  </span>

                  <span className="flex flex-wrap items-center gap-1.5">
                    {rf.за_період.рентабельність_відсотків != null && (
                      <Badge status="neutral">
                        маржа {num(rf.за_період.рентабельність_відсотків, 1)}%
                      </Badge>
                    )}
                    {plan != null && (
                      <Badge status={attainmentStatus(plan)}>план {num(plan, 0)}%</Badge>
                    )}
                    {(rf.дебіторка_станом_на_зараз?.прострочено ?? 0) > 0 && (
                      <Badge status="bad">
                        прострочено {money(rf.дебіторка_станом_на_зараз!.прострочено!)} ₴
                      </Badge>
                    )}
                    <span className="text-xs text-g400">{isOpen ? "згорнути" : "розгорнути"}</span>
                  </span>
                </button>

                {isOpen && (
                  <div className="flex flex-col gap-4 border-t border-g100 bg-g50 px-4 py-4 sm:px-5">
                    <RepStrengths block={block} facts={rf} />
                    {block.insights?.length > 0 && (
                      <section>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-g500">
                          На що звернути увагу
                        </h3>
                        <InsightSections insights={block.insights} />
                      </section>
                    )}
                    <RepActions block={block} facts={rf} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function RepStrengths({ block, facts }: { block: RepBlock; facts: RepFacts }) {
  const coverage = facts.за_період.покриття_собівартістю_відсотків;

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Сильні сторони
        </h3>
        {block.strengths?.length ? (
          <ul className="flex flex-col gap-1">
            {block.strengths.map((s, i) => (
              <li key={i} className="text-sm text-g700">
                • {s}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-g400">—</p>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-orange-700">
          Слабкі сторони
        </h3>
        {block.weaknesses?.length ? (
          <ul className="flex flex-col gap-1">
            {block.weaknesses.map((s, i) => (
              <li key={i} className="text-sm text-g700">
                • {s}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-g400">—</p>
        )}
      </div>

      {coverage != null && coverage < 90 && (
        <p className="text-xs text-g500 sm:col-span-2">
          Рентабельність порахована лише по {num(coverage, 1)}% обороту — решта документів прийшла
          з 1С без собівартості.
        </p>
      )}
    </section>
  );
}

function RepActions({ block, facts }: { block: RepBlock; facts: RepFacts }) {
  const byClient = new Map(facts.кандидати_дій.map((c) => [c.clientId, c]));

  // Беремо перелік дій моделі (вона їх упорядкувала), але показуємо лише ті,
  // чий клієнт є у фактах. Порядок усередині групи — за пріоритетом моделі.
  const rows = (block.actions ?? [])
    .map((a) => ({ action: a, client: byClient.get(a.clientId) }))
    .filter((r): r is { action: Action; client: Candidate } => !!r.client);

  if (rows.length === 0) {
    return (
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-g500">
          Кому дзвонити
        </h3>
        <p className="text-sm text-g400">Модель не виділила клієнтів для дій.</p>
      </section>
    );
  }

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    meta: KIND_META[kind],
    items: rows
      .filter((r) => r.action.kind === kind)
      .sort((a, b) => a.action.priority - b.action.priority),
  })).filter((g) => g.items.length > 0);

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-g500">
        Кому дзвонити ({rows.length})
      </h3>

      <div className="flex flex-col gap-3">
        {grouped.map((group) => (
          <div key={group.kind}>
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${group.meta.tone}`}
            >
              {group.meta.label} · {group.items.length}
            </span>

            <ul className="mt-1.5 flex flex-col gap-1.5">
              {group.items.map(({ action, client }) => (
                <li
                  key={action.clientId}
                  className="rounded-[var(--radius-card)] border border-g200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-bk">{client.клієнт}</span>
                    <span className="text-xs text-g400">
                      {PRIORITY_LABEL[action.priority] ?? "коли буде час"}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-g700">{action.comment}</p>

                  <p className="mt-1 text-xs text-g500">
                    {client.чому}
                  </p>

                  <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-g500">
                    <span>
                      <dt className="inline">Оборот: </dt>
                      <dd className="inline font-medium text-g700">
                        {money(client.оборот_за_період)} ₴
                      </dd>
                    </span>
                    {client.борг > 0 && (
                      <span>
                        <dt className="inline">Борг: </dt>
                        <dd className="inline font-medium text-g700">{money(client.борг)} ₴</dd>
                      </span>
                    )}
                    {client.прострочено > 0 && (
                      <span>
                        <dt className="inline">Прострочено: </dt>
                        <dd className="inline font-medium text-red-700">
                          {money(client.прострочено)} ₴
                        </dd>
                      </span>
                    )}
                    <span>
                      <dt className="inline">Мовчить: </dt>
                      <dd className="inline font-medium text-g700">
                        {num(client.днів_без_замовлень)} дн.
                      </dd>
                    </span>
                    <span>
                      <dt className="inline">Звичний ритм: </dt>
                      <dd className="inline font-medium text-g700">
                        раз на {num(client.звичний_ритм_днів)} дн.
                      </dd>
                    </span>
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
