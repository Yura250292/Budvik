/**
 * Перевірка роутів «Приходу»: хто пускається і що віддається.
 *
 * Доступ до розділу переїхав з «ADMIN + SALES» на «ADMIN + MANAGER», і це
 * єдина зміна, яку неможливо перевірити типами: ролі прописані в чотирьох
 * місцях (меню, middleware, сторінка, API), і розходження між ними саме й
 * дало стан, коли пункт бачили всі, а сторінка пускала не тих.
 *
 * Друга половина — заборона правити документи 1С на сайті: PATCH мусить
 * віддавати 409, інакше локальна правка проживе до наступного циклу обміну.
 *
 * Сервер НЕ потрібен: обробники викликаються напряму, а впізнання йде
 * через Bearer — роути кабінету приймають кукі й токен пристрою нарівні
 * (resolveIdentity), тож ролі перевіряються тим самим кодом, що й у бою.
 *
 *   npx tsx -r dotenv/config scripts/check-purchase-api.ts dotenv_config_path=.env
 */
import { PrismaClient } from "@prisma/client";
import { issueDeviceToken } from "../src/lib/track/device-token";
import { GET as listGET } from "../src/app/api/erp/purchase-orders/route";
import { GET as cardGET, PATCH as cardPATCH } from "../src/app/api/erp/purchase-orders/[id]/route";
import { POST as cancelPOST } from "../src/app/api/erp/purchase-orders/[id]/cancel/route";
import type { NextRequest } from "next/server";

const p = new PrismaClient();
const BASE = "http://localhost";
const MARK = `__e2e_purchase_${Date.now()}__`;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

/** Запит із Bearer-токеном — так само, як його бачить роут у проді. */
function reqWith(token: string | null, path: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`${BASE}${path}`, { ...init, headers }) as unknown as NextRequest;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function json(res: Response) {
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  const users: Record<string, { id: string; email: string; token: string }> = {};
  for (const role of ["ADMIN", "MANAGER", "SALES"] as const) {
    const email = `${MARK}${role.toLowerCase()}@budvik.local`;
    const u = await p.user.create({ data: { email, name: `${MARK} ${role}`, role }, select: { id: true, email: true } });
    users[role] = { ...u, token: await issueDeviceToken(u.id, "перевірка приходу") };
  }

  const supplier = await p.counterparty.create({
    data: { name: `${MARK} постачальник`, type: "SUPPLIER" },
    select: { id: true },
  });
  const product = await p.product.findFirst({ select: { id: true } });
  if (!product) throw new Error("У базі немає жодного товару");

  // Документ «з 1С»: саме він має бути недоторканим на сайті.
  const oneC = await p.purchaseOrder.create({
    data: {
      number: `${MARK}-1c`,
      externalId: `${MARK}-external`,
      supplierId: supplier.id,
      status: "CONFIRMED",
      totalAmount: 100,
      createdById: users.ADMIN.id,
      items: { create: [{ productId: product.id, quantity: 1, purchasePrice: 100, lineNo: 1 }] },
    },
    select: { id: true },
  });

  try {
    const get = async (path: string, token: string | null) =>
      json(await listGET(reqWith(token, path)));

    const admin = users.ADMIN.token;
    const manager = users.MANAGER.token;
    const sales = users.SALES.token;

    console.log("Доступ до списку");
    {
      const a = await get("/api/erp/purchase-orders?from=2020-01-01&to=2030-01-01", admin);
      check("ADMIN отримує список", a.status === 200 && Array.isArray(a.body?.items), a.status);
      check("є зведення за фільтром", typeof a.body?.summary?.count === "number", a.body?.summary);

      const m = await get("/api/erp/purchase-orders?from=2020-01-01&to=2030-01-01", manager);
      check("MANAGER отримує список", m.status === 200, m.status);

      const s = await get("/api/erp/purchase-orders", sales);
      check("SALES не пускається (403)", s.status === 403, s.status);

      // Мертвий токен, а не порожній заголовок: без Authorization
      // resolveIdentity іде в getServerSession, а той поза HTTP-запитом
      // не має де взяти заголовки. У проді ця гілка працює, тут же
      // перевіряємо ту саму відмову шляхом, доступним поза сервером.
      const dead = await get("/api/erp/purchase-orders", "bdvk_deadtoken");
      check("мертвий токен — 401", dead.status === 401, dead.status);
    }

    console.log("\nФільтр за джерелом");
    {
      const only1c = await get("/api/erp/purchase-orders?from=2020-01-01&to=2030-01-01&source=1c", admin);
      const ids = (only1c.body?.items ?? []).map((i: { id: string }) => i.id);
      check("документ з 1С у вибірці", ids.includes(oneC.id), ids.length);

      const onlySite = await get("/api/erp/purchase-orders?from=2020-01-01&to=2030-01-01&source=site", admin);
      const siteIds = (onlySite.body?.items ?? []).map((i: { id: string }) => i.id);
      check("його немає серед документів сайту", !siteIds.includes(oneC.id), siteIds.length);
    }

    console.log("\nДовідник постачальників для фільтра");
    {
      const f = await get("/api/erp/purchase-orders?facet=suppliers", admin);
      check("віддає масив", f.status === 200 && Array.isArray(f.body), f.status);
      check(
        "містить постачальника перевірки",
        (f.body ?? []).some((s: { id: string }) => s.id === supplier.id)
      );
    }

    console.log("\nДокумент 1С недоторканий");
    {
      const card = await json(
        await cardGET(reqWith(admin, `/api/erp/purchase-orders/${oneC.id}`), params(oneC.id))
      );
      check("картка відкривається", card.status === 200 && card.body?.externalId === `${MARK}-external`, card.status);
      check("рядки з номером", card.body?.items?.[0]?.lineNo === 1, card.body?.items?.[0]);

      const patch = await json(
        await cardPATCH(
          reqWith(admin, `/api/erp/purchase-orders/${oneC.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: "спроба правки" }),
          }),
          params(oneC.id)
        )
      );
      check("PATCH відмовляє з 409", patch.status === 409, patch.status);

      const cancel = await json(
        await cancelPOST(
          reqWith(admin, `/api/erp/purchase-orders/${oneC.id}/cancel`, { method: "POST" }),
          params(oneC.id)
        )
      );
      check("скасувати не можна", cancel.status === 400, cancel.status);

      const after = await p.purchaseOrder.findUnique({ where: { id: oneC.id }, select: { status: true, notes: true } });
      check("статус і примітки не змінились", after?.status === "CONFIRMED" && after?.notes === null, after);
    }
  } finally {
    await p.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: oneC.id } });
    await p.purchaseOrder.deleteMany({ where: { id: oneC.id } });
    await p.counterparty.deleteMany({ where: { id: supplier.id } });
    await p.deviceToken.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
    await p.user.deleteMany({ where: { email: { startsWith: MARK } } });
    console.log("\nТимчасові дані прибрано.");
  }

  console.log(failed ? `\n${failed} перевірок не зійшлося.` : "\nУсе зійшлося.");
  await p.$disconnect();
  process.exit(failed ? 1 : 0);
}

main();
