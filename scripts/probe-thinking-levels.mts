/**
 * Проба рівнів думання: що з reasoning_effort приймають DeepSeek і Gemini і
 * скільки токенів роздуму дає кожен рівень.
 *
 * READ ONLY: жодного запиту до Postgres. До моделей — одне невелике питання
 * на рівень, частки цента.
 *
 * Від відповіді залежать рівні в src/lib/assistant/config.ts (LEVELS):
 *   - чи DeepSeek розрізняє reasoning_effort у режимі thinking.enabled, чи
 *     лише вмикає/вимикає думання;
 *   - які значення reasoning_effort бере Gemini 3.x через OpenAI-вхід
 *     (minimal / low / medium / high / none).
 *
 *   npx tsx --env-file=.env scripts/probe-thinking-levels.mts
 */

const QUESTION =
  "У серпні 31 день: оборот 4,2 млн грн, 610 накладних, 140 клієнтів. " +
  "За 11 днів вересня: оборот 1,3 млн грн, 205 накладних, 96 клієнтів. " +
  "Чи впав середній чек і чому — через менші замовлення чи через менше клієнтів? Коротко, 3 речення.";

type Probe = { label: string; url: string; key: string; body: Record<string, unknown> };

async function run(p: Probe) {
  const t0 = Date.now();
  const res = await fetch(p.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({ messages: [{ role: "user", content: QUESTION }], max_tokens: 8000, ...p.body }),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) {
    console.log(`${p.label.padEnd(34)} ${res.status}  ${text.replace(/\s+/g, " ").slice(0, 160)}`);
    return;
  }
  const j = JSON.parse(text);
  const u = j.usage ?? {};
  const reasoning =
    u.completion_tokens_details?.reasoning_tokens ??
    Math.max(0, (u.total_tokens ?? 0) - (u.prompt_tokens ?? 0) - (u.completion_tokens ?? 0));
  const answer = String(j.choices?.[0]?.message?.content ?? "").replace(/\s+/g, " ");
  console.log(
    `${p.label.padEnd(34)} 200  ${String(ms).padStart(6)} мс  вихід ${String(u.completion_tokens).padStart(5)}  роздум ${String(reasoning).padStart(5)}  ${answer.slice(0, 90)}`
  );
}

const DS = { url: "https://api.deepseek.com/chat/completions", key: process.env.DEEPSEEK_API_KEY ?? "" };
const GM = {
  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  key: process.env.ASSISTANT_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "",
};
const GEMINI = process.argv[2] ?? "gemini-3.6-flash";

const probes: Probe[] = [
  { label: "deepseek disabled", ...DS, body: { model: "deepseek-flash", thinking: { type: "disabled" } } },
  { label: "deepseek enabled", ...DS, body: { model: "deepseek-flash", thinking: { type: "enabled" } } },
  { label: "deepseek enabled + effort low", ...DS, body: { model: "deepseek-flash", thinking: { type: "enabled" }, reasoning_effort: "low" } },
  { label: "deepseek enabled + effort high", ...DS, body: { model: "deepseek-flash", thinking: { type: "enabled" }, reasoning_effort: "high" } },
  { label: "deepseek enabled + effort max", ...DS, body: { model: "deepseek-flash", thinking: { type: "enabled" }, reasoning_effort: "max" } },
  { label: "deepseek enabled + effort banana", ...DS, body: { model: "deepseek-flash", thinking: { type: "enabled" }, reasoning_effort: "banana" } },
  { label: `${GEMINI} none`, ...GM, body: { model: GEMINI, reasoning_effort: "none" } },
  { label: `${GEMINI} minimal`, ...GM, body: { model: GEMINI, reasoning_effort: "minimal" } },
  { label: `${GEMINI} low`, ...GM, body: { model: GEMINI, reasoning_effort: "low" } },
  { label: `${GEMINI} medium`, ...GM, body: { model: GEMINI, reasoning_effort: "medium" } },
  { label: `${GEMINI} high`, ...GM, body: { model: GEMINI, reasoning_effort: "high" } },
];

for (const p of probes) await run(p);
console.log("\nNothing was written anywhere: model calls only.");
