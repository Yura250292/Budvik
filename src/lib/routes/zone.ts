/**
 * Що лежить у зоні напрямку: реальний потенціал для розпрацювання.
 *
 * Вкладка «Маршрути» досі відповідала на питання «куди торговий їде».
 * Тут — інше питання: «кого він при цьому проїжджає повз». Різниця
 * практична: у базі 3694 контрагенти, з них лише 486 щось брали за
 * півроку. Решта — або сплячі, або чужі, або взагалі ніколи не куплені.
 * Показати їх списком безглуздо; показати тих, хто стоїть за 10 км від
 * сьогоднішньої дороги, — це вже готовий план на день.
 *
 * Чотири шари, у порядку спадання певності:
 *   1. OTHER_REP  — клієнт у зоні, закріплений за іншим торговим (або ні за ким)
 *   2. WINBACK    — сплячий/втрачений у зоні: був клієнтом, перестав брати
 *   3. PROSPECT   — точка, поставлена вручну на карті (ProspectClient)
 *   4. WHITE_SPOT — населений пункт у зоні, де немає ЖОДНОГО клієнта
 *
 * Про білі плями чесно: довідника населених пунктів у базі немає, тож
 * вони будуються з тих НП, які вже фігурують в адресах контрагентів і
 * мають координати. Це показує «село, де є контрагенти, але ніхто не
 * купує», але НЕ покаже село, якого в базі немає взагалі. Повне покриття
 * вимагало б імпорту КОАТУУ/OSM — окрема робота, і без неї цифра «білих
 * плям» є нижньою оцінкою, а не істиною.
 */

import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/analytics/period";
import { clientPortfolioAll, type ClientState } from "@/lib/analytics/clients";
import { CorridorIndex, corridorAxis, type LatLng } from "./corridor";

/** Радіус коридору за замовчуванням — година об'їзду туди-назад по районних дорогах. */
export const DEFAULT_RADIUS_KM = 10;
export const MIN_RADIUS_KM = 2;
export const MAX_RADIUS_KM = 40;

export type ZoneOpportunityKind = "OTHER_REP" | "WINBACK" | "PROSPECT" | "WHITE_SPOT";

/** Стани, які вважаємо приводом заїхати: клієнт був, а зараз не бере. */
const WINBACK_STATES: ClientState[] = ["SLIPPING", "DORMANT", "LOST"];

export type ZoneOpportunity = {
  kind: ZoneOpportunityKind;
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Скільки км від осі маршруту — головне число для сортування */
  distanceKm: number;
  address: string | null;
  state: ClientState | null;
  /** Оборот за період; для білих плям і проспектів — null */
  amount: number | null;
  daysSinceLast: number | null;
  receivable: number | null;
  /** Торгові, за якими закріплений (порожньо — нічий) */
  reps: Array<{ id: string; name: string }>;
  /** Точність координати: MANUAL/GEOCODED/CITY — щоб не гнати торгового в центр села */
  geoSource: string | null;
  /** Для WHITE_SPOT: скільки контрагентів у цьому НП і чому вони не рахуються */
  spotCount: number | null;
};

export type ZoneSummary = {
  /** Клієнти напрямку — ті, що в зоні і закріплені за призначеним торговим */
  ownClients: number;
  ownRevenue: number;
  opportunities: number;
  byKind: Record<ZoneOpportunityKind, number>;
  /** Скільки в зоні сплячих/втрачених грошей: їхній оборот за період */
  winbackRevenue: number;
  /** Точок, які не змогли покласти на карту (немає координат) — контекст до цифр */
  unmappedInRegion: number;
};

export type ZoneResult = {
  templateId: string;
  templateName: string;
  radiusKm: number;
  /** Осьова лінія коридору для малювання смуги на мапі */
  axis: LatLng[];
  summary: ZoneSummary;
  opportunities: ZoneOpportunity[];
  /** Торгові, призначені на цей напрямок (за розкладом або датою) */
  assignedReps: Array<{ id: string; name: string }>;
};

