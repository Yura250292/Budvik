/**
 * Проба DeepSeek: чи витримує `deepseek-flash` міркування разом з інструментами.
 *
 * READ ONLY щодо бази: жодного запиту до Postgres, жодного запису. До DeepSeek
 * ідуть навмисно крихітні запити (кілька токенів кожен) — проба коштує копійки.
 *
 * Навіщо. Помічник шле `thinking: {type:"disabled"}` і 33 схеми інструментів
 * одним запитом. Документація каже дві речі, які треба перевірити руками перед
 * тим, як міркування вмикати: (1) у режимі міркувань із `tools` API вимагає
 * повертати `reasoning_content` попередніх ходів назад у розмову; (2) частина
 * значень `tool_choice` у цьому режимі заборонена. Якщо перше — жорстка 400, то
 * вмикати міркування без зберігання `reasoning_content` не можна взагалі.
 *
 *   npx tsx --env-file=.env scripts/probe-deepseek-thinking.mts
 */

const URL_CHAT = "https://api.deepseek.com/chat/completions";
const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  console.error("Немає DEEPSEEK_API_KEY (запускати з --env-file=.env)");
  process.exit(1);
}

/** Один інструмент замість 33 — перевіряємо механіку, не вибір. */
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "stock_of",
      description: "Залишок товару на складі за назвою",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Назва товару" } },
        required: ["name"],
      },
    },
  },
];

type Msg = Record<string, unknown>;

type Out = {
  status: number;
  ms: number;
  content: string;
  reasoning: string;
  toolCalls: Array<{ index: number; id: string; name: string; args: string }>;
  finish: string;
  usage: Record<string, unknown> | null;
  error: string;
};

async function call(opts: {
  model: string;
  messages: Msg[];
  tools?: boolean;
  toolChoice?: string;
  thinking?: "enabled" | "disabled";
  effort?: string;
  temperature?: number;
  stream?: boolean;
  maxTokens?: number;
}): Promise<Out> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 300,
  };
  if (opts.tools) {
    body.tools = TOOLS;
    body.tool_choice = opts.toolChoice ?? "auto";
  }
  if (opts.thinking) body.thinking = { type: opts.thinking };
  if (opts.effort) body.reasoning_effort = opts.effort;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  const t0 = Date.now();
  const res = await fetch(URL_CHAT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const out: Out = {
    status: res.status,
    ms: 0,
    content: "",
    reasoning: "",
    toolCalls: [],
    finish: "",
    usage: null,
    error: "",
  };

  if (!res.ok || !res.body) {
    out.error = (await res.text().catch(() => "")).slice(0, 400);
    out.ms = Date.now() - t0;
    return out;
  }

  if (!opts.stream) {
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: Record<string, unknown> | null;
    };
    const m = data.choices?.[0]?.message ?? {};
    out.content = m.content ?? "";
    out.reasoning = m.reasoning_content ?? "";
    out.finish = data.choices?.[0]?.finish_reason ?? "";
    out.usage = data.usage ?? null;
    for (const [i, c] of (m.tool_calls ?? []).entries()) {
      out.toolCalls.push({
        index: i,
        id: c.id ?? "",
        name: c.function?.name ?? "",
        args: c.function?.arguments ?? "",
      });
    }
    out.ms = Date.now() - t0;
    return out;
  }

  // Розбір SSE — той самий, що в src/lib/assistant/deepseek.ts.
  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.replace(/\r\n/g, "\n").split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
          usage?: Record<string, unknown> | null;
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        if (chunk.usage) out.usage = chunk.usage;
        const ch = chunk.choices?.[0];
        if (!ch) continue;
        if (ch.finish_reason) out.finish = ch.finish_reason;
        if (ch.delta?.content) out.content += ch.delta.content;
        if (ch.delta?.reasoning_content) out.reasoning += ch.delta.reasoning_content;
        for (const frag of ch.delta?.tool_calls ?? []) {
          const slot = calls.get(frag.index) ?? { id: "", name: "", args: "" };
          if (frag.id) slot.id = frag.id;
          if (frag.function?.name) slot.name = frag.function.name;
          if (frag.function?.arguments) slot.args += frag.function.arguments;
          calls.set(frag.index, slot);
        }
      }
    }
  }
  for (const [index, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    out.toolCalls.push({ index, ...c });
  }
  out.ms = Date.now() - t0;
  return out;
}

