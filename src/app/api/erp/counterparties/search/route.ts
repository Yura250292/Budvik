/**
 * Пошук клієнта одним рядком: «Коваль Жовтанці».
 *
 * Логіст складає маршрут не за накладними, а за пам'яттю: прізвище і село.
 * Загальний /api/erp/counterparties шукає ВЕСЬ рядок цілком і лише в одному
 * полі, тому «Коваль Жовтанці» не збігається ні з іменем («ФОП Коваль І.І.»),
 * ні з адресою («Жовтанці, Шевченка 3») — і не знаходить нічого. Тут запит
 * б'ється на слова, і кожне слово має знайтися хоч в одному полі картки.
 *
 * Тип контрагента не фільтруємо навмисно: у 1С половина клієнтів заведена як
 * BOTH, а забрати товар у постачальника — теж точка маршруту. Неактивних теж
 * віддаємо, лише опускаємо в хвіст: краще показати зайве, ніж не знайти
 * клієнта, якого в 1С колись погасили.
 *
 * Окремий вузький маршрут, а не параметр загального списку: тому не рахує
 * прострочку по кожному знайденому (агрегація на 1000 карток) і віддає лише
 * те, що видно в рядку підказки.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, CABINET_ROLES } from "@/lib/app/identity";
import { settlementFromAddress } from "@/lib/routes/zone";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
/** Скільки карток тягнемо на ранжування: збіг по селу дає десятки рядків. */
const CANDIDATES = 200;
/** Більше п'яти слів у запиті — це вже речення, а не «прізвище + село». */
const MAX_TOKENS = 5;

// Той самий апостроф у 1С і з клавіатури пишеться різними символами, а
// ILIKE порівнює коди. Для test() окремий регексп без /g: глобальний
// тримає lastIndex між викликами й через раз відповідає «не знайшов».
const APOSTROPHE = /['’ʼ`´]/;
const APOSTROPHE_G = /['’ʼ`´]/g;

/** «Мар'ян» і «Мар’ян» — те саме слово, різні коди символу. */
function variants(token: string): string[] {
  if (!APOSTROPHE.test(token)) return [token];
  return ["'", "’"].map((a) => token.replace(APOSTROPHE_G, a));
}

/** Слово на межі слова важить більше, ніж будь-де всередині рядка. */
function startsWord(haystack: string, token: string): boolean {
  const at = haystack.indexOf(token);
  if (at <= 0) return at === 0;
  return /[\s"«»(),.«\-/]/.test(haystack[at - 1]);
}

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? searchParams.get("search") ?? "").trim();

  const limitRaw = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/[«»"(),.;:]/g, "").trim())
    .filter((t) => t.length >= 2)
    .slice(0, MAX_TOKENS);

  // Один символ шукати немає сенсу: під «К» підпадає пів бази.
  if (tokens.length === 0) return NextResponse.json({ items: [] });

  const and = tokens.map((t) => ({
    OR: variants(t).flatMap((v) => [
      { name: { contains: v, mode: "insensitive" as const } },
      { address: { contains: v, mode: "insensitive" as const } },
      { deliveryAddress: { contains: v, mode: "insensitive" as const } },
      { contactPerson: { contains: v, mode: "insensitive" as const } },
      { code: { contains: v, mode: "insensitive" as const } },
    ]),
  }));

  const found = await prisma.counterparty.findMany({
    where: { AND: and },
    take: CANDIDATES,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      phone: true,
      type: true,
      isActive: true,
      address: true,
      deliveryAddress: true,
      deliveryLat: true,
      deliveryLng: true,
      geoSource: true,
      deliveryZone: true,
      receivableBalance: true,
    },
  });

  const lower = tokens.map((t) => t.toLowerCase());

  const scored = found.map((c) => {
    const name = c.name.toLowerCase();
    const addr = `${c.address ?? ""} ${c.deliveryAddress ?? ""}`.toLowerCase();

    let score = 0;
    for (const t of lower) {
      // Збіг в імені важить більше за збіг в адресі: «Коваль» у назві —
      // це той клієнт, «Ковальська» у вулиці — випадковий сусід.
      if (name.includes(t)) score += startsWord(name, t) ? 4 : 3;
      else if (addr.includes(t)) score += startsWord(addr, t) ? 2 : 1;
      else score += 0.5; // лишається код або контактна особа
    }
    if (!c.isActive) score -= 3;
    if (c.type === "SUPPLIER") score -= 2;

    return { c, score };
  });

  scored.sort(
    (a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name, "uk")
  );
  const page = scored.slice(0, limit);

  // Остання відвантажена реалізація — підказка «чи возили туди взагалі».
  // Рахуємо лише по тих, що поїдуть у відповідь: індекс
  // [counterpartyId, docType, createdAt] робить це десятком рядків.
  const ids = page.map((s) => s.c.id);
  const shipments = ids.length
    ? await prisma.salesDocument.groupBy({
        by: ["counterpartyId"],
        where: { counterpartyId: { in: ids }, docType: "REALIZATION" },
        _max: { createdAt: true },
      })
    : [];
  const lastById = new Map(
    shipments.map((r) => [r.counterpartyId as string, r._max.createdAt])
  );

  return NextResponse.json({
    items: page.map(({ c }) => {
      // Адреса доставки б'є юридичну: водій їде саме туди.
      const address = c.deliveryAddress?.trim() || c.address?.trim() || null;
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        phone: c.phone,
        type: c.type,
        isActive: c.isActive,
        address,
        settlement: settlementFromAddress(address),
        lat: c.deliveryLat,
        lng: c.deliveryLng,
        geoSource: c.geoSource,
        deliveryZone: c.deliveryZone,
        debt: c.receivableBalance ?? 0,
        lastShipmentAt: lastById.get(c.id) ?? null,
      };
    }),
  });
}
