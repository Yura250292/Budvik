/**
 * Проба Gemini через OpenAI-сумісний ендпоінт — перед тим, як віддати їй
 * помічника керівника.
 *
 * READ ONLY: жодного запиту до Postgres, жодного запису. До Google ідуть
 * крихітні запити з одним-двома вигаданими інструментами — проба коштує
 * частки цента.
 *
 * Що саме перевіряємо (від цього залежить src/lib/assistant/llm.ts):
 *
 *   1. стрім: чи несе delta.tool_calls поле index, id і
 *      extra_content.google.thought_signature, який finish_reason, де usage;
 *   2. другий раунд із ПОВЕРНУТИМ підписом і tool_choice "none" (останній
 *      раунд помічника) — 200 і текст?
 *   3. другий раунд БЕЗ підпису — 400 чи мовчки 200? (так виглядатиме
 *      відповідь, якщо підпис десь загубиться);
 *   4. два виклики в одному раунді — як їх розрізняти без index;
 *   5. reasoning_effort low проти medium: секунди й reasoning_tokens;
 *   6. temperature у запиті не ламає;
 *   7. тіло помилки (невідома модель) — масив чи обʼєкт.
 *
 *   npx tsx --env-file=.env scripts/probe-gemini-openai.mts [модель]
 */

const URL_CHAT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("Немає GEMINI_API_KEY (запускати з --env-file=.env)");
  process.exit(1);
}
const MODEL = process.argv[2] ?? "gemini-3.8-flash";

/** Два інструменти з кириличними ключами — як справжні в помічнику. */
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "stock_health",
      description: "Стан складу бренду: дефіцит, що замовити, на яку суму.",
      parameters: {
        type: "object",
        properties: {
          brand: { type: "string", description: "Назва бренду" },
          режим: { type: "string", enum: ["low", "dead"], description: "low — дефіцит, dead — мертвий запас" },
        },
        required: ["brand"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "team_overview",
      description: "Оборот команди торгових за період.",
      parameters: {
        type: "object",
        properties: { днів: { type: "integer", description: "Скільки днів назад" } },
      },
    },
  },
];

type Msg = Record<string, unknown>;
type RawCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  extra_content?: { google?: { thought_signature?: string } };
};

type Out = {
  status: number;
  ms: number;
  attempts: number;
  content: string;
  calls: RawCall[];
  /** Кожен фрагмент tool_calls як прийшов — щоб побачити, чи є index. */
  fragments: RawCall[];
  finish: string;
  usage: Record<string, unknown> | null;
  usageChunks: number;
  error: string;
};

async function once(body: Record<string, unknown>, stream: boolean): Promise<Out> {
  const t0 = Date.now();
  const out: Out = {
    status: 0,
    ms: 0,
    attempts: 1,
    content: "",
    calls: [],
    fragments: [],
    finish: "",
    usage: null,
    usageChunks: 0,
    error: "",
  };

  let res: Response;
  try {
    res = await fetch(URL_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(stream ? { ...body, stream: true, stream_options: { include_usage: true } } : body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    out.error = `мережа/таймаут: ${(e as Error).name} ${(e as Error).message}`;
    out.ms = Date.now() - t0;
    return out;
  }
  out.status = res.status;

  if (!res.ok || !res.body) {
    out.error = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    out.ms = Date.now() - t0;
    return out;
  }

  if (!stream) {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: RawCall[] }; finish_reason?: string }>;
      usage?: Record<string, unknown>;
    };
    const m = data.choices?.[0]?.message ?? {};
    out.content = m.content ?? "";
    out.calls = m.tool_calls ?? [];
    out.finish = data.choices?.[0]?.finish_reason ?? "";
    out.usage = data.usage ?? null;
    out.ms = Date.now() - t0;
    return out;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
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
          choices?: Array<{ delta?: { content?: string | null; tool_calls?: RawCall[] }; finish_reason?: string | null }>;
          usage?: Record<string, unknown> | null;
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        if (chunk.usage) {
          out.usage = chunk.usage;
          out.usageChunks++;
        }
        const ch = chunk.choices?.[0];
        if (!ch) continue;
        if (ch.finish_reason) out.finish = ch.finish_reason;
        if (ch.delta?.content) out.content += ch.delta.content;
        for (const frag of ch.delta?.tool_calls ?? []) out.fragments.push(frag);
      }
    }
  }
  // Склеювання: є index — за ним; немає — фрагмент з id відкриває новий виклик.
  const slots: RawCall[] = [];
  const byIndex = new Map<number, RawCall>();
  for (const frag of out.fragments) {
    let slot: RawCall | undefined;
    if (typeof frag.index === "number") slot = byIndex.get(frag.index);
    else if (!frag.id) slot = slots[slots.length - 1];
    if (!slot) {
      slot = { id: "", type: "function", function: { name: "", arguments: "" } };
      slots.push(slot);
      if (typeof frag.index === "number") byIndex.set(frag.index, slot);
    }
    if (frag.id) slot.id = frag.id;
    if (frag.function?.name) slot.function!.name = frag.function.name;
    if (frag.function?.arguments) slot.function!.arguments += frag.function.arguments;
    if (frag.extra_content) slot.extra_content = frag.extra_content;
  }
  out.calls = slots;
  out.ms = Date.now() - t0;
  return out;
}

/** 503 «high demand» — не відповідь про механіку, тож до трьох спроб. */
async function call(body: Record<string, unknown>, stream = false): Promise<Out> {
  let last: Out | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const out = await once(body, stream);
    out.attempts = attempt;
    if (out.status !== 503 && out.status !== 429 && out.status !== 0) return out;
    last = out;
    await new Promise((r) => setTimeout(r, 2_000 * attempt));
  }
  return last!;
}

