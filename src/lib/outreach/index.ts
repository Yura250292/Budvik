/**
 * Журнал пропозицій клієнтам: запис, історія, результат і згода.
 *
 * Сайт сам нікому не пише. Торговий відправляє текст зі свого телефона, а
 * сюди потрапляє факт: що, кому, яким каналом і в якому стані був клієнт у
 * ту мить. Без стану на момент відправки конверсію не порахувати чесно —
 * через місяць «сплячий» клієнт уже буде «активним» саме завдяки пропозиції.
 *
 * Запис іде ДО відкриття Viber (keepalive), але падіння запису відправку не
 * блокує: торговий, у якого не відкрився месенджер через збій журналу, просто
 * перестане цією кнопкою користуватися.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clientStateNow } from "@/lib/assistant/facts/client-state";
import { isLinkToken } from "./links";
import {
  isMarketingConsent,
  isOutreachChannel,
  isOutreachKind,
  isOutreachOutcome,
  isPreferredChannel,
  type MarketingConsent,
  type OutreachChannel,
  type OutreachKind,
  type OutreachOutcome,
  type OutreachRow,
  type PreferredChannel,
} from "./types";

/** Текст, який торговий може дописати руками. Складений сайтом — до 400. */
export const OUTREACH_TEXT_MAX = 2000;
const TEXT_MIN = 3;
const MAX_PRODUCT_IDS = 10;

/** Скільки рядків історії на картці: більше ніхто не гортає. */
export const OUTREACH_LIST_LIMIT = 20;

/** Канали без тексту: дзвінок і розмова особисто — факт, а не повідомлення. */
const TEXTLESS_CHANNELS: ReadonlySet<string> = new Set(["CALL", "IN_PERSON"]);

export class OutreachError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type OutreachInput = {
  counterpartyId: string;
  kind: OutreachKind;
  channel: OutreachChannel;
  text: string;
  productIds: string[];
  linkToken: string | null;
};

/** Чиста перевірка вводу; кидає OutreachError з людським текстом. */
export function validateOutreachInput(input: unknown): OutreachInput {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const counterpartyId = typeof o.counterpartyId === "string" ? o.counterpartyId.trim() : "";
  if (!counterpartyId || counterpartyId.length > 64) throw new OutreachError("Не вказано клієнта");
  if (!isOutreachKind(o.kind)) throw new OutreachError("Невідомий вид пропозиції");
  if (!isOutreachChannel(o.channel)) throw new OutreachError("Невідомий канал");

  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (text.length > OUTREACH_TEXT_MAX) throw new OutreachError(`Задовгий текст: до ${OUTREACH_TEXT_MAX} символів`);
  if (!TEXTLESS_CHANNELS.has(o.channel) && text.length < TEXT_MIN) {
    throw new OutreachError("Текст порожній — нема що відправляти");
  }

  const productIds = Array.isArray(o.productIds)
    ? [...new Set(o.productIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))]
    : [];
  if (productIds.length > MAX_PRODUCT_IDS) throw new OutreachError("Забагато товарів");

  /**
   * Токен лишаємо, лише якщо він справді стоїть у тексті й канал його несе.
   * Торговий міг стерти посилання, а дзвінок посилання не передає взагалі —
   * тоді «клієнт відкрив» не мало б до цього рядка жодного стосунку.
   */
  const linkToken =
    isLinkToken(o.linkToken) && !TEXTLESS_CHANNELS.has(o.channel) && text.includes(o.linkToken)
      ? o.linkToken
      : null;

  return { counterpartyId, kind: o.kind, channel: o.channel, text, productIds, linkToken };
}

const ROW_INCLUDE = {
  rep: { select: { name: true } },
  counterparty: { select: { name: true } },
} satisfies Prisma.ClientOutreachInclude;

type DbRow = Prisma.ClientOutreachGetPayload<{ include: typeof ROW_INCLUDE }>;

