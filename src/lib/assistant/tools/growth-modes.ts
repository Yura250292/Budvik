/**
 * Режими sales_analysis про точки росту: mode=gaps (хто недокуповує) і
 * mode=prospects (потенційні клієнти по дорозі). Логіка — analytics/growth.ts,
 * тут лише імена людей, фільтри й відповідь людською мовою.
 */

import { str } from "@/lib/assistant/validate";
import { uah } from "@/lib/assistant/format";
import { listStaff, repKinds, resolveStaff, staffProblem } from "@/lib/assistant/facts/staff";
import { WEEKDAY_NAMES } from "@/lib/assistant/facts/route-habits";
import {
  GAP_ACTIVE_DAYS,
  PROSPECT_RADIUS_ADDRESS_KM,
  PROSPECT_RADIUS_CITY_KM,
  assignProspects,
  brandKey,
  findBrandGaps,
  loadClientBrandMatrix,
  loadProspects,
  loadRepClientPoints,
  loadStockBrands,
  normalizeCategory,
} from "@/lib/analytics/growth";

async function repFilter(args: Record<string, unknown>) {
  if (typeof args.rep !== "string" || !args.rep.trim()) return { ok: true as const, id: null };
  const match = await resolveStaff(str(args.rep, "rep", { min: 2, max: 60 }), ["SALES"]);
  if (!match.ok) return { ok: false as const, problem: staffProblem(match, "торгового") };
  return { ok: true as const, id: match.user.id };
}

/** sales_analysis mode=gaps — хто недокуповує бренди, які беруть схожі клієнти. */
export async function brandGapsReport(args: Record<string, unknown>) {
  const rep = await repFilter(args);
  if (!rep.ok) return rep.problem;
  const brandQ = typeof args.brand === "string" && args.brand.trim() ? brandKey(args.brand) : null;

  const [rows, stock, staff] = await Promise.all([loadClientBrandMatrix(12), loadStockBrands(), listStaff(["SALES"])]);
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const all = findBrandGaps(rows, { stockBrands: new Set(stock.keys()) });
  const gaps = all.filter((g) => (!rep.id || g.repId === rep.id) && (!brandQ || g.brandKey.includes(brandQ)));

  const group = <K extends string>(key: (g: (typeof gaps)[number]) => K) => {
    const m = new Map<K, { clients: Set<string>; estimate: number; pairs: typeof gaps }>();
    for (const g of gaps) {
      const k = key(g);
      const row = m.get(k) ?? { clients: new Set(), estimate: 0, pairs: [] };
      row.clients.add(g.clientId);
      row.estimate += g.estimate;
      row.pairs.push(g);
      m.set(k, row);
    }
    return [...m.entries()].sort((a, b) => b[1].estimate - a[1].estimate);
  };
  const pair = (g: (typeof gaps)[number]) => ({
    клієнт_id: g.clientId,
    клієнт: g.clientName,
    торговий: g.repId ? nameOf.get(g.repId) ?? "—" : "—",
    бренд: g.brandName,
    схожих_клієнтів: g.peers,
    з_них_беруть: g.buyers,
    частка_бренду_у_схожих_відсотків: Math.round(g.walletShare * 1000) / 10,
    оборот_клієнта_за_рік: uah(g.clientTotal),
    оцінка_на_рік: uah(g.estimate),
  });

  return {
    разом: {
      клієнтів_з_прогалинами: new Set(gaps.map((g) => g.clientId)).size,
      пар_клієнт_бренд: gaps.length,
      оцінка_обороту_на_рік: uah(gaps.reduce((s, g) => s + g.estimate, 0)),
    },
    по_брендах: group((g) => g.brandName)
      .slice(0, 15)
      .map(([бренд, r]) => ({ бренд, клієнтів: r.clients.size, оцінка_на_рік: uah(r.estimate), позицій_на_складі: stock.get(brandKey(бренд)) ?? 0 })),
    по_торгових: group((g) => (g.repId ? nameOf.get(g.repId) ?? "—" : "без торгового"))
      .slice(0, 12)
      .map(([торговий, r]) => ({ торговий, клієнтів: r.clients.size, оцінка_на_рік: uah(r.estimate), найбільші: r.pairs.slice(0, 3).map(pair) })),
    найбільші_можливості: gaps.slice(0, 25).map(pair),
    примітка: `«Схожі» — клієнти з 3+ спільними брендами за рік; бренд радимо, коли його беруть щонайменше 3 схожі й не менше 30% з них, і він є на складі. Оцінка = медіанна частка бренду в закупівлях схожих × річний оборот клієнта — це орієнтир «скільки можна взяти», а не прогноз. Лише клієнти, що купували за ${GAP_ACTIVE_DAYS} днів. По одному клієнту з конкретним товаром — client_profile / поради торговому.`,
  };
}

