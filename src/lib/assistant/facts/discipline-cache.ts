/**
 * Вердикти платників — порахувати раз на хід, а не на кожен інструмент.
 *
 * buildDisciplineReport() читає всю дебіторку й усі оплати; це найдорожчий
 * запит, який тут узагалі трапляється. Дебіторка й профіль клієнта питають
 * його обидва, а в одній відповіді помічника вони часто стоять поруч.
 *
 * Десять хвилин — навмисно менше за нічний обмін: якщо офіс провів ПКО
 * вранці, до обіду вердикт уже оновиться.
 */

import { buildDisciplineReport, type PayerVerdict, VERDICT_LABELS } from "@/lib/analytics/discipline";

type Cached = {
  at: number;
  verdicts: Map<string, PayerVerdict>;
  limits: Map<string, number>;
};

let cache: Cached | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function payerVerdicts(): Promise<Cached> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;

  const report = await buildDisciplineReport();
  cache = {
    at: Date.now(),
    verdicts: new Map(report.rows.map((r) => [r.counterpartyId, r.verdict])),
    limits: new Map(report.rows.map((r) => [r.counterpartyId, r.suggestedLimit])),
  };
  return cache;
}

/** Український підпис вердикту — те, що читає модель і торговий. */
export function verdictLabel(v: PayerVerdict | undefined | null): string | null {
  return v ? VERDICT_LABELS[v] : null;
}
