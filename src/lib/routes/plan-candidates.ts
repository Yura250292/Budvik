/**
 * Що взагалі можна повезти завтра.
 *
 * Критерій «ще не поїхало» один: проведена реалізація, якої немає ні в
 * маршрутному листі 1С, ні в маршруті сайту. Замовлення сюди не годяться —
 * усі 2157 історичних точок прив'язані саме до реалізацій, а 94% замовлень
 * стають реалізацією протягом трьох днів, тобто менеджер планує вже після
 * проведення.
 *
 * Вікно — два тижні. Без нього в план щодня лізли б документи, які ніхто
 * ніколи не повезе: клієнт забрав сам, домовленість скасували телефоном,
 * товар поїхав поштою. Нічого з цього в базі не позначено, і єдине, що їх
 * відрізняє, — те, що вони висять.
 *
 * Точки поза Львівщиною відсіюються окремо, а не мовчки: 9 клієнтів з
 * доставками стоять у Дніпрі та Києві, і це Нова пошта, а не розвозка.
 * Крім того, наш OSRM зібраний з витяжки по області, тож дорогу за її межі
 * він однаково не покаже чесно.
 *
 * Counterparty приєднано через LEFT JOIN, а не INNER: SalesDocument.counterpartyId
 * буває NULL (шість реалізацій CONFIRMED без контрагента за 26.01–25.05.2026,
 * плюс 158 замовлень і 494 повернення тим самим грішні) — INNER JOIN мовчки
 * губив би такий документ з усіх кошиків, а тут менеджеру є на що дивитись:
 * номер документа й нагадування піти подивитись у 1С.
 */

import { prisma } from "@/lib/prisma";
import { isInternalClient, loadInternalContext } from "@/lib/rep-feed/internal";

export type PlanCandidate = {
  salesDocumentId: string;
  number: string;
  counterpartyId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  amount: number;
  /** Коли документ проведено — щоб показати, скільки вже чекає */
  createdAt: Date;
};

export type CandidatesResult = {
  /**
   * Внутрішні контрагенти: склад, співробітники, торгові.
   *
   * У 1С вони живуть поруч зі справжніми клієнтами й мають такі самі
   * реалізації — перший же живий план поставив «Склад ( Дубляни)» другою,
   * третьою і четвертою точкою маршруту, а «Передрій Дмитро (співробітник)»
   * першою. Возити їх нікуди не треба, але й ховати не можна: документ,
   * який зник без сліду, менеджер шукає довше, ніж викреслює зайвий рядок.
   */
  internal: PlanCandidate[];
  /** Готові до планування: пін є, зона наша */
  points: PlanCandidate[];
  /** Клієнт у базі є, координат немає — менеджер має показати на карті */
  noPin: PlanCandidate[];
  /** Поза Львівщиною: пошта, не розвозка */
  outOfZone: PlanCandidate[];
  /** Контрагента в документі взагалі немає — ставити пін нема кому, дивитись у 1С */
  noCounterparty: PlanCandidate[];
};

/** Скільки днів назад дивимося. */
export const CANDIDATE_DAYS = 14;

/**
 * Межі розвозки. Ширші за адміністративну Львівщину: розвозка заходить у
 * прикордонні села сусідніх областей, і різати їх по межі області було б
 * неправдою про те, як їздять насправді.
 */
export const DELIVERY_BBOX = {
  latMin: 48.6,
  latMax: 50.8,
  lngMin: 22.4,
  lngMax: 26.5,
};

type Row = {
  id: string;
  number: string;
  /** NULL, коли в документа взагалі немає контрагента (LEFT JOIN) */
  counterpartyId: string | null;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  amount: number;
  created_at: Date;
};

export async function planCandidates(days = CANDIDATE_DAYS): Promise<CandidatesResult> {
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT d.id,
           d.number,
           d."counterpartyId" AS "counterpartyId",
           c.name,
           COALESCE(c."deliveryAddress", c.address) AS address,
           c."deliveryLat" AS lat,
           c."deliveryLng" AS lng,
           d."totalAmount" AS amount,
           d."createdAt" AS created_at
    FROM "SalesDocument" d
    LEFT JOIN "Counterparty" c ON c.id = d."counterpartyId"
    WHERE d."docType" = 'REALIZATION'
      AND d.status = 'CONFIRMED'
      AND d."createdAt" >= ${since}
      AND NOT EXISTS (
        SELECT 1 FROM "RouteSheetStop" s
        WHERE s."salesDocumentId" = d.id AND s.hidden = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM "DeliveryStop" ds
        WHERE ds."salesDocumentId" = d.id
      )
    ORDER BY d."createdAt" ASC
  `;

  const points: PlanCandidate[] = [];
  const noPin: PlanCandidate[] = [];
  const outOfZone: PlanCandidate[] = [];
  const internal: PlanCandidate[] = [];

  // Ручна ознака людини плюс евристика за назвою — той самий відсів, яким
  // стрічка торгового відкидає своїх (src/lib/rep-feed/internal.ts).
  const internalCtx = await loadInternalContext();
  const noCounterparty: PlanCandidate[] = [];

  for (const r of rows) {
    // Документ без контрагента: LEFT JOIN не дав ні імені, ні координат —
    // це не «немає піна», це «нема кому ставити пін». Перевіряємо раніше
    // за координати, бо в такого рядка lat/lng теж NULL, і без цієї
    // перевірки він осів би в noPin з порожнім іменем.
    if (r.counterpartyId === null) {
      noCounterparty.push({
        salesDocumentId: r.id,
        number: r.number,
        counterpartyId: "",
        name: "без контрагента",
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        amount: r.amount,
        createdAt: r.created_at,
      });
      continue;
    }

    const c: PlanCandidate = {
      salesDocumentId: r.id,
      number: r.number,
      counterpartyId: r.counterpartyId,
      name: r.name ?? "",
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      amount: r.amount,
      createdAt: r.created_at,
    };

    // Внутрішніх відсіюємо ПЕРШИМИ: у складу є і пін, і адреса, тож інакше
    // він осів би просто в points як звичайний клієнт.
    if (r.counterpartyId !== null && isInternalClient({ id: r.counterpartyId, name: r.name ?? "" }, internalCtx)) {
      internal.push(c);
      continue;
    }

    if (c.lat === null || c.lng === null) {
      noPin.push(c);
      continue;
    }
    if (
      c.lat < DELIVERY_BBOX.latMin || c.lat > DELIVERY_BBOX.latMax ||
      c.lng < DELIVERY_BBOX.lngMin || c.lng > DELIVERY_BBOX.lngMax
    ) {
      outOfZone.push(c);
      continue;
    }
    points.push(c);
  }

  return { points, noPin, internal, outOfZone, noCounterparty };
}
