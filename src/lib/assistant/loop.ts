/**
 * Хід розмови: питання → інструменти → відповідь.
 *
 * Три речі, заради яких цей цикл виглядає саме так.
 *
 * ДЕДЛАЙН. Роут живе 120 секунд, і хід мусить закінчитися РАНІШЕ, ніж його
 * обірвуть: обірваний хід — це списані токени й порожній екран. Тому за
 * 25 секунд до межі інструменти вимикаються, і модель зобов'язана
 * відповісти текстом із того, що вже має.
 *
 * ПОМИЛКА ІНСТРУМЕНТА — ЦЕ ДАНІ. Невідома назва, кривий JSON аргументів,
 * виняток усередині — усе повертається моделі як {"помилка": "..."}. Вона
 * з другої спроби виправляється сама, а користувач бачить відповідь
 * замість 500-ї.
 *
 * КОЖЕН ВИКЛИК МУСИТЬ ОТРИМАТИ ВІДПОВІДЬ. DeepSeek віддає 400, якщо в
 * наступному запиті бракує повідомлення role:"tool" бодай на один
 * tool_call_id. Тому відповідь пишеться навіть на виклик, який ми
 * відмовились виконувати.
 */

import pLimitLike from "@/lib/assistant/concurrency";
import {
  FINAL_ONLY_BELOW_MS,
  MAX_ROUNDS,
  MAX_TOKENS_FINAL,
  MAX_TOKENS_THINKING,
  MAX_TOOL_CALLS_PER_TURN,
  THINKING_ENABLED,
  THINKING_KINDS,
  THINKING_MIN_MS,
  TOOL_CONCURRENCY,
  TURN_DEADLINE_MS,
} from "@/lib/assistant/config";
import { streamChat, DeepSeekError } from "@/lib/assistant/deepseek";
import { systemPromptFor, buildTurnContext } from "@/lib/assistant/prompt";
import { TOOL_BY_NAME, toolSchemas } from "@/lib/assistant/tools";
import { compact } from "@/lib/assistant/format";
import { collectEntities, entityIdList, rewriteLinks, verifyNumbers } from "@/lib/assistant/guards";
import { recordNumberCheck } from "@/lib/assistant/number-guard";
import { ToolArgError } from "@/lib/assistant/validate";
import {
  addUsage,
  appendMessage,
  loadHistoryForModel,
  loadSeenEntities,
  touchThread,
} from "@/lib/assistant/threads";
import { tryDirectAnswer } from "@/lib/assistant/direct";
import type { DirectAnswer } from "@/lib/assistant/answers";
import type { ChatMessage, ToolCall, ToolContext, TurnEvent } from "@/lib/assistant/types";

export type RunTurnInput = {
  threadId: string;
  ctx: ToolContext;
  selfScoped: boolean;
  userText: string;
  clientHint?: { id: string; name: string } | null;
  isFirstMessage: boolean;
  apiKey: string;
  signal?: AbortSignal;
  emit: (event: TurnEvent) => void;
};

/**
 * Чи думати в цьому ході. Рішення ухвалюється ОДИН РАЗ і на всі раунди.
 *
 * Спокуса зекономити й увімкнути міркування лише з другого раунду — коли
 * інструменти вже щось віддали і є над чим думати — коштувала бойового
 * прогону. DeepSeek відповідає на такий хід 400:
 *
 *   "The `reasoning_content` in the thinking mode must be passed back"
 *
 * Тобто в режимі міркувань кожне попереднє повідомлення помічника з
 * викликами інструментів мусить нести своє `reasoning_content`. Повідомлення
 * першого раунду, зробленого БЕЗ міркувань, його не має й мати не може —
 * і весь хід падає на другому раунді. Вмикати посеред розмови не можна:
 * або з першого слова, або ніяк.
 *
 * Дві умови, обидві перевіряються до циклу.
 *
 * ВИД. Лише ті, що в THINKING_KINDS, — сьогодні це керівник. Решті
 * міркування додають секунди, не додаючи правильності.
 *
 * ЧАС. Якщо хід уже з'їв більшу частину свого бюджету на спробі відповісти
 * без моделі, на думання його не лишилось: швидка відповідь краща за
 * обірваний роздум.
 *
 * Окремий запобіжник — ASSISTANT_THINKING=off: вимикає все це без деплою.
 */