/** Нормалізує назву НП для групування: «м. Стрий» і «Стрий» — одне й те саме. */
export function normalizeSettlement(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(м\.|с\.|смт\.?|селище|місто|село)\s*/i, "")
    .replace(/[«»"'`]/g, "")
    .trim();
}

/**
 * Витягує назву населеного пункту з адреси контрагента.
 *
 * Адреси в 1С пишуться неоднорідно: «Стрий, Шевченка 12», «м. Ходорів вул.
 * Грушевського», «Львівська обл., Жидачів». Беремо перший сегмент, який не
 * схожий на область/район/вулицю — саме він у переважній більшості записів
 * і є НП. Це евристика, і вона свідомо консервативна: краще не визначити
 * пункт, ніж приписати клієнта не тому селу.
 */
export function settlementFromAddress(address: string | null): string | null {
  if (!address?.trim()) return null;

  const parts = address
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    // Область і район — це контекст, а не пункт.
    //
    // Межі слова тут задані явними класами, а не \b: у JS без прапорця
    // \b рахує межу за латиницею, тож «обл» усередині кириличного слова
    // не відсікалося, і «Львівська обл.» проходило як назва пункту.
    if (/(^|[\s.])обл(асть|\.|\s|$)|(^|[\s.])р-н|(^|[\s.])район/i.test(part)) continue;
    // Вулиця, провулок, проспект — це вже адреса всередині пункту.
    if (/(^|[\s.])(вул|вулиц|пров|просп|бульв|пл|наб|м-н|буд|кв)[\s.]/i.test(part)) continue;
    // Голий номер будинку.
    if (/^\d+[а-яa-z]?$/i.test(part)) continue;

    const cleaned = part.replace(/\s+\d+[а-яa-z]?$/i, "").trim();
    if (cleaned.length >= 3) return cleaned;
  }

  return null;
}

type ProspectRow = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  status: string;
  assignedRep: { id: string; name: string } | null;
};

/**
 * Рахує зону для одного напрямку.
 *
 * Уся фільтрація — в пам'яті, а не в SQL: клієнтів з координатами кілька
 * сотень, і портфель з їхніми станами вже й так тягнеться одним запитом
 * для карти. Спроба звузити вибірку в базі коштувала б PostGIS або
 * кривої box-евристики, а виграла б мілісекунди.
 */
