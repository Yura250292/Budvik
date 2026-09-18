/**
 * Модель, яка щойно вичерпала квоту, — поза чергою на якийсь час.
 *
 * Навіщо. 16.09.2026 ключ Gemini проєкту виявився на безкоштовному тарифі:
 * 20 запитів на добу на модель. Хід керівника — це 2–4 запити, тож після
 * кількох ходів КОЖЕН наступний спершу отримував би 429 і лише потім ішов
 * до DeepSeek: зайва секунда й зайвий рядок у журналі на кожен раунд. Тут
 * модель, що відмовила квотою, пропускається одразу.
 *
 * Памʼять — у процесі, не в базі. Цього досить: екземпляр функції Vercel
 * живе хвилинами-годинами, а помилитися в бік «спробувати ще раз» дешево —
 * це один запит, що впаде за пів секунди. Спільний стан між екземплярами
 * коштував би запиту до бази на кожен хід.
 *
 * Скільки чекати. Денна квота Google відновлюється опівночі за Тихоокеанським
 * часом, але вгадувати його не треба: раз на годину одна проба. Хвилинна —
 * хвилина.
 */

const DAY_QUOTA_PAUSE_MS = 60 * 60_000;
const MINUTE_QUOTA_PAUSE_MS = 60_000;

const pausedUntil = new Map<string, number>();

/**
 * Ключ у межах моделі: «gemini-3.6-flash#0».
 *
 * Пауза ставиться саме на пару «модель + ключ», бо квота Google рахується
 * за проєктом КЛЮЧА: безкоштовний ключ може бути вичерпаний, а платний —
 * ні, і пропускати через це всю модель означало б платити там, де ще можна
 * не платити.
 */
export const keySlot = (model: string, index: number) => `${model}#${index}`;

export function markQuotaExhausted(model: string, quota: "day" | "minute") {
  pausedUntil.set(model, Date.now() + (quota === "day" ? DAY_QUOTA_PAUSE_MS : MINUTE_QUOTA_PAUSE_MS));
}

export function isPaused(model: string): boolean {
  const until = pausedUntil.get(model);
  if (until == null) return false;
  if (until <= Date.now()) {
    pausedUntil.delete(model);
    return false;
  }
  return true;
}
