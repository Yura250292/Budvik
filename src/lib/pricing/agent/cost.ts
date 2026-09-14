/**
 * Витрати агента цін — для журналу воркера й адмінки.
 *
 * Ціни на 14.09.2026: DeepSeek Flash — до $0,30 за мільйон вхідних і до $1,20
 * за мільйон вихідних токенів (верхня межа пікових годин), пошук Serper —
 * близько $0,001 за запит після безкоштовних 2500, Brave — $0,005.
 */
export const DEEPSEEK_USD = { input: 0.3 / 1_000_000, output: 1.2 / 1_000_000 };
export const SEARCH_USD_DEFAULT = 0.001;

export function agentCostUsd(u: {
  searches: number;
  inputTokens: number;
  outputTokens: number;
  usdPerQuery?: number;
}): number {
  const perQuery = u.usdPerQuery ?? SEARCH_USD_DEFAULT;
  const usd = u.searches * perQuery + u.inputTokens * DEEPSEEK_USD.input + u.outputTokens * DEEPSEEK_USD.output;
  return Math.round(usd * 1000) / 1000;
}