export async function computeZone(
  templateId: string,
  period: Period,
  radiusKm: number
): Promise<ZoneResult | null> {
  const template = await prisma.routeTemplate.findUnique({
    where: { id: templateId },
    include: {
      stops: { orderBy: { seq: "asc" } },
      assignments: { include: { rep: { select: { id: true, name: true } } } },
    },
  });
  if (!template) return null;

  const axis = corridorAxis(
    template.routeGeometry as { coordinates?: [number, number][] } | null,
    template.stops.map((s) => ({ lat: s.lat, lng: s.lng }))
  );
  const index = new CorridorIndex(axis);

  const [portfolio, prospects] = await Promise.all([
    clientPortfolioAll(period),
    prisma.prospectClient.findMany({
      where: { status: { in: ["NEW", "IN_PROGRESS"] } },
      select: {
        id: true,
        name: true,
        address: true,
        lat: true,
        lng: true,
        status: true,
        assignedRep: { select: { id: true, name: true } },
      },
    }) as Promise<ProspectRow[]>,
  ]);

  // Торгові цього напрямку: і разові призначення, і постійний розклад.
  // Дублікати прибираємо — одна людина зазвичай має і weekday-правило,
  // і разові заміни на той самий напрямок.
  const repMap = new Map<string, { id: string; name: string }>();
  for (const a of template.assignments) {
    if (a.rep) repMap.set(a.rep.id, { id: a.rep.id, name: a.rep.name });
  }
  const assignedReps = [...repMap.values()];
  const assignedRepIds = new Set(repMap.keys());

  const opportunities: ZoneOpportunity[] = [];
  const byKind: Record<ZoneOpportunityKind, number> = {
    OTHER_REP: 0,
    WINBACK: 0,
    PROSPECT: 0,
    WHITE_SPOT: 0,
  };

  let ownClients = 0;
  let ownRevenue = 0;
  let winbackRevenue = 0;

  /** НП, у яких є хоч один клієнт із покупками — щоб не назвати їх білою плямою. */
  const settlementsWithBuyers = new Set<string>();
  /** НП у зоні та їхня репрезентативна координата. */
  const spotsInZone = new Map<
    string,
    { name: string; lat: number; lng: number; distanceKm: number; count: number }
  >();

  for (const c of portfolio.clients) {
    if (c.lat == null || c.lng == null) continue;

    const distanceKm = index.distanceKm({ lat: c.lat, lng: c.lng });
    if (distanceKm > radiusKm) continue;

    const settlement = settlementFromAddress(c.address);
    const isOwn = c.reps.some((r) => assignedRepIds.has(r.id));
    const isWinback = WINBACK_STATES.includes(c.state);

    // Клієнт із покупками «займає» свій НП: біла пляма — це пункт БЕЗ
    // жодного покупця, а не пункт, де хтось із них спить.
    if (settlement && !isWinback) settlementsWithBuyers.add(normalizeSettlement(settlement));

    if (isOwn && !isWinback) {
      ownClients += 1;
      ownRevenue += c.amount;
      continue;
    }

    const base = {
      id: c.counterpartyId,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      distanceKm,
      address: c.address,
      state: c.state,
      amount: c.amount,
      daysSinceLast: c.daysSinceLast,
      receivable: c.receivable,
      reps: c.reps,
      geoSource: c.geoSource,
      spotCount: null,
    };

    // Сплячий свій — це привід заїхати, і це важливіше за «чужий»:
    // повернути того, хто вже купував, дешевше, ніж відбити чужого.
    if (isWinback) {
      opportunities.push({ ...base, kind: "WINBACK" });
      byKind.WINBACK += 1;
      winbackRevenue += c.amount;
    } else {
      opportunities.push({ ...base, kind: "OTHER_REP" });
      byKind.OTHER_REP += 1;
    }
  }

  for (const p of prospects) {
    const distanceKm = index.distanceKm({ lat: p.lat, lng: p.lng });
    if (distanceKm > radiusKm) continue;

    opportunities.push({
      kind: "PROSPECT",
      id: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      distanceKm,
      address: p.address,
      state: null,
      amount: null,
      daysSinceLast: null,
      receivable: null,
      reps: p.assignedRep ? [p.assignedRep] : [],
      geoSource: "MANUAL",
      spotCount: null,
    });
    byKind.PROSPECT += 1;
  }

  // Білі плями: НП у коридорі, у яких є контрагенти з координатами, але
  // жоден нічого не брав за період. Беремо з Counterparty напряму — там є
  // й ті, кого немає в портфелі (портфель будується від документів).
  const geoCounterparties = await prisma.counterparty.findMany({
    where: { deliveryLat: { not: null }, deliveryLng: { not: null }, isActive: true },
    select: { id: true, name: true, address: true, deliveryLat: true, deliveryLng: true },
  });

  for (const cp of geoCounterparties) {
    if (cp.deliveryLat == null || cp.deliveryLng == null) continue;

    const distanceKm = index.distanceKm({ lat: cp.deliveryLat, lng: cp.deliveryLng });
    if (distanceKm > radiusKm) continue;

    const settlement = settlementFromAddress(cp.address);
    if (!settlement) continue;

    const key = normalizeSettlement(settlement);
    if (settlementsWithBuyers.has(key)) continue;

    const existing = spotsInZone.get(key);
    if (existing) {
      existing.count += 1;
      // Тримаємо найближчу до маршруту координату — саме туди зручно заїхати.
      if (distanceKm < existing.distanceKm) {
        existing.lat = cp.deliveryLat;
        existing.lng = cp.deliveryLng;
        existing.distanceKm = distanceKm;
      }
    } else {
      spotsInZone.set(key, {
        name: settlement,
        lat: cp.deliveryLat,
        lng: cp.deliveryLng,
        distanceKm,
        count: 1,
      });
    }
  }

  for (const [key, spot] of spotsInZone) {
    opportunities.push({
      kind: "WHITE_SPOT",
      id: `spot:${key}`,
      name: spot.name,
      lat: spot.lat,
      lng: spot.lng,
      distanceKm: spot.distanceKm,
      address: null,
      state: null,
      amount: null,
      daysSinceLast: null,
      receivable: null,
      reps: [],
      geoSource: null,
      spotCount: spot.count,
    });
    byKind.WHITE_SPOT += 1;
  }

  // Сортування за відстанню: перші рядки списку — те, що зачепиш майже
  // без гака. Всередині однакової відстані вперед іде більший оборот.
  opportunities.sort((a, b) => a.distanceKm - b.distanceKm || (b.amount ?? 0) - (a.amount ?? 0));

  const unmappedInRegion = portfolio.clients.filter((c) => c.lat == null || c.lng == null).length;

  return {
    templateId: template.id,
    templateName: template.name,
    radiusKm,
    axis,
    summary: {
      ownClients,
      ownRevenue,
      opportunities: opportunities.length,
      byKind,
      winbackRevenue,
      unmappedInRegion,
    },
    opportunities,
    assignedReps,
  };
}

/** Затискає радіус у допустимі межі; нечислове значення → типове. */
export function clampRadius(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_RADIUS_KM;
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, Math.round(value)));
}
