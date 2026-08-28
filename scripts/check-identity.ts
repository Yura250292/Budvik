/**
 * Наскрізна перевірка: кабінетне API однаково пускає кукі й токен пристрою.
 *
 * Запуск (потрібен піднятий npm run dev):
 *   npx tsx scripts/check-identity.ts
 *
 * Заради чого. Кабінет торгового й водія переїжджає у нативні екрани по одному
 * за реліз, і кожен такий екран ходить у ті самі роути з Bearer-токеном замість
 * кукі. Питання, на яке відповідає цей скрипт: чи справді обидва шляхи дають
 * ОДНЕ І ТЕ САМЕ — і в тому, що видно, і в тому, що заборонено. Розбіжність тут
 * означала б, що застосунок показує людині не її дані.
 *
 * Створює тимчасових користувачів і документи з маркером __e2e_identity__,
 * ганяє реальні HTTP-запити і прибирає за собою. Остання перевірка підтверджує,
 * що в базі не лишилося сміття.
 */
import { PrismaClient, type Role } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { issueDeviceToken, revokeDeviceToken, hashToken } from "../src/lib/track/device-token";
import { issueShopToken } from "../src/lib/shop/app-token";

const p = new PrismaClient();
const BASE = process.env.IDENTITY_CHECK_BASE ?? "http://localhost:3000";
const SECRET = process.env.NEXTAUTH_SECRET!;
const MARK = "__e2e_identity__";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

async function cookieFor(u: { id: string; email: string | null; name: string | null; role: Role }) {
  const t = await encode({
    token: { sub: u.id, id: u.id, email: u.email, name: u.name, role: u.role, boltsBalance: 0 },
    secret: SECRET,
  });
  // Обидва імені — як у /api/device/session: локально протокол і NEXTAUTH_URL розходяться.
  return `next-auth.session-token=${t}; __Secure-next-auth.session-token=${t}`;
}

type Res = { status: number; body: unknown };
const req = async (path: string, headers: Record<string, string>, init?: RequestInit): Promise<Res> => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
};