function shape(r: DbRow): OutreachRow {
  return {
    id: r.id,
    counterpartyId: r.counterpartyId,
    counterpartyName: r.counterparty?.name ?? null,
    repId: r.repId,
    repName: r.rep?.name.trim() ?? null,
    kind: r.kind,
    channel: r.channel,
    purpose: r.purpose,
    source: r.source,
    text: r.text,
    productIds: r.productIds,
    stateAtSend: r.stateAtSend,
    sentAt: r.sentAt.toISOString(),
    clickedAt: r.clickedAt?.toISOString() ?? null,
    outcome: r.outcome,
    outcomeAt: r.outcomeAt?.toISOString() ?? null,
    outcomeBy: r.outcomeBy,
    outcomeDocId: r.outcomeDocId,
    outcomeAmount: r.outcomeAmount,
  };
}

/**
 * Записати відправку.
 *
 * Токен посилання — ключ ідемпотентності. Торговий, який натиснув «Viber»,
 * повернувся й натиснув «Telegram» з тим самим текстом, відправив одну
 * пропозицію, а не дві: другий запит повертає вже збережений рядок.
 */
export async function createOutreach(
  input: unknown,
  userId: string,
  now: Date = new Date()
): Promise<{ item: OutreachRow; duplicate: boolean }> {
  const v = validateOutreachInput(input);

  const cp = await prisma.counterparty.findUnique({ where: { id: v.counterpartyId }, select: { id: true } });
  if (!cp) throw new OutreachError("Клієнта не знайдено", 404);

  const existing = async () => {
    if (!v.linkToken) return null;
    const row = await prisma.clientOutreach.findUnique({ where: { linkToken: v.linkToken }, include: ROW_INCLUDE });
    if (!row) return null;
    if (row.repId !== userId || row.counterpartyId !== v.counterpartyId) {
      throw new OutreachError("Це посилання вже належить іншій пропозиції — складіть текст наново", 409);
    }
    return { item: shape(row), duplicate: true };
  };

  const seen = await existing();
  if (seen) return seen;

  const state = await clientStateNow(v.counterpartyId);

  try {
    const row = await prisma.clientOutreach.create({
      data: {
        counterpartyId: v.counterpartyId,
        repId: userId,
        kind: v.kind,
        channel: v.channel,
        // Нагадування про борг — сервісне: воно не рахується в стелю
        // реклами й не блокується відпискою.
        purpose: v.kind === "DEBT" ? "SERVICE" : "MARKETING",
        source: "REP",
        text: v.text,
        productIds: v.productIds,
        stateAtSend: state.state,
        daysSinceLastAtSend: state.daysSinceLast,
        linkToken: v.linkToken,
        sentAt: now,
        outcome: "PENDING",
      },
      include: ROW_INCLUDE,
    });
    return { item: shape(row), duplicate: false };
  } catch (e) {
    // Два дотики одночасно: другий упирається в унікальний токен.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await existing();
      if (again) return again;
    }
    throw e;
  }
}

export async function listOutreach(counterpartyId: string, limit = OUTREACH_LIST_LIMIT): Promise<OutreachRow[]> {
  const rows = await prisma.clientOutreach.findMany({
    where: { counterpartyId },
    orderBy: { sentAt: "desc" },
    take: limit,
    include: ROW_INCLUDE,
  });
  return rows.map(shape);
}

export type Actor = { userId: string; role: string };

/**
 * Офіс — ті самі ролі, що OFFICE_ROLES у lib/app/identity.ts. Копією, а не
 * імпортом: той модуль тягне next/server і next-auth, а цей журнал читатиме
 * воркер на Railway, який ставить «замовив» за реалізаціями.
 */
const OFFICE: ReadonlySet<string> = new Set(["ADMIN", "MANAGER"]);

export function canEditOutreach(row: Pick<OutreachRow, "repId">, actor: Actor): boolean {
  return row.repId === actor.userId || OFFICE.has(actor.role);
}

/**
 * Результат руками торгового.
 *
 * outcomeBy = 'REP' — воркер, який сам ставить «замовив» за реалізацією,
 * ручну відмітку не перезаписує: торговий знає про «відповів, замовить у
 * п'ятницю» більше, ніж 1С. Повернення до «Чекаємо» знімає ручну відмітку
 * повністю — рішення знову за воркером.
 *
 * «Просить не писати» — не лише результат пропозиції, а й відписка клієнта:
 * фіксуємо її на контрагенті, щоб наступний торговий побачив попередження.
 */
