/**
 * Наскрізна перевірка API застосунку покупця на тимчасових даних.
 *
 * Запуск (потрібен піднятий npm run dev):
 *   npx tsx scripts/check-mobile-api.ts
 *
 * Прогін проти проду:
 *   MOBILE_CHECK_BASE=https://www.budvik27.com npx tsx scripts/check-mobile-api.ts
 *
 * Створює покупця, категорію і товар із маркером __e2e_mobile__, ганяє
 * реальні HTTP-запити і прибирає за собою. Остання перевірка підтверджує,
 * що в базі не лишилося сміття.
 *
 * Потрібен, бо тестового раннера в проєкті немає, а цей шлях торкається
 * грошей і залишків: ядро створення замовлення спільне для сайту й
 * застосунку, і розбіжність тут — це неправильна сума в чеку або залишок,
 * загнаний у мінус.
 *
 * Окремо перевіряє межу між контурами токенів: токен покупця не має
 * пускатися в трекінг торгових, і навпаки.
 */
import { PrismaClient } from "@prisma/client";
import { issueShopToken } from "../src/lib/shop/app-token.ts";
import { issueDeviceToken, verifyDeviceToken } from "../src/lib/track/device-token.ts";
import { verifyShopToken } from "../src/lib/shop/app-token.ts";

const p = new PrismaClient();

const BASE = process.env.MOBILE_CHECK_BASE ?? "http://localhost:3000";

const MARK = "__e2e_mobile__";

/**
 * Кратність тестового товару.
 *
 * Не 1 навмисно: саме округлення до пачки — те, що застосунок і сервер
 * рахують окремо, і єдине місце, де вони можуть тихо розійтися.
 */
const PACK = 10;
const PRICE = 123.45;
const STOCK = 100;

let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(
    `${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`
  );
}

async function api(
  path: string,
  init: { method?: string; token?: string | null; body?: unknown } = {}
) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* не JSON — лишаємо null, перевірка нижче це помітить */
  }
  return { status: res.status, json, text };
}