function thinkingForTurn(input: {
  kind: ToolContext["kind"];
  timeLeftMs: number;
}): "enabled" | "disabled" {
  if (!THINKING_ENABLED) return "disabled";
  if (!THINKING_KINDS.includes(input.kind)) return "disabled";
  if (input.timeLeftMs < THINKING_MIN_MS) return "disabled";
  return "enabled";
}

export async function runTurn(input: RunTurnInput) {
  const startedAt = Date.now();
  const timeLeft = () => TURN_DEADLINE_MS - (Date.now() - startedAt);

  await appendMessage({ threadId: input.threadId, role: "USER", content: input.userText });
  await touchThread(input.threadId, input.isFirstMessage ? input.userText : null);

  const [history, seen] = await Promise.all([
    loadHistoryForModel(input.threadId),
    loadSeenEntities(input.threadId),
  ]);

  /**
   * Спершу пробуємо відповісти без моделі.
   *
   * «Хто винен», «сплануй день», «з чим зайти до Химича» — це переліки, і
   * код складає їх за секунду й безкоштовно. Модель лишається для
   * питань, де треба зважити або пояснити.
   */
  const direct = await tryDirectAnswer(input.ctx, input.userText, {
    // history містить щойно збережене питання, тож своя репліка не рахується.
    hasHistory: history.length > 1,
    clientHint: input.clientHint,
  });

  if (direct && !direct.miss) {
    return finishDirect(input, direct, startedAt);
  }

  /**
   * Промах коду — не відповідь.
   *
   * Код шукав «вчорашній оборот Кулика» серед товарів і не знайшов. Раніше
   * це й було відповіддю («такого товару немає»), і модель не мала шансу.
   * Тепер слід пошуку лишається в стрічці, а питання йде моделі разом із
   * підказкою, що саме вже перевірено, — щоб вона не повторила той самий
   * марний пошук, а спробувала інакше.
   */
  if (direct?.miss) {
    for (const tool of direct.tools) {
      input.emit({
        event: "tool_start",
        data: { id: `direct-${tool.name}`, name: tool.name, label: tool.label },
      });
      input.emit({
        event: "tool_done",
        data: { id: `direct-${tool.name}`, name: tool.name, ok: true, ms: tool.ms },
      });
    }
  }

  const context = buildTurnContext({
    today: input.ctx.today,
    scope: input.ctx.scope,
    selfScoped: input.selfScoped,
    kind: input.ctx.kind,
    clientHint: input.clientHint,
    codeMiss: direct?.miss ?? null,
  });

  // Історія вже містить щойно збережене питання — беремо її як є, а
  // контекст ходу приклеюємо до останньої репліки користувача.
  const messages: ChatMessage[] = [
    { role: "system", content: systemPromptFor(input.ctx.kind) },
    ...history.slice(0, -1),
    { role: "user", content: `${context}\n\nПИТАННЯ: ${input.userText}` },
  ];

  const tools = toolSchemas(input.ctx.kind);
  const limit = pLimitLike(TOOL_CONCURRENCY);

  /**
   * Режим міркувань — на весь хід, бо змінити його посеред розмови API не дає.
   *
   * Стеля відповіді залежить від нього: токени роздуму йдуть у той самий
   * `max_tokens`, що й текст, тож у режимі міркувань її треба підняти —
   * інакше роздум зʼїсть відповідь, і користувач отримає позначку «обірвано»
   * замість тексту.
   */
  const thinking = thinkingForTurn({ kind: input.ctx.kind, timeLeftMs: timeLeft() });
  const maxTokens = thinking === "enabled" ? MAX_TOKENS_THINKING : MAX_TOKENS_FINAL;

  let promptTokens = 0;
  let completionTokens = 0;
  /**
   * Скільки з вихідних токенів пішло на міркування.
   *
   * Окремо від completionTokens, бо це єдиний спосіб побачити з проду, чи
   * міркування взагалі вмикаються і чого вони коштують. Без цього числа
   * «помічник керівника став думати» лишається словами.
   */
  let reasoningTokens = 0;
  let toolCallsUsed = 0;
  let rounds = 0;
  let nudged = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    rounds = round + 1;

    const allowTools = timeLeft() > FINAL_ONLY_BELOW_MS && toolCallsUsed < MAX_TOOL_CALLS_PER_TURN;
    const isFinalRound = round === MAX_ROUNDS - 1;
    const toolsOff = !allowTools || isFinalRound;

    /**
     * Коли інструменти вимкнено, це треба сказати словами.
     *
     * Самого tool_choice: "none" замало: модель однаково пробує замовити
     * ще дані й витрачає на це раунд. Прямий рядок у розмові знімає
     * питання — і саме після нього вона починає відповідати тим, що вже
     * зібрала.
     */
    if (toolsOff && round > 0 && !nudged) {
      messages.push({
        role: "user",
        content:
          "Даних більше не буде: інструменти на цей хід вимкнено. Дай відповідь українською з того, що вже зібрано. Якщо чогось бракує — так і напиши, чого саме.",
      });
      nudged = true;
    }

    let answered = "";
    let emitted = false;
    const result = await streamChat({
      apiKey: input.apiKey,
      messages,
      tools,
      toolChoice: toolsOff ? "none" : "auto",
      maxTokens,
      thinking,
      signal: input.signal,
      onDelta: (text) => {
        answered += text;
        emitted = true;
        input.emit({ event: "delta", data: { text } });
      },
    });

    promptTokens += result.usage?.prompt_tokens ?? 0;
    completionTokens += result.usage?.completion_tokens ?? 0;
    reasoningTokens += result.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

    if (result.toolCalls.length > 0) {
      // Вступ на кшталт «зараз подивлюся борги» вже показаний — прибираємо
      // його, інакше він лишиться над справжньою відповіддю.
      if (emitted) input.emit({ event: "drop", data: {} });

      await appendMessage({
        threadId: input.threadId,
        role: "ASSISTANT",
        content: result.content,
        toolCalls: result.toolCalls,
      });
      messages.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls,
        // Міркування повертаємо моделі — так вимагає документація, коли
        // запит несе `tools`. У базу воно не пишеться: наступний хід
        // почнеться з чистого аркуша, і проба показала, що це не помилка.
        ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
      });

      const jobs = result.toolCalls.map((call) =>
        limit(() => runOneTool(call, input, seen, toolCallsUsed >= MAX_TOOL_CALLS_PER_TURN))
      );
      toolCallsUsed += result.toolCalls.length;

      for (const output of await Promise.all(jobs)) {
        messages.push({ role: "tool", tool_call_id: output.callId, content: output.content });
      }
      continue;
    }

    // Текстова відповідь — кінець ходу.
    const final = finalize(answered || result.content, result.finishReason, seen);
    // Посилання переписані вже після того, як текст пройшов у потік, тож
    // остаточну версію надсилаємо ще раз замість показаної: інакше в
    // стрічці лишилися б службові «client:ID».
    input.emit({ event: "drop", data: {} });
    input.emit({ event: "delta", data: { text: final.text } });

    /**
     * Числовий вартовий.
     *
     * Посилання ми звіряємо давно, а числа — ні, хоч саме вони й
     * потрапляють у розмову з клієнтом. Відповідь не переписуємо: сума
     * може бути правильною й просто інакше поданою, а мовчки правити
     * текст моделі — це вигадувати замість неї. Натомість рахуємо частку
     * незвірених і лишаємо слід у журналі: так видно, чи вигадує вона
     * взагалі, і скільки.
     */
    const numbers = verifyNumbers(final.text, input.userText, seen);
    if (numbers.unverified.length > 0) {
      console.warn(
        `[помічник] числа поза даними (${numbers.unverified.join(", ")}) · розмова ${input.threadId}`
      );
    }
    void recordNumberCheck(input.ctx.today, numbers);

    const saved = await appendMessage({
      threadId: input.threadId,
      role: "ASSISTANT",
      content: final.text,
      promptTokens,
      completionTokens,
      durationMs: Date.now() - startedAt,
    });
    await Promise.all([
      touchThread(input.threadId, null),
      addUsage(input.threadId, promptTokens + completionTokens),
    ]);

    return {
      messageId: saved.id,
      usage: {
        prompt: promptTokens,
        completion: completionTokens,
        reasoning: reasoningTokens,
        total: promptTokens + completionTokens,
      },
      rounds,
      strippedLinks: final.stripped,
      numbers,
    };
  }

  throw new DeepSeekError(
    "Не вдалося скласти відповідь: модель забагато разів пішла по дані. Спробуйте простіше питання.",
    504
  );
}

