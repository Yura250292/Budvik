/**
 * Спільні типи помічника: контекст інструмента, події ходу, дріт до моделі.
 *
 * Окремим файлом, щоб реєстр інструментів не тягнув за собою клієнт
 * DeepSeek, а той — не знав про Prisma.
 */

/**
 * Хто питає: торговий, водій, складовщик чи керівник.
 *
 * Це не косметика й не роль у базі, а чотири різні набори питань. Торговому
 * потрібні продажі, борги портфеля й асортимент; водієві — точки на
 * сьогодні, скільки грошей забрати й куди під'їхати; складовщикові — де
 * водій і що він везе, що сьогодні пакувати й чи доїхали його накладні;
 * керівникові — вся фірма разом: команда, дебіторка, зміни, склад, обмін.
 *
 * Дати чужий набір означало б показати порожні звіти: продажів ні на
 * водія, ні на складовщика не оформлюють, портфеля в них немає, а в
 * керівника немає власного маршруту. Саме тому вид визначає і промпт, і
 * перелік інструментів, а не лише формулювання.
 */
export type AssistantKind = "SALES" | "DRIVER" | "WAREHOUSE" | "ADMIN";

/** Кому належать дані цієї розмови. */
export type AssistantScope = {
  /** Чиї показники читаємо. Для SALES — він сам, для офісу — обраний торговий. */
  repId: string;
  repName: string;
  /**
   * true — розмова про ВСЮ фірму, а не про одного торгового.
   *
   * Тоді repId — це сам керівник, і питати в нього «мій портфель» немає
   * сенсу: спільні інструменти дивляться саме на цей прапорець, а не на
   * repId, інакше пошук клієнта «лише мої» мовчки віддавав би порожньо.
   */
  company: boolean;
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
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
      /**
       * Міркування цього ж ходу, повернені моделі назад.
       *
       * Документація DeepSeek вимагає їх повертати, коли запит несе `tools`.
       * Проба показала, що без них приходить не 400, а звичайна відповідь —
       * тобто вимога нежорстка. Повертаємо все одно: це документований
       * шлях, а коштує воно кілька вхідних токенів, майже завжди з кешу.
       *
       * Заповнене лише тоді, коли міркування того раунду були ввімкнені:
       * надсилати порожнє поле немає змісту, а надсилати його в раунд без
       * міркувань проба не перевіряла.
       */
      reasoning_content?: string;
    }
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
  /** Скільки з вихідних токенів пішло на міркування, а не на текст. */
  completion_tokens_details?: { reasoning_tokens?: number };
};