export async function setOutreachOutcome(id: string, outcome: unknown, actor: Actor): Promise<OutreachRow> {
  if (!isOutreachOutcome(outcome)) throw new OutreachError("Невідомий результат");

  const row = await prisma.clientOutreach.findUnique({
    where: { id },
    select: { id: true, repId: true, counterpartyId: true },
  });
  if (!row) throw new OutreachError("Пропозицію не знайдено", 404);
  if (!canEditOutreach(row, actor)) throw new OutreachError("Позначати результат може автор або офіс", 403);

  const now = new Date();
  const manual = outcome !== "PENDING";

  const [updated] = await prisma.$transaction([
    prisma.clientOutreach.update({
      where: { id },
      data: {
        outcome: outcome as OutreachOutcome,
        outcomeAt: manual ? now : null,
        outcomeBy: manual ? "REP" : null,
      },
      include: ROW_INCLUDE,
    }),
    ...(outcome === "OPT_OUT"
      ? [
          prisma.counterparty.update({
            where: { id: row.counterpartyId },
            data: {
              marketingConsent: "REFUSED",
              marketingConsentAt: now,
              marketingConsentSource: "REP",
              marketingConsentById: actor.userId,
              marketingOptOutAt: now,
            },
          }),
        ]
      : []),
  ]);
  return shape(updated as DbRow);
}

export type ConsentState = {
  marketingConsent: MarketingConsent;
  marketingConsentAt: string | null;
  marketingOptOutAt: string | null;
  preferredChannel: PreferredChannel | null;
};

/**
 * Згода клієнта, яку зафіксував торговий.
 *
 * Політика приватності обіцяє «без окремої згоди розсилок не надсилаємо», тож
 * майбутня кампанія дивитиметься лише на GRANTED. «Не писати» ставить і дату
 * відписки; «Згоден» її знімає — людина передумала, і це її право.
 * preferredChannel: null у запиті — стерти, відсутнє поле — не чіпати.
 */
export async function setClientConsent(counterpartyId: string, input: unknown, userId: string): Promise<ConsentState> {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const hasConsent = "marketingConsent" in o;
  const hasChannel = "preferredChannel" in o;
  if (!hasConsent && !hasChannel) throw new OutreachError("Нема що змінювати");
  if (hasConsent && !isMarketingConsent(o.marketingConsent)) throw new OutreachError("Невідоме значення згоди");
  if (hasChannel && o.preferredChannel !== null && !isPreferredChannel(o.preferredChannel)) {
    throw new OutreachError("Невідомий канал");
  }

  const cp = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true, marketingOptOutAt: true },
  });
  if (!cp) throw new OutreachError("Клієнта не знайдено", 404);

  const now = new Date();
  const data: Prisma.CounterpartyUpdateInput = {};
  if (hasConsent) {
    const consent = o.marketingConsent as MarketingConsent;
    data.marketingConsent = consent;
    data.marketingConsentAt = now;
    data.marketingConsentSource = "REP";
    data.marketingConsentById = userId;
    // Повторне «Не писати» не зсуває дату першої відписки.
    data.marketingOptOutAt = consent === "REFUSED" ? (cp.marketingOptOutAt ?? now) : null;
  }
  if (hasChannel) data.preferredChannel = (o.preferredChannel as PreferredChannel | null) ?? null;

  const saved = await prisma.counterparty.update({
    where: { id: counterpartyId },
    data,
    select: { marketingConsent: true, marketingConsentAt: true, marketingOptOutAt: true, preferredChannel: true },
  });
  return {
    marketingConsent: isMarketingConsent(saved.marketingConsent) ? saved.marketingConsent : "UNKNOWN",
    marketingConsentAt: saved.marketingConsentAt?.toISOString() ?? null,
    marketingOptOutAt: saved.marketingOptOutAt?.toISOString() ?? null,
    preferredChannel: isPreferredChannel(saved.preferredChannel) ? saved.preferredChannel : null,
  };
}
