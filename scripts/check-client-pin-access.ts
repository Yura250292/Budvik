/**
 * Хто може посунути пін клієнта.
 *
 * Запуск (потрібен піднятий npm run dev):
 *   npx tsx scripts/check-client-pin-access.ts
 *
 * Заради чого. Торгові в компанії працюють однією командою: клієнти спільні,
 * і будь-хто з них може стояти біля дверей магазину, який формально «не його».
 * Правило, яке пускало чужого лише поставити ПЕРШИЙ пін, на практиці било
 * рівно по тому, хто цей пін і ставив: наступного разу той самий торговий
 * свою ж точку виправити вже не міг — вона стала MANUAL, а клієнт лишився
 * чужим. Цей скрипт тримає межу: торговому відкриті всі клієнти, а чужим
 * ролям — жодного.
 *
 * Створює тимчасових користувачів і контрагента з маркером __e2e_pin__,
 * ганяє реальні HTTP-запити і прибирає за собою.
 */
import { PrismaClient, type Role } from "@prisma/client";
import { encode } from "next-auth/jwt";

const p = new PrismaClient();
const BASE = process.env.PIN_CHECK_BASE ?? "http://localhost:3000";
const SECRET = process.env.NEXTAUTH_SECRET!;
const MARK = "__e2e_pin__";

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
  return `next-auth.session-token=${t}; __Secure-next-auth.session-token=${t}`;
}

const movePin = async (cpId: string, cookie: string, lat: number, lng: number) => {
  const r = await fetch(`${BASE}/api/admin/client-map/${cpId}`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, accuracyM: 12 }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

async function cleanup() {
  await p.counterparty.deleteMany({ where: { name: { startsWith: MARK } } });
  await p.user.deleteMany({ where: { email: { startsWith: MARK } } });
}

async function main() {
  await cleanup();

  const rep1 = await p.user.create({ data: { email: `${MARK}rep1@test.local`, name: `${MARK} Торговий`, role: "SALES" } });
  const rep2 = await p.user.create({ data: { email: `${MARK}rep2@test.local`, name: `${MARK} Колега`, role: "SALES" } });
  const driver = await p.user.create({ data: { email: `${MARK}driver@test.local`, name: `${MARK} Водій`, role: "DRIVER" } });
  const buyer = await p.user.create({ data: { email: `${MARK}buyer@test.local`, name: `${MARK} Покупець`, role: "CLIENT" } });

  const c1 = await cookieFor(rep1);
  const c2 = await cookieFor(rep2);
  const cDriver = await cookieFor(driver);
  const cBuyer = await cookieFor(buyer);

  /** Клієнт НІЧИЙ: ні закріплення, ні документів — саме такий і є типовим. */
  const cp = await p.counterparty.create({
    data: {
      name: `${MARK} Магазин`,
      type: "CUSTOMER",
      deliveryLat: 49.84,
      deliveryLng: 24.03,
      geoSource: "GEOCODED",
    },
  });

  // --- Торговий і чужий клієнт ---
  const first = await movePin(cp.id, c1, 49.8401, 24.0301);
  check("Торговий ставить точку чужому клієнту → 200", first.status === 200, first);

  /**
   * Те саме місце, той самий торговий, хвилину потому. Саме тут скарга й
   * жила: пін уже MANUAL, клієнт і далі не закріплений — і автор власного
   * піна діставав 403.
   */
  const again = await movePin(cp.id, c1, 49.8405, 24.0309);
  check("Той самий торговий виправляє свою ж точку → 200", again.status === 200, again);

  const colleague = await movePin(cp.id, c2, 49.8411, 24.0315);
  check("Інший торговий виправляє точку колеги → 200", colleague.status === 200, colleague);

  const saved = await p.counterparty.findUnique({
    where: { id: cp.id },
    select: { deliveryLat: true, deliveryLng: true, geoSource: true, geoById: true, geoAccuracyM: true },
  });
  check("У базі лежить остання точка", Math.abs((saved?.deliveryLat ?? 0) - 49.8411) < 1e-6, saved);
  check("Джерело MANUAL", saved?.geoSource === "MANUAL", saved);
  check("Автор — той, хто рухав останнім", saved?.geoById === rep2.id, saved);
  check("Точність GPS збережена", saved?.geoAccuracyM === 12, saved);

  // --- Межа лишається там, де була ---
  const byBuyer = await movePin(cp.id, cBuyer, 50.45, 30.52);
  check("Покупець точку не рухає → 403", byBuyer.status === 403, byBuyer);

  const byDriver = await movePin(cp.id, cDriver, 50.45, 30.52);
  check("Водій, який туди не їздив → 403", byDriver.status === 403, byDriver);

  const noAuth = await fetch(`${BASE}/api/admin/client-map/${cp.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 50.45, lng: 30.52 }),
  });
  check("Без входу → 401", noAuth.status === 401, noAuth.status);

  const stillOurs = await p.counterparty.findUnique({ where: { id: cp.id }, select: { deliveryLat: true } });
  check("Відмовлені спроби точку не зрушили", Math.abs((stillOurs?.deliveryLat ?? 0) - 49.8411) < 1e-6, stillOurs);

  await cleanup();
  const left = await p.counterparty.count({ where: { name: { startsWith: MARK } } });
  check("Сміття в базі не лишилось", left === 0, { left });

  console.log(failed === 0 ? "\nВсе зелене." : `\n${failed} перевірок впало.`);
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch(async (e) => {
    console.error(e);
    await cleanup();
    process.exit(1);
  })
  .finally(() => p.$disconnect());
