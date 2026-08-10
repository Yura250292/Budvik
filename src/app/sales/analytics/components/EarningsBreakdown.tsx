"use client";

import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { money } from "@/components/ui/Stat";
import { STATUS } from "@/lib/analytics/colors";
import type { EarningLine, PlanResponse } from "./useSalesAnalytics";

/**
 * Заробіток, який не належить жодній фірмі, і утримання.
 *
 * Утримання за прострочку рахується від суми ВЖЕ НАРАХОВАНОГО, а не від
 * бренду (див. lib/motivation/brand-earnings.ts). Тому воно показане
 * один раз, окремо, і пояснення стоїть просто під сумою — саме тут у
 * торгового виникає питання «чому мені зняли», а не в підказці внизу
 * екрана.
 */

function Line({ line }: { line: EarningLine }) {
  const negative = line.amount < 0;
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <div className="min-w-0">
        <span className="block text-sm text-g600">{line.label}</span>
        <span className="block text-xs text-g500">{line.explanation}</span>
      </div>
      <span
        className="shrink-0 text-sm font-semibold tabular-nums"
        style={{ color: negative ? STATUS.bad.fg : "var(--color-bk)" }}
      >
        {negative ? "−" : ""}
        {money(Math.abs(line.amount))}
      </span>
    </div>
  );
}

export function EarningsBreakdown({
  earnings,
  reconciles,
}: {
  earnings: PlanResponse["earnings"];
  reconciles: boolean;
}) {
  if (!earnings) {
    return (
      <Card className="mt-3">
        <CardHeader title="Заробіток" />
        <EmptyState
          title="Схему мотивації не призначено"
          hint="Поки схеми немає, заробіток не рахується. Призначає її керівник — після цього тут з'явиться розрахунок по кожному правилу."
        />
      </Card>
    );
  }

  const eaten = earnings.total === 0 && earnings.gross > 0;

  return (
    <Card className="mt-3">
      <CardHeader
        title="Заробіток за період"
        hint={`Схема «${earnings.schemeName}». Рахується зі зібраних коштів, а не з обороту.`}
      />

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums tracking-tight text-bk">
          {money(earnings.total)}
        </span>
        <span className="text-sm text-g500">₴</span>
      </div>

      {earnings.byBrand > 0 && (
        <p className="mt-1 text-xs text-g500">
          З них{" "}
          <span className="font-semibold tabular-nums text-g600">{money(earnings.byBrand)} ₴</span> —
          за правилами конкретних фірм (кільця вище).
        </p>
      )}

      {earnings.generalLines.length > 0 && (
        <div className="mt-3 border-t border-g100 pt-1">
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-g400">
            Правила без прив&apos;язки до фірми
          </p>
          <div className="divide-y divide-g100">
            {earnings.generalLines.map((l) => (
              <Line key={l.ruleId} line={l} />
            ))}
          </div>
        </div>
      )}

      {earnings.penaltyLines.length > 0 && (
        <div className="mt-3 border-t border-g100 pt-1">
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-g400">Утримання</p>
          <div className="divide-y divide-g100">
            {earnings.penaltyLines.map((l) => (
              <Line key={l.ruleId} line={l} />
            ))}
          </div>
          {/* Пояснення саме тут, а не в підказці внизу: питання «чому
              зняли» виникає рівно в цьому місці екрана. */}
          <p className="mt-2 text-xs leading-relaxed text-g500">
            Утримання рахується від усього нарахованого за період, а не від якоїсь однієї фірми —
            тому воно не входить у зелені суми біля кілець. Заберіть прострочену дебіторку, і
            утримання зникне.
          </p>
        </div>
      )}

      <dl className="mt-3 border-t border-g200 pt-2 text-sm">
        <div className="flex items-baseline justify-between gap-3 py-1">
          <dt className="text-g600">Нараховано</dt>
          <dd className="font-medium tabular-nums text-bk">{money(earnings.gross)} ₴</dd>
        </div>
        {earnings.penalties > 0 && (
          <div className="flex items-baseline justify-between gap-3 py-1">
            <dt className="text-g600">Утримано</dt>
            <dd className="font-medium tabular-nums" style={{ color: STATUS.bad.fg }}>
              −{money(earnings.penalties)} ₴
            </dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 border-t border-g100 py-1 pt-2">
          <dt className="font-semibold text-bk">До виплати</dt>
          <dd className="font-semibold tabular-nums text-bk">{money(earnings.total)} ₴</dd>
        </div>
      </dl>

      {eaten && (
        <p className="mt-2 rounded-[var(--radius-badge)] px-2.5 py-2 text-xs leading-relaxed"
           style={{ backgroundColor: STATUS.bad.bg, color: STATUS.bad.fg }}>
          Утримання перекрили нарахування повністю. Підсумок не йде в мінус — заборгованості перед
          компанією у вас не виникає.
        </p>
      )}

      {!reconciles && (
        <p className="mt-2 rounded-[var(--radius-badge)] px-2.5 py-2 text-xs leading-relaxed"
           style={{ backgroundColor: STATUS.warn.bg, color: STATUS.warn.fg }}>
          Сума по фірмах не сходиться з підсумком заробітку — у схемі є правило, яке цей екран
          розкладає інакше, ніж рахує розрахунок. Підсумок правильний; покажіть це керівнику.
        </p>
      )}
    </Card>
  );
}