/** sales_analysis mode=prospects — потенційні клієнти по дорозі торгових. */
export async function prospectsReport(args: Record<string, unknown>) {
  const rep = await repFilter(args);
  if (!rep.ok) return rep.problem;
  const category = typeof args.category === "string" ? normalizeCategory(args.category) : null;

  const [kinds, staff, prospects] = await Promise.all([repKinds(), listStaff(["SALES"]), loadProspects()]);
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const field = [...kinds.entries()].filter(([, k]) => k === "польовий").map(([id]) => id);
  const clients = await loadRepClientPoints(field);
  const placed = assignProspects(
    prospects.filter((p) => !category || p.category === category),
    clients
  );
  const onRoute = placed.filter((p) => p.repId && (!rep.id || p.repId === rep.id));
  const off = placed.filter((p) => p.unplaced === "far");
  const noAddress = placed.filter((p) => p.unplaced === "no_address");

  const byRep = new Map<string, typeof onRoute>();
  for (const p of onRoute) byRep.set(p.repId!, [...(byRep.get(p.repId!) ?? []), p]);
  const catRank = (c: string | null) => (c ? "ABCD".indexOf(c) : 9);
  const point = (p: (typeof onRoute)[number]) => ({
    назва: p.name,
    категорія: p.category,
    тип: p.outletType,
    спеціалізація: p.specialization,
    місто: p.city,
    день: p.weekday === null ? null : WEEKDAY_NAMES[p.weekday],
    найближчий_клієнт: p.nearestClient,
    км: p.nearestKm,
    пін: p.precision === "MANUAL" ? "уточнено на карті" : p.precision === "ADDRESS" ? "адреса" : "лише місто",
  });

  const offByCity = new Map<string, number>();
  for (const p of off) offByCity.set(p.city ?? "—", (offByCity.get(p.city ?? "—") ?? 0) + 1);

  return {
    разом: {
      точок: placed.length,
      по_дорозі_в_польових_торгових: placed.filter((p) => p.repId).length,
      поза_маршрутами: off.length,
      в_обласному_центрі_без_адреси: noAddress.length,
    },
    по_торгових: [...byRep.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([id, pts]) => {
        const days = new Map<string, number>();
        for (const p of pts) {
          const d = p.weekday === null ? "день невідомий" : WEEKDAY_NAMES[p.weekday];
          days.set(d, (days.get(d) ?? 0) + 1);
        }
        const cats = new Map<string, number>();
        for (const p of pts) cats.set(p.category ?? "?", (cats.get(p.category ?? "?") ?? 0) + 1);
        return {
          торговий: nameOf.get(id) ?? "—",
          точок: pts.length,
          по_днях: Object.fromEntries(days),
          по_категоріях: Object.fromEntries([...cats.entries()].sort()),
          найперші: [...pts].sort((a, b) => catRank(a.category) - catRank(b.category) || (a.nearestKm ?? 99) - (b.nearestKm ?? 99)).slice(0, 8).map(point),
        };
      }),
    без_адреси_по_містах: Object.fromEntries(
      [...noAddress.reduce((m, p) => m.set(p.city ?? "—", (m.get(p.city ?? "—") ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])
    ),
    поза_маршрутами_по_містах: [...offByCity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([місто, точок]) => ({ місто, точок })),
    примітка: `Точка «по дорозі» в польового торгового, чиї клієнти стоять поруч: до ${PROSPECT_RADIUS_ADDRESS_KM} км для піна за адресою чи уточненого на карті, до ${PROSPECT_RADIUS_CITY_KM} км для піна лише по місту (центр населеного пункту). День — коли сусідні клієнти цього торгового зазвичай беруть товар за пів року. Категорія A–D і спеціалізація — з самої бази. Точки обласного центру (Львів) з піном лише по місту нікому не приписано: пін у центрі міста, відстань нічого не каже — їх треба уточнити на карті, і тоді вони стануть на маршрут. Нікого не закріплює: закріпити точку за торговим — на карті клієнтів. «Поза маршрутами» — там, де польові торгові клієнтів не мають: або новий напрямок, або не наша територія.`,
  };
}