async function main() {
  // --- Підготовка --------------------------------------------------------
  const category = await p.category.create({
    data: { name: `${MARK} Категорія`, slug: `${MARK}-cat` },
  });

  const product = await p.product.create({
    data: {
      name: `${MARK} Тестовий свердел кратно ${PACK}шт`,
      slug: `${MARK}-tovar`,
      sku: `${MARK}-SKU`,
      description:
        "Характеристики:\n• Довжина: 100 мм\n• Матеріал: HSS\n\nКомплектація:\n• Свердел 1 шт\n\nЗвичайний абзац опису.",
      price: PRICE,
      stock: STOCK,
      packQty: PACK,
      image: "https://files.budvik27.com/products/e2e.jpg",
      isActive: true,
      categoryId: category.id,
    },
  });

  const email = `${MARK}client@test.local`;
  const buyer = await p.user.create({
    data: { email, name: `${MARK} Покупець`, role: "CLIENT", boltsBalance: 0 },
  });
  const token = await issueShopToken(buyer.id, MARK);

  console.log(`\nБаза: ${BASE}\n`);

  // --- Публічні роути ----------------------------------------------------
  const config = await api("/config");
  check("GET /config віддає ставки Болтів", config.json?.boltsCashbackRate === 0.05, config.json);

  const card = await api(`/products/${product.slug}`);
  check("GET /products/:slug знаходить товар", card.status === 200 && card.json?.id === product.id);
  check("картка несе packQty", card.json?.packQty === PACK, card.json?.packQty);
  check(
    "характеристики розібрано на пари",
    card.json?.sections?.specs?.[0]?.key === "Довжина" &&
      card.json.sections.specs[0].value === "100 мм",
    card.json?.sections?.specs
  );
  check(
    "комплектацію розібрано на рядки",
    Array.isArray(card.json?.sections?.kit) && card.json.sections.kit.length === 1,
    card.json?.sections?.kit
  );
  check(
    "категорія службовою не показується",
    card.json?.label === `${MARK} Категорія`,
    card.json?.label
  );

  const missing = await api("/products/take-tovaru-tochno-nemaye");
  check("неіснуючий slug → 404", missing.status === 404, missing.status);

  // --- Сканер ------------------------------------------------------------
  const bySku = await api(`/lookup?code=${encodeURIComponent(`${MARK}-SKU`)}`);
  check("lookup за артикулом", bySku.json?.match === "sku" && bySku.json?.product?.id === product.id);

  const byQr = await api(
    `/lookup?code=${encodeURIComponent(`https://www.budvik27.com/catalog/${product.slug}`)}`
  );
  check("lookup за власним QR", byQr.json?.match === "qr" && byQr.json?.product?.id === product.id);

  await p.product.update({ where: { id: product.id }, data: { barcodes: ["4820999999999"] } });
  const byBarcode = await api("/lookup?code=4820999999999");
  check(
    "lookup за штрихкодом виробника",
    byBarcode.json?.match === "barcode" && byBarcode.json?.product?.id === product.id,
    byBarcode.json?.match
  );

  const noMatch = await api("/lookup?code=0000000000000");
  check("невпізнаний код не помилка, а match:none", noMatch.status === 200 && noMatch.json?.match === "none");

  // --- Авторизація -------------------------------------------------------
  const anon = await api("/me");
  check("GET /me без токена → 401", anon.status === 401, anon.status);

  const bogus = await api("/me", { token: "bdvks_vygadanyi" });
  check("GET /me з вигаданим токеном → 401", bogus.status === 401, bogus.status);

  const me = await api("/me", { token });
  check("GET /me з токеном віддає профіль", me.json?.user?.id === buyer.id, me.json?.user);

  // --- Межа між контурами токенів ---------------------------------------
  const rep = await p.user.findFirst({ where: { role: "SALES" }, select: { id: true } });
  if (rep) {
    const trackToken = await issueDeviceToken(rep.id, MARK);
    check("токен магазину відхиляється трекінгом", (await verifyDeviceToken(`Bearer ${token}`)) === null);
    check("токен планшета відхиляється магазином", (await verifyShopToken(`Bearer ${trackToken}`)) === null);
    check("токен планшета приймається трекінгом", (await verifyDeviceToken(`Bearer ${trackToken}`)) !== null);
  } else {
    console.log("• ролі SALES у базі немає — перевірку межі пропущено");
  }

  // --- Замовлення --------------------------------------------------------
  const badOrder = await api("/orders", { method: "POST", token, body: { items: [] } });
  check("порожній кошик → 400", badOrder.status === 400 && badOrder.json?.error === "Кошик порожній");

  /**
   * Замовляємо 7 штук товару, який продається по 10.
   *
   * Сервер мусить округлити вгору до 10 — саме це округлення застосунок
   * повторює у себе в кошику, і саме тут вони можуть розійтися.
   */
  const order = await api("/orders", {
    method: "POST",
    token,
    body: {
      items: [{ productId: product.id, quantity: 7 }],
      contactName: `${MARK} Покупець`,
      phone: "0671112233",
      deliveryMethod: "PICKUP",
    },
  });
  check("замовлення створено", order.status === 200 && !!order.json?.id, order.json);

  const created = order.json?.id
    ? await p.order.findUnique({ where: { id: order.json.id }, include: { items: true } })
    : null;

  check("кількість округлено вгору до пачки", created?.items[0]?.quantity === PACK, created?.items[0]?.quantity);
  check("ціна взята з бази, а не з клієнта", created?.items[0]?.price === PRICE, created?.items[0]?.price);
  check("сума = ціна × кратність", created?.totalAmount === PRICE * PACK, created?.totalAmount);
  check("замовлення прив'язане до покупця", created?.userId === buyer.id);
  check("гостьового токена в акаунта немає", created?.guestToken === null, created?.guestToken);

  const afterOrder = await p.product.findUnique({ where: { id: product.id }, select: { stock: true } });
  check("склад списано рівно на пачку", afterOrder?.stock === STOCK - PACK, afterOrder?.stock);

  const history = await api("/orders", { token });
  check(
    "замовлення видно в історії",
    Array.isArray(history.json?.orders) && history.json.orders.some((o: any) => o.id === created?.id)
  );

  // --- Гостьове замовлення ----------------------------------------------
  const guest = await api("/orders", {
    method: "POST",
    body: {
      items: [{ productId: product.id, quantity: PACK }],
      contactName: `${MARK} Гість`,
      phone: "0671112244",
      deliveryMethod: "PICKUP",
    },
  });
  check("гість може замовити без входу", guest.status === 200 && !!guest.json?.guestToken, guest.json);

  // --- Більше, ніж є на складі ------------------------------------------
  const tooMuch = await api("/orders", {
    method: "POST",
    token,
    body: {
      items: [{ productId: product.id, quantity: STOCK * 2 }],
      contactName: `${MARK} Покупець`,
      phone: "0671112233",
      deliveryMethod: "PICKUP",
    },
  });
  check("замовлення понад залишок відхилено", tooMuch.status === 400, tooMuch.status);

  // --- Обране ------------------------------------------------------------
  const wlEmpty = await api("/wishlist", { token });
  check("обране спершу порожнє", Array.isArray(wlEmpty.json?.items) && wlEmpty.json.items.length === 0);

  const wlAdd = await api("/wishlist", { method: "POST", token, body: { productId: product.id } });
  check("товар додано в обране", wlAdd.status === 200, wlAdd.json);

  const wlAgain = await api("/wishlist", { method: "POST", token, body: { productId: product.id } });
  check("повторне додавання не помилка", wlAgain.status === 200, wlAgain.status);

  const wl = await api("/wishlist", { token });
  check(
    "обране віддає картку товару",
    wl.json?.items?.length === 1 && wl.json.items[0].id === product.id,
    wl.json?.items
  );

  const wlBad = await api("/wishlist", { method: "POST", token, body: { productId: "nemaye" } });
  check("неіснуючий товар в обране → 404", wlBad.status === 404, wlBad.status);

  const wlDel = await api(`/wishlist?productId=${product.id}`, { method: "DELETE", token });
  check("товар прибрано з обраного", wlDel.status === 200);

  const wlAfter = await api("/wishlist", { token });
  check("обране знову порожнє", wlAfter.json?.items?.length === 0, wlAfter.json?.items);

  const wlAnon = await api("/wishlist");
  check("обране без токена → 401", wlAnon.status === 401, wlAnon.status);

  // --- Пуш-токени --------------------------------------------------------
  const pushBad = await api("/push/register", {
    method: "POST",
    token,
    body: { token: "не-схоже-на-токен", platform: "ios" },
  });
  check("некоректний пуш-токен відхилено", pushBad.status === 400, pushBad.status);

  const pushToken = `ExponentPushToken[${MARK}]`;
  const pushOk = await api("/push/register", {
    method: "POST",
    token,
    body: { token: pushToken, platform: "android", appVersion: "1.0.0" },
  });
  check("пристрій зареєстровано для сповіщень", pushOk.status === 200, pushOk.json);

  const pushRow = await p.pushToken.findUnique({ where: { token: pushToken } });
  check("токен привʼязано до покупця", pushRow?.userId === buyer.id);

  const pushOff = await api("/push/unregister", { method: "POST", token, body: { token: pushToken } });
  check("відписка спрацювала", pushOff.status === 200);
  const pushAfter = await p.pushToken.findUnique({ where: { token: pushToken } });
  check("токен відкликано, а не видалено", pushAfter?.revokedAt !== null, pushAfter?.revokedAt);

  // --- Стеля на частоту --------------------------------------------------
  await p.rateLimit.deleteMany({ where: { key: { contains: MARK } } });
  let hit429 = false;
  for (let i = 0; i < 12; i++) {
    const r = await api("/auth/login", {
      method: "POST",
      body: { email: `${MARK}@nemaye.local`, password: "x" },
    });
    if (r.status === 429) {
      hit429 = true;
      break;
    }
  }
  check("підбір пароля впирається в стелю", hit429);
  await p.rateLimit.deleteMany({
    where: { OR: [{ key: { contains: MARK } }, { key: { startsWith: "login:ip:" } }] },
  });

  // --- Видалення акаунта -------------------------------------------------
  const del = await api("/me", { method: "DELETE", token });
  check("видалення акаунта без пароля (акаунт без пароля)", del.status === 200, del.json);

  const afterDelete = await p.user.findUnique({
    where: { id: buyer.id },
    select: { email: true, name: true, phone: true },
  });
  check("персональні дані затерто", afterDelete?.name === "Видалений акаунт", afterDelete);
  check("email замінено на технічний", afterDelete?.email?.startsWith("deleted-") === true, afterDelete?.email);

  const deadToken = await api("/me", { token });
  check("токен після видалення мертвий", deadToken.status === 401, deadToken.status);

  const ordersKept = await p.order.count({ where: { userId: buyer.id } });
  check("замовлення видаленого покупця збережено", ordersKept > 0, ordersKept);

  // --- Прибирання --------------------------------------------------------
  await p.orderItem.deleteMany({ where: { productId: product.id } });
  await p.order.deleteMany({
    where: { OR: [{ userId: buyer.id }, { contactName: { startsWith: MARK } }] },
  });
  await p.boltsTransaction.deleteMany({ where: { userId: buyer.id } });
  await p.pushToken.deleteMany({ where: { userId: buyer.id } });
  await p.wishlistItem.deleteMany({ where: { userId: buyer.id } });
  await p.deviceToken.deleteMany({ where: { deviceName: MARK } });
  await p.user.deleteMany({ where: { email: { contains: MARK } } });
  await p.user.deleteMany({ where: { email: { startsWith: `deleted-${buyer.id}` } } });
  await p.product.delete({ where: { id: product.id } });
  await p.category.delete({ where: { id: category.id } });

  const leftovers =
    (await p.product.count({ where: { slug: { contains: MARK } } })) +
    (await p.category.count({ where: { slug: { contains: MARK } } })) +
    (await p.user.count({ where: { name: { contains: MARK } } })) +
    (await p.order.count({ where: { contactName: { contains: MARK } } })) +
    (await p.deviceToken.count({ where: { deviceName: MARK } })) +
    (await p.pushToken.count({ where: { token: { contains: MARK } } })) +
    (await p.rateLimit.count({ where: { key: { contains: MARK } } }));
  check("у базі не лишилося тимчасових даних", leftovers === 0, leftovers);

  console.log(failed === 0 ? "\nУСЕ ЗЕЛЕНЕ\n" : `\nПРОВАЛЕНО ПЕРЕВІРОК: ${failed}\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