function show(title: string, o: Out) {
  const head = o.status === 200 ? "OK " : "ПАД";
  console.log(`\n── ${title}`);
  console.log(
    `   ${head} ${o.status} · ${(o.ms / 1000).toFixed(1)} с · finish=${o.finish || "—"}` +
      ` · міркування ${o.reasoning.length} симв. · текст ${o.content.length} симв.`
  );
  if (o.usage) {
    const u = o.usage as {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_cache_hit_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
    const r = u.completion_tokens_details?.reasoning_tokens;
    console.log(
      `   токени: вхід ${u.prompt_tokens} (кеш ${u.prompt_cache_hit_tokens ?? "—"})` +
        ` · вихід ${u.completion_tokens}${r !== undefined ? ` (з них міркування ${r})` : ""}`
    );
  }
  if (o.toolCalls.length > 0) {
    console.log(
      `   інструменти: ${o.toolCalls.map((c) => `[${c.index}] ${c.name}(${c.args}) id=${c.id || "БЕЗ id"}`).join(", ")}`
    );
  }
  if (o.error) console.log(`   ПОМИЛКА: ${o.error}`);
  if (o.content) console.log(`   текст: ${o.content.slice(0, 160).replace(/\n/g, " ⏎ ")}`);
}

const SYS = "Ти помічник складу. Відповідай коротко українською.";
const ASK = "Скільки піни монтажної на складі?";

console.log("Проба DeepSeek · READ ONLY щодо бази · нічого не записано");
console.log("=".repeat(72));

/* 1. Канонічна назва взагалі приймається, міркування вимкнені, як у проді. */
const a = await call({
  model: "deepseek-flash",
  messages: [{ role: "system", content: SYS }, { role: "user", content: "Скажи слово «готово»." }],
  thinking: "disabled",
  temperature: 0.3,
  maxTokens: 20,
});
show("1. deepseek-flash · thinking disabled · temperature 0.3 · без інструментів", a);

/* 2. Те саме з інструментами й стрімом — точна копія запиту помічника. */
const b = await call({
  model: "deepseek-flash",
  messages: [{ role: "system", content: SYS }, { role: "user", content: ASK }],
  tools: true,
  thinking: "disabled",
  temperature: 0.3,
  stream: true,
});
show("2. deepseek-flash · thinking disabled · tools + stream (як у помічнику)", b);

/* 3. Міркування УВІМКНЕНІ разом з інструментами й стрімом. */
const c = await call({
  model: "deepseek-flash",
  messages: [{ role: "system", content: SYS }, { role: "user", content: ASK }],
  tools: true,
  thinking: "enabled",
  stream: true,
  maxTokens: 800,
});
show("3. deepseek-flash · thinking ENABLED · tools + stream", c);

/* 4. Другий раунд БЕЗ reasoning_content — головне питання проби. */
if (c.status === 200 && c.toolCalls.length > 0) {
  const call1 = c.toolCalls[0];
  const assistantMsg: Msg = {
    role: "assistant",
    content: c.content || null,
    tool_calls: [
      { id: call1.id || "call_0", type: "function", function: { name: call1.name, arguments: call1.args || "{}" } },
    ],
  };
  const toolMsg: Msg = {
    role: "tool",
    tool_call_id: call1.id || "call_0",
    content: JSON.stringify({ товар: "Піна монтажна 750мл", залишок: 184 }),
  };

  const d = await call({
    model: "deepseek-flash",
    messages: [{ role: "system", content: SYS }, { role: "user", content: ASK }, assistantMsg, toolMsg],
    tools: true,
    thinking: "enabled",
    stream: true,
    maxTokens: 800,
  });
  show("4. другий раунд · thinking ENABLED · assistant БЕЗ reasoning_content", d);

  const e = await call({
    model: "deepseek-flash",
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: ASK },
      { ...assistantMsg, reasoning_content: c.reasoning },
      toolMsg,
    ],
    tools: true,
    thinking: "enabled",
    stream: true,
    maxTokens: 800,
  });
  show("5. другий раунд · thinking ENABLED · assistant З reasoning_content", e);

  /* 6. Заборона інструментів у режимі міркувань. */
  const f = await call({
    model: "deepseek-flash",
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: ASK },
      { ...assistantMsg, reasoning_content: c.reasoning },
      toolMsg,
    ],
    tools: true,
    toolChoice: "none",
    thinking: "enabled",
    stream: true,
    maxTokens: 800,
  });
  show('6. thinking ENABLED · tool_choice: "none" (останній раунд помічника)', f);
} else {
  console.log("\n── 4–6 пропущено: у пробі 3 модель не замовила інструмент");
}

/* 7. Скільки коштує глибина міркувань. */
for (const effort of ["none", "low", "high"]) {
  const g = await call({
    model: "deepseek-flash",
    messages: [
      { role: "system", content: SYS },
      {
        role: "user",
        content:
          "У трьох торгових обороти 120, 95 і 240 тис. ₴, дебіторка 40, 80 і 35 тис. ₴. Кому з них не давати відстрочку і чому? Одне речення.",
      },
    ],
    effort,
    maxTokens: 900,
  });
  show(`7. reasoning_effort: "${effort}" · без інструментів`, g);
}

/* 8. Чи приймає ще стара назва, на якій стоїть прод. */
const h = await call({
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "Скажи «так»." }],
  thinking: "disabled",
  maxTokens: 10,
});
show("8. застаріла назва deepseek-v4-flash (те, що в проді сьогодні)", h);

console.log("\n" + "=".repeat(72));
console.log("Nothing was written to the database. Nothing was written to 1C.");
