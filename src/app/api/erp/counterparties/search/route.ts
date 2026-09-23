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
import { clientQuery, counterpartyIdsByWords, loose } from "@/lib/search/client-words";
import { stem } from "@/lib/assistant/facts/search-words";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
/** Скільки карток тягнемо на ранжування: збіг по селу дає десятки рядків. */
const CANDIDATES = 200;
/** Більше п'яти слів у запиті — це вже речення, а не «прізвище + село». */
const MAX_TOKENS = 5;

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

  /*
   * Слова — після тієї ж чистки, що й у помічника (search/client-words.ts):
   * «Яцків» знаходить «Яцьків», «Мар'ян» — «Мар`ян», «у Перемишлянах» —
   * «(м.Перемишляни)». Раніше тут були лише два види апострофа з трьох і
   * жодного мʼякого знака, і на «Яцків Перемишляни» редактор маршрутів
   * відповідав порожнім списком.
   */
  const tokens = clientQuery(q)
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, MAX_TOKENS);

  // Один символ шукати немає сенсу: під «К» підпадає пів бази.
  if (tokens.length === 0) return NextResponse.json({ items: [] });

  const candidateIds = await counterpartyIdsByWords(tokens.join(" "), CANDIDATES);
  const found = candidateIds.length
    ? await prisma.counterparty.findMany({
        where: { id: { in: candidateIds } },
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
      })
    : [];

  // Порівнюємо так само, як шукали: без мʼякого знака й апострофа, по основі.
  const lower = tokens.map((t) => stem(loose(t)));

  const scored = found.map((c) => {
    const name = loose(c.name);
    const addr = loose(`${c.address ?? ""} ${c.deliveryAddress ?? ""}`);

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
