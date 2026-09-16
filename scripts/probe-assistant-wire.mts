/**
 * Проба дроту помічника без бази: llm.ts на обох провайдерах, два раунди з
 * інструментом, розбір відмов і запасна модель.
 *
 * READ ONLY: жодного запиту до Postgres і жодного запису. Інструмент
 * вигаданий, його «результат» — сталий JSON у цьому файлі.
 *
 *   npx tsx --env-file=.env scripts/probe-assistant-wire.mts [gemini|deepseek|both|<назва моделі>]
 *
 * Назва моделі замість слова — щоб перевірити іншу версію Gemini, коли в
 * основної вичерпано денну квоту (безкоштовний тариф рахує її на модель).
 */

import { streamChat, LlmError, stripSignature } from "../src/lib/assistant/llm";
import { modelForFlavor, providerFor } from "../src/lib/assistant/config";
import type { ChatMessage, ToolSchema } from "../src/lib/assistant/types";

const which = process.argv[2] ?? "both";
const keys = { deepseek: process.env.DEEPSEEK_API_KEY ?? "", gemini: process.env.GEMINI_API_KEY ?? "" };

const TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "stock_health",
      description: "Стан складу бренду: дефіцит, що замовити, на яку суму.",
      parameters: { type: "object", properties: { brand: { type: "string", description: "Назва бренду" } }, required: ["brand"] },
    },
  },
];

async function twoRounds(model: string) {
  const flavor = providerFor(model).flavor;
  console.log(`\n══ ${model}`);
  const messages: ChatMessage[] = [
    { role: "system", content: "Ти помічник керівника фірми Budvik. Відповідай українською, коротко. Дані бери лише з інструментів." },
    { role: "user", content: "Що замовити по бренду СИЛА?" },
  ];
  const t0 = Date.now();
  try {
    const r1 = await streamChat({ model, apiKey: keys[flavor], messages, tools: TOOLS, toolChoice: "auto", maxTokens: 6000, thinking: "disabled", timeoutMs: 40_000 });
    console.log(`раунд 1 · ${((Date.now() - t0) / 1000).toFixed(1)} с · finish=${r1.finishReason} · викликів ${r1.toolCalls.length} · підпис ${r1.toolCalls[0]?.extra_content ? "є" : "немає"} · usage ${JSON.stringify(r1.usage)}`);
    if (r1.toolCalls.length === 0) return console.log(`текст: ${r1.content.slice(0, 200)}`);
    messages.push({ role: "assistant", content: r1.content || null, tool_calls: r1.toolCalls });
    for (const c of r1.toolCalls) {
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ бренд: "СИЛА", до_замовлення: 551, нуль_на_складі: 298, сума_закупівлі: "1 527 788 ₴" }) });
    }
    const t1 = Date.now();
    const r2 = await streamChat({ model, apiKey: keys[flavor], messages, tools: TOOLS, toolChoice: "none", maxTokens: 6000, thinking: "disabled", timeoutMs: 40_000 });
    console.log(`раунд 2 · ${((Date.now() - t1) / 1000).toFixed(1)} с · finish=${r2.finishReason} · usage ${JSON.stringify(r2.usage)}`);
    console.log(`текст: ${r2.content.slice(0, 300).replace(/\n/g, " ⏎ ")}`);
    console.log(`у базу пішов би виклик без підпису: ${JSON.stringify(r1.toolCalls.map(stripSignature)).length} симв. замість ${JSON.stringify(r1.toolCalls).length}`);
  } catch (e) {
    if (e instanceof LlmError) {
      console.log(`LlmError · status ${e.status} · upstream ${e.upstream} · retryable ${e.retryable} · quota ${e.quota} · «${e.message}» · ${((Date.now() - t0) / 1000).toFixed(1)} с`);
    } else throw e;
  }
}

if (/^(gemini|deepseek)-/.test(which)) await twoRounds(which);
else {
  if (which !== "deepseek") await twoRounds(modelForFlavor("gemini"));
  if (which !== "gemini") await twoRounds(modelForFlavor("deepseek"));
}
console.log("\nNothing was written to the database. Nothing was written to 1C.");
