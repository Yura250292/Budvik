/**
 * Наскрізна перевірка «маршрут із пошуку по базі» на тимчасових даних.
 *
 * Запуск (потрібен піднятий npm run dev):
 *   npx tsx scripts/check-route-client-search.ts
 *
 * Що перевіряємо. Логіст складає маршрут не накладними, а пам'яттю:
 * «Коваль Жовтанці». Такий запит не збігається цілком ані з назвою картки
 * («Коваль Андрій (смт.Жовтанці)»), ані з адресою — і саме тому пошук
 * б'ється на слова. Помилку в цьому видно лише на живих написаннях адрес із
 * 1С, тож тимчасові картки тут навмисно повторюють їхній формат.
 *
 * Друга половина перевірки — точка БЕЗ накладної: вона має створюватися,
 * не дублюватися і рахуватися водієві як звичайна тарифна доставка.
 *
 * Створює контрагентів і маршрут із маркером __e2e_clsearch__, ганяє
 * реальні HTTP-запити з підробленою сесією і прибирає за собою.
 */

import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const p = new PrismaClient();

const BASE = process.env.ROUTE_CHECK_BASE ?? "http://localhost:3000";
const SECRET = process.env.NEXTAUTH_SECRET!;

const MARK = "__e2e_clsearch__";
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(
    `${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`
  );
}

async function main() {
  const admin = await p.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, email: true, name: true } });
  if (!admin) {
    console.log("ADMIN у базі немає — перевірку неможливо провести.");
    process.exit(1);
  }

  // Назви й адреси в форматі 1С: прізвище в назві, село в дужках і в адресі.
  const [pinned, noPin] = await Promise.all([
    p.counterparty.create({
      data: {
        name: `Ковальчук Тест (смт.Жовтанці) ${MARK}`,
        address: "смт.Жовтанці, вул.Івана Франка 2Г маг.Тест",
        deliveryLat: 49.9581,
        deliveryLng: 24.2372,
        geoSource: "MANUAL",
        receivableBalance: 1200,
      },
    }),
    p.counterparty.create({
      data: {
        // Без координати взагалі — саме такому клієнту UI одразу відкриває карту.
        name: `Налисник Тест (м.Стрий) ${MARK}`,
        address: "м.Стрий, вул.Обаля 2 маг.Тест",
      },
    }),
  ]);

  const token = await encode({
    token: { sub: admin.id, id: admin.id, email: admin.email, name: admin.name, role: "ADMIN", boltsBalance: 0 },
    secret: SECRET,
  });
  const cookie = `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;
  const H = { "Content-Type": "application/json", Cookie: cookie };

  const get = async (path: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  type Item = { id: string; name: string; address: string | null; lat: number | null; geoSource: string | null; debt: number };
  const search = async (q: string) => {
    const r = await get(`/api/erp/counterparties/search?q=${encodeURIComponent(q)}`);
    return { status: r.status, items: (r.body?.items ?? []) as Item[] };
  };

  // --- 1. Пошук словами в довільному порядку ---
  const byBoth = await search("Ковальчук Жовтанці");
  check("GET /counterparties/search → 200", byBoth.status === 200, byBoth.status);
  check(
    "«прізвище + село» знаходить картку",
    byBoth.items.some((c) => c.id === pinned.id),
    byBoth.items.map((c) => c.name)
  );

  const reversed = await search("жовтанці ковальчук");
  check(
    "Порядок слів і регістр не важать",
    reversed.items.some((c) => c.id === pinned.id),
    reversed.items.map((c) => c.name)
  );

  const villageOnly = await search("Жовтанці");
  check(
    "Пошук лише по селу теж знаходить",
    villageOnly.items.some((c) => c.id === pinned.id),
    villageOnly.items.length
  );

  const nobody = await search("Ковальчук Стрий");
  check(
    "Слово, якого немає в картці, відсікає її",
    !nobody.items.some((c) => c.id === pinned.id),
    nobody.items.map((c) => c.name)
  );

  const row = byBoth.items.find((c) => c.id === pinned.id);
  check("Стан піна віддається рядком", row?.geoSource === "MANUAL" && row?.lat === 49.9581, row);
  check("Борг видно ще в підказці", row?.debt === 1200, row?.debt);

  const noPinRow = (await search("Налисник Стрий")).items.find((c) => c.id === noPin.id);
  check("Клієнт без координати знаходиться", !!noPinRow, noPinRow);
  check("У нього порожній пін — UI відкриє карту", noPinRow?.lat === null, noPinRow);

  // --- 2. Маршрут із самих клієнтів, без жодної накладної ---
  const created = await post("/api/erp/delivery-routes", {
    date: new Date().toISOString().slice(0, 10),
    notes: MARK,
    salesDocumentIds: [],
    counterpartyIds: [pinned.id],
  });
  check("POST /delivery-routes лише з клієнтами → 201", created.status === 201, created);
  const routeId: string = created.body?.id;
  check("Точка створена з картки клієнта", created.body?.stops?.length === 1, created.body?.stops);
  check(
    "Адресу взято з картки",
    created.body?.stops?.[0]?.address === pinned.address,
    created.body?.stops?.[0]?.address
  );

  // --- 3. Додавання клієнта в наявний маршрут ---
  const added = await post(`/api/erp/delivery-routes/${routeId}/add-stop`, {
    kind: "DELIVERY",
    counterpartyId: noPin.id,
    address: noPin.address,
  });
  check("POST /add-stop з клієнтом → 201", added.status === 201, added);
  check("Точка тарифна: без накладної і без ручної ціни",
    added.body?.stop?.salesDocumentId === null && added.body?.stop?.payOverride === null,
    added.body?.stop);
  check("Друга точка отримала номер 2", added.body?.stop?.sequence === 2, added.body?.stop?.sequence);

  const dupe = await post(`/api/erp/delivery-routes/${routeId}/add-stop`, {
    kind: "DELIVERY",
    counterpartyId: noPin.id,
  });
  check("Той самий клієнт удруге → 409", dupe.status === 409, dupe);

  const orphan = await post(`/api/erp/delivery-routes/${routeId}/add-stop`, { kind: "DELIVERY" });
  check("DELIVERY без клієнта й накладної → 400", orphan.status === 400, orphan);

  // --- 4. Маршрут читається назад із іменами клієнтів ---
  const back = await get(`/api/erp/delivery-routes/${routeId}`);
  check("GET /delivery-routes/[id] → 200", back.status === 200, back.status);
  const names = (back.body?.stops ?? []).map((s: { counterparty?: { name: string } }) => s.counterparty?.name);
  check("Обидві точки на місці, з іменами", names.length === 2 && names.every(Boolean), names);

  // --- Прибирання ---
  if (routeId) {
    await p.deliveryStop.deleteMany({ where: { deliveryRouteId: routeId } });
    await p.deliveryRoute.delete({ where: { id: routeId } });
  }
  await p.counterparty.deleteMany({ where: { name: { contains: MARK } } });

  const leftovers =
    (await p.counterparty.count({ where: { name: { contains: MARK } } })) +
    (await p.deliveryRoute.count({ where: { notes: MARK } }));
  check("Тестові дані прибрано повністю", leftovers === 0, leftovers);

  await p.$disconnect();
  console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ПАДІННЯ:", e);
  await p.counterparty.deleteMany({ where: { name: { contains: MARK } } }).catch(() => {});
  await p.$disconnect();
  process.exit(1);
});