/**
 * Зберегти й віддати відповідь, складену кодом.
 *
 * Ззовні вона нічим не відрізняється від відповіді моделі: ті самі події
 * потоку, той самий слід «що я перевірив». Різниця лише в нулі замість
 * витрачених токенів — і саме за цим нулем видно, наскільки швидкий шлях
 * узагалі спрацьовує.
 */
async function finishDirect(input: RunTurnInput, direct: DirectAnswer, startedAt: number) {
  for (const tool of direct.tools) {
    input.emit({
      event: "tool_start",
      data: { id: `direct-${tool.name}`, name: tool.name, label: tool.label },
    });
    input.emit({
      event: "tool_done",
      data: { id: `direct-${tool.name}`, name: tool.name, ok: true, ms: tool.ms },
    });
    await appendMessage({
      threadId: input.threadId,
      role: "TOOL",
      content: "{}",
      toolCallId: `direct-${tool.name}`,
      toolName: tool.name,
      durationMs: tool.ms,
    });
  }

  input.emit({ event: "delta", data: { text: direct.markdown } });

  const saved = await appendMessage({
    threadId: input.threadId,
    role: "ASSISTANT",
    content: direct.markdown,
    durationMs: Date.now() - startedAt,
  });
  await touchThread(input.threadId, null);

  return {
    messageId: saved.id,
    usage: { prompt: 0, completion: 0, reasoning: 0, total: 0 },
    rounds: 0,
    strippedLinks: 0,
  };
}