async function main() {
  // Прибирання і на старті: зірваний попередній прогін не має блокувати наступний.
  await cleanup();

  // --- Підготовка ---
  const sales = await p.user.create({
    data: { email: `${MARK}sales@test.local`, name: `${MARK} Торговий`, role: "SALES" },
  });
  const otherRep = await p.user.create({
    data: { email: `${MARK}rep2@test.local`, name: `${MARK} Колега`, role: "SALES" },
  });
  const driver = await p.user.create({
    data: { email: `${MARK}driver@test.local`, name: `${MARK} Водій`, role: "DRIVER" },
  });
  const shopper = await p.user.create({
    data: { email: `${MARK}client@test.local`, name: `${MARK} Покупець`, role: "CLIENT" },
  });

  const salesCookie = { Cookie: await cookieFor(sales) };
  const driverCookie = { Cookie: await cookieFor(driver) };

  const salesToken = await issueDeviceToken(sales.id, "e2e");
  const driverToken = await issueDeviceToken(driver.id, "e2e");
  const shopToken = await issueShopToken(shopper.id, "e2e");
  const deadToken = await issueDeviceToken(sales.id, "e2e-dead");
  const deadRow = await p.deviceToken.findUnique({ where: { tokenHash: hashToken(deadToken) }, select: { id: true } });
  await revokeDeviceToken(deadRow!.id);

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  // --- 1. Кукі й токен дають однакову відповідь ---
  const PATHS = [
    "/api/shift/current",
    "/api/sales/my-map?scope=all",
    "/api/erp/sales?status=DRAFT",
    "/api/erp/counterparties?mine=1",
    "/api/tablet/day",
    "/api/notifications",
    "/api/account/profile",
    "/api/app/staff/version",
  ];
  for (const path of PATHS) {
    const viaCookie = await req(path, salesCookie);
    const viaToken = await req(path, bearer(salesToken));
    // /api/app/staff/version віддає 503, поки збірки в сховищі немає — це теж
    // однаково для обох шляхів, і саме однаковість тут перевіряється.
    check(`${path}: кукі й токен дають той самий код`, viaCookie.status === viaToken.status, {
      cookie: viaCookie.status, token: viaToken.status,
    });
    if (viaCookie.status === 200 && viaToken.status === 200) {
      const a = JSON.stringify(Object.keys((viaCookie.body ?? {}) as object).sort());
      const b = JSON.stringify(Object.keys((viaToken.body ?? {}) as object).sort());
      check(`${path}: однаковий набір полів`, a === b, { cookie: a, token: b });
    }
  }

  // --- 2. Чужі й мертві токени ---
  const noAuth = await req("/api/tablet/day", {});
  check("Без авторизації → 401", noAuth.status === 401, noAuth);
  const withShop = await req("/api/tablet/day", bearer(shopToken));
  check("Токен магазину в кабінет → 401", withShop.status === 401, withShop);
  const withDead = await req("/api/tablet/day", bearer(deadToken));
  check("Відкликаний токен → 401", withDead.status === 401, withDead);
  const garbage = await req("/api/tablet/day", bearer("bdvk_nosuchtoken"));
  check("Сміття замість токена → 401", garbage.status === 401, garbage);
  // Кирилиця в заголовку неможлива фізично (ByteString), тож токен ASCII.

  /**
   * Найтонше місце: заголовок є, але токен мертвий, а кукі жива.
   * Падати на кукі не можна — інакше «вимкнути загублений пристрій» не працює.
   */
  const deadPlusCookie = await req("/api/tablet/day", { ...salesCookie, ...bearer(deadToken) });
  check("Мертвий токен НЕ падає на живу кукі → 401", deadPlusCookie.status === 401, deadPlusCookie);

  // --- 3. Роль: 403, а не 401 ---
  const driverOnSales = await req("/api/erp/counterparties?mine=1", bearer(driverToken));
  check("Водій у роут торгового → 403", driverOnSales.status === 403, driverOnSales);
  const driverOnSalesCookie = await req("/api/erp/counterparties?mine=1", driverCookie);
  check("Те саме через кукі → 403", driverOnSalesCookie.status === 403, driverOnSalesCookie);

  // --- 4. Торговий бачить лише своє ---
  const doc = await p.salesDocument.create({
    data: { number: `${MARK}СД-1`, docType: "ORDER", salesRepId: otherRep.id, totalAmount: 100, createdById: otherRep.id },
  });
  const foreign = await req(`/api/erp/sales?salesRepId=${otherRep.id}`, bearer(salesToken));
  const foreignIds = Array.isArray(foreign.body) ? (foreign.body as { id: string }[]).map((d) => d.id) : [];
  check("Чужі документи не видно через токен", !foreignIds.includes(doc.id), { status: foreign.status, count: foreignIds.length });
  const foreignCookie = await req(`/api/erp/sales?salesRepId=${otherRep.id}`, salesCookie);
  const foreignCookieIds = Array.isArray(foreignCookie.body) ? (foreignCookie.body as { id: string }[]).map((d) => d.id) : [];
  check("…і через кукі теж", !foreignCookieIds.includes(doc.id), { count: foreignCookieIds.length });

  // --- 4б. Деталі зміни: тільки своя ---
  /**
   * Роут `/api/shift/[id]` віддає фото одометра, пробіг і трек. Він рахує
   * зарплату, тож питання «чия це зміна» тут не про зручність: id — cuid,
   * але вгадувати його не треба, досить побачити чужий у будь-якому списку.
   * Чужа зміна мусить давати 404, а не 403: існування чужої зміни теж не
   * стосується того, хто питає.
   */
  const ownShift = await p.shift.create({
    data: { userId: sales.id, startOdometer: 100000, startOdometerSource: "MANUAL", notes: MARK },
  });
  const foreignShift = await p.shift.create({
    data: { userId: otherRep.id, startOdometer: 200000, startOdometerSource: "MANUAL", notes: MARK },
  });

  const mine = await req(`/api/shift/${ownShift.id}`, bearer(salesToken));
  check("Своя зміна через токен → 200", mine.status === 200, mine.status);
  const mineBody = (mine.body ?? {}) as { shift?: { id?: string }; track?: { pointsCount?: number } };
  check("…і це справді вона", mineBody.shift?.id === ownShift.id, mineBody.shift?.id);
  check("…з лічильником точок", typeof mineBody.track?.pointsCount === "number", mineBody.track);

  const alien = await req(`/api/shift/${foreignShift.id}`, bearer(salesToken));
  check("Чужа зміна → 404", alien.status === 404, alien.status);
  const alienCookie = await req(`/api/shift/${foreignShift.id}`, salesCookie);
  check("…і через кукі теж 404", alienCookie.status === 404, alienCookie.status);
  const shiftNoAuth = await req(`/api/shift/${ownShift.id}`, {});
  check("Деталі зміни без авторизації → 401", shiftNoAuth.status === 401, shiftNoAuth.status);

  // --- 5. Створення документа: чужий торговий і нестача складу ---
  const category = await p.category.create({ data: { name: `${MARK} Категорія`, slug: `${MARK}-cat` } });
  const product = await p.product.create({
    data: {
      name: `${MARK} Товар`,
      slug: `${MARK}-tovar`,
      sku: `${MARK}-1`,
      description: "Тимчасовий товар для перевірки авторизації.",
      price: 100,
      stock: 5,
      categoryId: category.id,
    },
  });
  const J = { "Content-Type": "application/json" };

  const onOther = await req("/api/erp/sales", { ...bearer(salesToken), ...J }, {
    method: "POST",
    body: JSON.stringify({ salesRepId: otherRep.id, items: [{ productId: product.id, quantity: 1, sellingPrice: 100 }] }),
  });
  check("POST створено", onOther.status === 201, onOther.status);
  check(
    "Торговий не може оформити на колегу — документ пішов на нього самого",
    (onOther.body as { salesRepId?: string } | null)?.salesRepId === sales.id,
    (onOther.body as { salesRepId?: string } | null)?.salesRepId
  );

  const tooMuch = await req("/api/erp/sales", { ...bearer(salesToken), ...J }, {
    method: "POST",
    body: JSON.stringify({ items: [{ productId: product.id, quantity: 999, sellingPrice: 100 }] }),
  });
  check("Нестача складу → 409, а не 500", tooMuch.status === 409, tooMuch);
  check("…і з назвою товару в тексті", String((tooMuch.body as { error?: string } | null)?.error ?? "").includes(MARK), tooMuch.body);

  await cleanup();

  const leftovers2 =
    (await p.user.count({ where: { email: { startsWith: MARK } } })) +
    (await p.salesDocument.count({ where: { number: { startsWith: MARK } } })) +
    (await p.product.count({ where: { sku: { startsWith: MARK } } }));
  check("Тестові дані прибрано повністю", leftovers2 === 0, leftovers2);

  await p.$disconnect();
  console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

/**
 * Прибирання окремою функцією: скрипт ганяє реальні запити в бойову схему, і
 * падіння посеред матриці не має лишати за собою користувачів і документи.
 */
async function cleanup() {
  const users = await p.user.findMany({
    where: { email: { startsWith: MARK } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  const docs = await p.salesDocument.findMany({
    where: { OR: [{ number: { startsWith: MARK } }, { salesRepId: { in: userIds } }] },
    select: { id: true },
  });
  const docIds = docs.map((d) => d.id);

  await p.stockReservation.deleteMany({ where: { salesDocumentId: { in: docIds } } });
  await p.salesDocumentItem.deleteMany({ where: { salesDocumentId: { in: docIds } } });
  await p.salesDocument.deleteMany({ where: { id: { in: docIds } } });
  await p.product.deleteMany({ where: { sku: { startsWith: MARK } } });
  await p.category.deleteMany({ where: { slug: { startsWith: MARK } } });
  await p.deviceToken.deleteMany({ where: { userId: { in: userIds } } });
  await p.notification.deleteMany({ where: { userId: { in: userIds } } });
  await p.user.deleteMany({ where: { id: { in: userIds } } });
}

main().catch(async (e) => {
  console.error("ПАДІННЯ:", e);
  await cleanup().catch(() => {});
  await p.$disconnect();
  process.exit(1);
});
