/**
 * Інструменти про клієнтів: знайти, розкрити картку, згадати, записати.
 *
 * Пошук і профіль навмисно НЕ звужені до портфеля торгового. Питання «а
 * що з цим магазином» виникає і про чужого клієнта — і саме так уже
 * поводяться наявні роути картки (/api/erp/counterparties/[id]/summary).
 * Зате все, що агрегує ПО ТОРГОВОМУ (чеклист дій, дебіторка, продажі),
 * рахується лише по своєму — і repId туди приходить зі скоупу розмови, а
 * не з аргументів моделі.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { enumOf, id as validId, int, str } from "@/lib/assistant/validate";
import { prisma } from "@/lib/prisma";
import { agingByCounterparty } from "@/lib/analytics/money-facts";
import { recommendations } from "@/lib/analytics/clientOrder";
import { repActionCandidates, ACTION_LABELS } from "@/lib/analytics/company/rep-actions";
import { clientProfileFacts } from "@/lib/assistant/facts/client-profile";
import { findClients } from "@/lib/assistant/facts/client-search";
import { createMemory, KIND_LABELS, MEMORY_KINDS } from "@/lib/assistant/memory";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";
import { days as roundDays, uah, ymd } from "@/lib/assistant/format";

export const searchClients: ToolDef = {
  kinds: ["SALES", "DRIVER"],
  name: "search_clients",
  label: "Шукаю клієнта",
  description:
    "Знайти клієнта за назвою, кодом ЄДРПОУ або контактною особою. Повертає ідентифікатор, який потрібен решті інструментів. Викликай ЗАВЖДИ, коли торговий називає клієнта словами, а ідентифікатора ще немає.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Частина назви, код або прізвище контактної особи." },
      limit: { type: "integer", description: "Скільки повернути, до 15. За замовчуванням 8." },
      onlyMine: {
        type: "boolean",
        description: "true — лише клієнти цього торгового. За замовчуванням false: шукаємо по всій базі, а свої позначені прапорцем.",
      },
    },
    required: ["query"],
  },
  async run(ctx, args) {
    const query = str(args.query, "query", { min: 2, max: 60 });
    const limit = int(args.limit, "limit", { min: 1, max: 15, fallback: 8 });
    const rows = await findClients(query, ctx.scope.repId, {
      limit,
      onlyMine: args.onlyMine === true,
    });

    if (rows.length === 0) {
      return { знайдено: 0, підказка: "нікого не знайшли — спробуйте коротший фрагмент назви" };
    }

    const aging = await agingByCounterparty(rows.map((r) => r.id));

    return {
      знайдено: rows.length,
      клієнти: rows.map((r) => ({
        клієнт_id: r.id,
        назва: r.name,
        код: r.code,
        адреса: r.address,
        телефон: r.phone,
        мій: r.mine,
        борг: uah(aging.get(r.id)?.debt ?? 0),
        прострочено: uah(aging.get(r.id)?.overdue ?? 0),
        останній_документ: ymd(r.lastDocAt),
      })),
    };
  },
};

export const clientProfile: ToolDef = {
  kinds: ["SALES", "DRIVER"],
  name: "client_profile",
  label: "Читаю картку клієнта",
  description:
    "Повна картка клієнта: борг із розбивкою й вердикт платника, стан і власний ритм закупівель, топ брендів і товарів, останні документи, памʼять про клієнта (записи торгових), коментарі й візити. Викликай перед будь-якою порадою по конкретному клієнту.",
  parameters: {
    type: "object",
    properties: {
      counterpartyId: { type: "string", description: "Ідентифікатор клієнта з search_clients або іншого інструмента." },
      months: { type: "integer", description: "За скільки місяців історія: 3, 6 або 12. За замовчуванням 6." },
    },
    required: ["counterpartyId"],
  },
  async run(_ctx, args) {
    const counterpartyId = validId(args.counterpartyId, "counterpartyId");
    const months = int(args.months, "months", { min: 3, max: 12, fallback: 6 });
    const facts = await clientProfileFacts(counterpartyId, months);
    if (!facts) return { помилка: "клієнта з таким ідентифікатором немає" };
    return facts;
  },
};

export const clientRecommendations: ToolDef = {
  name: "client_recommendations",
  label: "Підбираю, що запропонувати",
  description:
    "Готові поради по клієнту: що він бере регулярно й уже мав би замовити, що перестав брати, і які бренди беруть схожі клієнти. У кожної поради є пояснення «чому» і вільний залишок на складі.",
  parameters: {
    type: "object",
    properties: {
      counterpartyId: { type: "string", description: "Ідентифікатор клієнта." },
    },
    required: ["counterpartyId"],
  },
  async run(_ctx, args) {
    const counterpartyId = validId(args.counterpartyId, "counterpartyId");
    const list = await recommendations(counterpartyId);
    if (list.length === 0) {
      return { поради: [], примітка: "історії закупівель замало для порад" };
    }
    return {
      поради: list.map((r) => ({
        // key має вигляд «product:<id>» або «brand:<id>» — товарний
        // ідентифікатор віддаємо, щоб модель могла поставити посилання;
        // для поради «беруть схожі клієнти» ключем є бренд, і посилання
        // на товар там не буде.
        товар_id: r.key.startsWith("product:") ? r.key.slice(8) : undefined,
        назва: r.name,
        артикул: r.sku,
        бренд: r.brand,
        причина:
          r.reason === "REPLENISH"
            ? "пора повторити"
            : r.reason === "DROPPED"
              ? "перестав брати"
              : "беруть схожі клієнти",
        чому: r.why,
        ціна: uah(r.price ?? 0),
        залишок: r.stock,
      })),
    };
  },
};

export const actionCandidates: ToolDef = {
  name: "action_candidates",
  label: "Дивлюся, кому дзвонити",
  description:
    "Список клієнтів торгового, з якими треба щось зробити: забрати борг, утримати того, хто відстає від власного ритму, відновити сплячого, розпрацювати вузький асортимент, подякувати надійному. Кожен клієнт потрапляє рівно в одну категорію, у кожного готове пояснення.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description: "Фільтр: COLLECT_DEBT, CHURN_RISK, REACTIVATE, DEVELOP або OFFER_BONUS. Без нього — усі.",
      },
      days: { type: "integer", description: "Вікно періоду, 7..365 днів. За замовчуванням 30." },
      limit: { type: "integer", description: "Скільки повернути, до 25. За замовчуванням 10." },
    },
  },
  async run(ctx, args) {
    const kind = enumOf(args.kind, "kind", [
      "COLLECT_DEBT",
      "CHURN_RISK",
      "REACTIVATE",
      "DEVELOP",
      "OFFER_BONUS",
    ] as const);
    const days = int(args.days, "days", { min: 7, max: 365, fallback: 30 });
    const limit = int(args.limit, "limit", { min: 1, max: 25, fallback: 10 });

    const fromDay = shiftDay(ctx.today, -(days - 1));
    const period = {
      fromDay,
      toDay: ctx.today,
      from: kyivDayStart(fromDay),
      to: kyivDayEnd(ctx.today),
      days,
      clamped: false,
    };

    const all = await repActionCandidates(ctx.scope.repId, period);
    const filtered = kind ? all.filter((a) => a.kind === kind) : all;

    return {
      період_днів: days,
      всього: filtered.length,
      клієнти: filtered.slice(0, limit).map((a) => ({
        клієнт_id: a.counterpartyId,
        назва: a.name,
        дія: ACTION_LABELS[a.kind],
        чому: a.why,
        оборот_за_період: uah(a.amountPeriod),
        борг: uah(a.debt),
        прострочено: uah(a.overdue),
        днів_з_останньої: roundDays(a.daysSinceLast),
        ритм_днів: roundDays(a.avgIntervalDays),
        брендів: a.brandCount,
        позицій: a.skuCount,
      })),
    };
  },
};

export const rememberClient: ToolDef = {
  kinds: ["SALES", "DRIVER"],
  name: "remember_client",
  label: "Записую в памʼять клієнта",
  write: true,
  description:
    "Записати факт про клієнта в його памʼять: як платить і чому не віддає борг, характер і з ким говорити, що принципово не бере, коли приймає товар, хто з конкурентів возить. Викликай ЛИШЕ коли торговий прямо просить запамʼятати. Не записуй здогади й не переказуй сюди цифри — вони й так є в базі.",
  parameters: {
    type: "object",
    properties: {
      counterpartyId: { type: "string", description: "Ідентифікатор клієнта." },
      kind: {
        type: "string",
        description:
          "PAYMENT (оплата), RELATIONSHIP (стосунки), PREFERENCE (уподобання), LOGISTICS (логістика), COMPETITOR (конкуренти), OTHER.",
      },
      text: { type: "string", description: "Сам факт, коротко й своїми словами. До 500 символів." },
    },
    required: ["counterpartyId", "kind", "text"],
  },
  async run(ctx, args) {
    const counterpartyId = validId(args.counterpartyId, "counterpartyId");
    const kind = enumOf(args.kind, "kind", MEMORY_KINDS, "OTHER");
    const text = str(args.text, "text", { min: 3, max: 500 });

    const exists = await prisma.counterparty.findUnique({
      where: { id: counterpartyId },
      select: { name: true },
    });
    if (!exists) return { помилка: "клієнта з таким ідентифікатором немає" };

    const fact = await createMemory({
      counterpartyId,
      authorId: ctx.userId,
      kind,
      text,
      source: "ASSISTANT",
    });

    return {
      ok: true,
      записано: { id: fact.id, вид: KIND_LABELS[fact.kind], текст: fact.text },
      повідомлення: `Записав у памʼять клієнта «${exists.name}». Видалити можна на картці клієнта.`,
    };
  },
};