/** Готовий текст: службові посилання → адреси кабінету, чесна позначка обриву. */
function finalize(
  raw: string,
  finishReason: string,
  seen: ReturnType<typeof collectEntities>
) {
  const trimmed = stripToolMarkup(raw).trim();
  const body = trimmed || "Не вдалося сформулювати відповідь. Спробуйте перепитати інакше.";
  const { text, stripped } = rewriteLinks(body, seen);
  return {
    text: finishReason === "length" ? `${text}\n\n_(відповідь обірвано за лімітом довжини)_` : text,
    stripped,
  };
}

/**
 * Прибрати службову розмітку виклику інструмента з тексту для людини.
 *
 * Модель зрідка друкує її як звичайний текст замість того, щоб викликати
 * інструмент. Показувати такий шматок користувачу не можна: він виглядає
 * як поламка системи, хоча відповідь поруч часто ціла.
 */
function stripToolMarkup(raw: string): string {
  return raw
    .replace(/<[|｜]{1,2}DSML[|｜]{1,2}[\s\S]*?$/g, "")
    .replace(/<\/?(function_calls|invoke|parameter|tool_calls)[^>]*>/g, "")
    .trim();
}

type ToolOutput = { callId: string; content: string };

async function runOneTool(
  call: ToolCall,
  input: RunTurnInput,
  seen: ReturnType<typeof collectEntities>,
  overLimit: boolean
): Promise<ToolOutput> {
  const tool = TOOL_BY_NAME.get(call.function.name);
  const label = tool?.label ?? "Перевіряю дані";
  const started = Date.now();

  input.emit({
    event: "tool_start",
    data: { id: call.id, name: call.function.name, label, write: tool?.write },
  });

  const finish = async (payload: unknown, ok: boolean) => {
    const content = compact(payload);
    const entities = collectEntities(payload);
    for (const id of entities.clients) seen.clients.add(id);
    for (const [id, sku] of entities.products) {
      if (sku || !seen.products.has(id)) seen.products.set(id, sku);
    }
    // Числа теж переносимо: за ними числовий вартовий звіряє відповідь.
    for (const n of entities.numbers) seen.numbers.add(n);

    await appendMessage({
      threadId: input.threadId,
      role: "TOOL",
      content,
      toolCallId: call.id,
      toolName: call.function.name,
      entityIds: entityIdList(entities),
      durationMs: Date.now() - started,
      error: ok ? null : "tool",
    });

    input.emit({
      event: "tool_done",
      data: { id: call.id, name: call.function.name, ok, ms: Date.now() - started },
    });
    return { callId: call.id, content };
  };

  if (!tool) {
    return finish({ помилка: `інструмента «${call.function.name}» не існує` }, false);
  }
  if (overLimit) {
    return finish({ помилка: "вичерпано ліміт викликів на один хід — відповідай тим, що вже є" }, false);
  }

  let args: Record<string, unknown>;
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return finish({ помилка: "аргументи не розібрано як JSON" }, false);
  }

  try {
    return await finish(await tool.run(input.ctx, args), true);
  } catch (e) {
    if (e instanceof ToolArgError) return finish({ помилка: e.message }, false);
    console.error(`[assistant] ${call.function.name}`, e);
    return finish({ помилка: "інструмент не спрацював, спробуй інший підхід" }, false);
  }
}