function show(title: string, o: Out) {
  const head = o.status === 200 ? "OK " : "ПАД";
  console.log(`\n── ${title}`);
  console.log(
    `   ${head} ${o.status} · ${(o.ms / 1000).toFixed(1)} с · спроб ${o.attempts} · finish=${o.finish || "—"} · текст ${o.content.length} симв.`
  );
  if (o.usage) {
    console.log(`   usage: ${JSON.stringify(o.usage)}${o.usageChunks ? ` (у ${o.usageChunks} чанках)` : ""}`);
  }
  if (o.fragments.length > 0) {
    console.log(
      `   фрагментів tool_calls: ${o.fragments.length}; index у фрагментах: ${o.fragments
        .map((f) => (typeof f.index === "number" ? f.index : "—"))
        .join(",")}`
    );
  }
  for (const c of o.calls) {
    const sig = c.extra_content?.google?.thought_signature;
    console.log(
      `   виклик ${c.function?.name}(${c.function?.arguments}) id=${c.id || "БЕЗ id"} підпис=${sig ? `${sig.length} симв.` : "НЕМАЄ"}`
    );
  }
  if (o.error) console.log(`   ПОМИЛКА: ${o.error}`);
  if (o.content) console.log(`   текст: ${o.content.slice(0, 200).replace(/\n/g, " ⏎ ")}`);
}

const SYS = "Ти помічник керівника фірми Budvik. Відповідай українською, коротко.";
const ASK = "Що замовити по бренду СИЛА?";

console.log(`Проба Gemini (${MODEL}) · READ ONLY щодо бази · нічого не записано`);
console.log("=".repeat(72));

/* 1. Стрім з інструментами, як у помічнику. */
const r1 = await call(
  {
    model: MODEL,
    messages: [{ role: "system", content: SYS }, { role: "user", content: ASK }],
    tools: TOOLS,
    tool_choice: "auto",
    reasoning_effort: "low",
    max_tokens: 2000,
  },
  true
);
show("1. стрім · tools · effort low", r1);

if (r1.status === 200 && r1.calls.length > 0) {
  const first = r1.calls[0];
  const toolMsg: Msg = {
    role: "tool",
    tool_call_id: first.id,
    content: JSON.stringify({
      бренд: "СИЛА",
      дефіцит: { до_замовлення: 551, нуль_на_складі: 298, сума_закупівлі: "1 527 788 ₴" },
    }),
  };
  const withSig: Msg = { role: "assistant", content: r1.content || null, tool_calls: r1.calls.slice(0, 1) };
  const noSig: Msg = {
    role: "assistant",
    content: r1.content || null,
    tool_calls: r1.calls.slice(0, 1).map((c) => ({ id: c.id, type: c.type, function: c.function })),
  };
  const base = [{ role: "system", content: SYS }, { role: "user", content: ASK }];

  show(
    '2. другий раунд · З підписом · tool_choice "none" · стрім',
    await call(
      { model: MODEL, messages: [...base, withSig, toolMsg], tools: TOOLS, tool_choice: "none", reasoning_effort: "low", max_tokens: 2000 },
      true
    )
  );
  show(
    '3. другий раунд · БЕЗ підпису · tool_choice "none" · стрім',
    await call(
      { model: MODEL, messages: [...base, noSig, toolMsg], tools: TOOLS, tool_choice: "none", reasoning_effort: "low", max_tokens: 2000 },
      true
    )
  );
  show(
    '3б. другий раунд · БЕЗ підпису · tool_choice "auto"',
    await call({ model: MODEL, messages: [...base, noSig, toolMsg], tools: TOOLS, tool_choice: "auto", reasoning_effort: "low", max_tokens: 2000 })
  );
} else {
  console.log("\n── 2–3 пропущено: у пробі 1 модель не замовила інструмент");
}

/* 4. Два виклики в одному раунді. */
show(
  "4. стрім · два інструменти одним раундом",
  await call(
    {
      model: MODEL,
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: "Одночасно: дефіцит по бренду APRO, дефіцит по бренду СИЛА і оборот команди за 30 днів." },
      ],
      tools: TOOLS,
      tool_choice: "auto",
      reasoning_effort: "low",
      max_tokens: 2000,
    },
    true
  )
);

/* 5. Глибина міркувань: скільки секунд і токенів. */
const hard =
  "Серпень: оборот 3 780 972 ₴, 31 день, 820 накладних, 210 клієнтів. Вересень 1–15: оборот 1 996 147 ₴, 15 днів, 420 накладних, 150 клієнтів. " +
  "Чи впав середній чек, і чи падіння через менші замовлення, чи через менше клієнтів? Три речення.";
for (const effort of ["low", "medium"]) {
  show(
    `5. reasoning_effort "${effort}" · причинне питання`,
    await call({ model: MODEL, messages: [{ role: "system", content: SYS }, { role: "user", content: hard }], reasoning_effort: effort, max_tokens: 4000 })
  );
}

/* 6. temperature як у DeepSeek-гілці. */
show(
  "6. temperature 0.3",
  await call({ model: MODEL, messages: [{ role: "user", content: "Скажи слово «готово»." }], temperature: 0.3, max_tokens: 50 })
);

/* 7. Форма помилки. */
show("7. невідома модель", await call({ model: "gemini-no-such-model", messages: [{ role: "user", content: "так" }], max_tokens: 5 }));

console.log("\n" + "=".repeat(72));
console.log("Nothing was written to the database. Nothing was written to 1C.");
