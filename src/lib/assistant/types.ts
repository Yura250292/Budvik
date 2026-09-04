/**
 * Спільні типи помічника: контекст інструмента, події ходу, дріт до моделі.
 *
 * Окремим файлом, щоб реєстр інструментів не тягнув за собою клієнт
 * DeepSeek, а той — не знав про Prisma.
 */

/**
 * Хто питає: торговий чи водій.
 *
 * Це не косметика й не роль у базі, а два різні набори питань. Торговому
 * потрібні продажі, борги портфеля й асортимент; водієві — точки на
 * сьогодні, скільки грошей забрати й куди під'їхати. Дати водієві
 * інструменти торгового означало б показати йому порожні звіти: продажів
 * на нього не оформлюють, портфеля в нього немає.
 */
export type AssistantKind = "SALES" | "DRIVER";

/** Кому належать дані цієї розмови. */
export type AssistantScope = {
  /** Чиї показники читаємо. Для SALES — він сам, для офісу — обраний торговий. */
  repId: string;
  repName: string;
};

/** Що бачить інструмент. Скоуп сюди кладе роут, а не модель. */
export type ToolContext = {
  /** Хто питає (для запису авторства). */
  userId: string;
  role: string;
  kind: AssistantKind;
  scope: AssistantScope;
  /** Сьогодні за Києвом, YYYY-MM-DD — щоб «сьогодні» не поїхало опівночі. */
  today: string;
};

export type ToolDef = {
  name: string;
  /** Кому інструмент видно. Без поля — лише торговому. */
  kinds?: AssistantKind[];
  /** Опис для моделі: коли саме викликати. Українською — питання теж українською. */
  description: string;
  /** JSON Schema параметрів. Імена полів ЛАТИНИЦЕЮ. */
  parameters: Record<string, unknown>;
  /** Підпис у інтерфейсі, поки інструмент працює. */
  label: string;
  /** true — інструмент щось записує в базу. */
  write?: boolean;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

/** Події, які роут віддає інтерфейсу через SSE. */
export type TurnEvent =
  | { event: "tool_start"; data: { id: string; name: string; label: string; write?: boolean } }
  | { event: "tool_done"; data: { id: string; name: string; ok: boolean; ms: number } }
  | { event: "delta"; data: { text: string } }
  /**
   * Скинути вже показаний шматок тексту.
   *
   * Модель часто починає раунд словами «зараз подивлюся борги» і лише
   * потім замовляє інструмент. Показати це корисно — видно, що вона не
   * зависла, — але лишати в стрічці не можна: далі прийде справжня
   * відповідь, і репліка мала б два початки.
   */
  | { event: "drop"; data: Record<string, never> }
  | {
      event: "done";
      data: {
        messageId: string;
        usage: { prompt: number; completion: number; total: number };
        rounds: number;
        strippedLinks: number;
      };
    }
  | { event: "error"; data: { message: string } };

/* ── Дріт до DeepSeek (сумісний з OpenAI) ─────────────────────────────── */

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolSchema = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};
