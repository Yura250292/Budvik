/**
 * Наскрізна перевірка автозакриття змін і звірки наступного дня.
 *
 * Запуск (потрібен піднятий npm run dev для HTTP-частини):
 *   npx tsx scripts/check-shift-auto-close.ts
 *
 * Розбір живих даних без жодного запису:
 *   npx tsx scripts/check-shift-auto-close.ts --dry
 *
 * Створює торгового з маркером __e2e_autoclose__, малює синтетичні
 * треки («їде до 18:40, потім стоїть», «трек обірвався опівдні») і
 * перевіряє, ЩО саме вирішить система в кожному випадку та о котрій
 * годині. Прибирає за собою.
 *
 * Потрібен, бо помилка тут — це помилка в кілометрах, а кілометри — це
 * зарплата: закрити зміну на дві години раніше означає відняти в людини
 * реальну роботу, на дві пізніше — записати їй вечір.
 */
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { autoCloseStaleShifts, decideForShift } from "../src/lib/shift/auto-close";
import { issueDeviceToken } from "../src/lib/track/device-token";
import { confirmShift, loadForConfirm } from "../src/lib/shift/confirm";
import { autoCloseNote, closeWithoutPhoto } from "../src/lib/shift/reconcile";
import { POST as shiftOpenHandler } from "../src/app/api/shift/open/route";
import { POST as shiftCloseHandler } from "../src/app/api/shift/close/route";
import { GET as shiftCurrentHandler } from "../src/app/api/shift/current/route";
import { POST as shiftConfirmHandler } from "../src/app/api/shift/[id]/confirm/route";
import { POST as shiftReopenHandler } from "../src/app/api/shift/[id]/reopen/route";

const p = new PrismaClient();
const BASE = process.env.SHIFT_CHECK_BASE ?? "http://localhost:3000";
const MARK = "__e2e_autoclose__";

/**
 * Роути торгового викликаємо НАПРЯМУ, а не через HTTP.
 *
 * Причина не в швидкості: після міграції Prisma запущений `next dev`
 * тримає в пам'яті клієнт, згенерований до неї, і кожен запит до нових
 * полів падає з 500, поки сервер не перезапустять. Перевірка не має
 * залежати від того, чи хтось це зробив, — вона про код, а не про стан
 * чужого процесу. Bearer-шлях у `requireRoles` до `cookies()` не
 * доходить, тож контекст Next тут не потрібен.
 */
function bearerReq(url: string, token: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const api = {
  open: (token: string, body: unknown) => shiftOpenHandler(bearerReq("/api/shift/open", token, body)),
  close: (token: string, body: unknown) => shiftCloseHandler(bearerReq("/api/shift/close", token, body)),
  current: (token: string) => shiftCurrentHandler(bearerReq("/api/shift/current", token)),
  confirm: (token: string, id: string, body: unknown) =>
    shiftConfirmHandler(bearerReq(`/api/shift/${id}/confirm`, token, body), {
      params: Promise.resolve({ id }),
    }),
  reopen: (token: string, id: string) =>
    shiftReopenHandler(bearerReq(`/api/shift/${id}/reopen`, token, {}), {
      params: Promise.resolve({ id }),
    }),
};

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

/** Момент київського часу в конкретну добу — щоб не залежати від DST. */
function kyivAt(daysAgo: number, hour: number, minute = 0): Date {
  const now = new Date();
  const day = new Date(now.getTime() - daysAgo * 86_400_000);
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(day);
  // Київ = UTC+3 влітку. Перевіряємо через зворотне перетворення, щоб
  // не проґавити зимовий час.
  for (const offset of [3, 2]) {
    const guess = new Date(`${stamp}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
    const shifted = new Date(guess.getTime() - offset * 3_600_000);
    const back = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(shifted)
    );
    if (back === hour) return shifted;
  }
  throw new Error("не вдалося зібрати київський час");
}

/** Малює трек: точки «в дорозі» до `movingUntil`, далі стоїть на місці. */
async function drawTrack(
  userId: string,
  shiftId: string,
  from: Date,
  movingUntil: Date,
  standingUntil: Date
) {
  const day = new Date(from);
  day.setUTCHours(0, 0, 0, 0);
  const session = await p.trackSession.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, startedAt: from },
    update: {},
  });

  const points: {
    sessionId: string;
    userId: string;
    shiftId: string;
    lat: number;
    lng: number;
    accuracyM: number;
    recordedAt: Date;
    phase: "SHIFT";
  }[] = [];

  // Рух: кожні 5 хвилин ~1 км на північ від Львова.
  let t = from.getTime();
  let step = 0;
  while (t <= movingUntil.getTime()) {
    points.push({
      sessionId: session.id,
      userId,
      shiftId,
      lat: 49.84 + step * 0.009,
      lng: 24.03,
      accuracyM: 10,
      recordedAt: new Date(t),
      phase: "SHIFT",
    });
    t += 5 * 60_000;
    step++;
  }

  // Стоянка: та сама точка раз на хвилину — саме так пише рекордер.
  const parkLat = 49.84 + step * 0.009;
  while (t <= standingUntil.getTime()) {
    points.push({
      sessionId: session.id,
      userId,
      shiftId,
      lat: parkLat,
      lng: 24.03,
      accuracyM: 10,
      recordedAt: new Date(t),
      phase: "SHIFT",
    });
    t += 60_000;
  }

  await p.trackPoint.createMany({ data: points, skipDuplicates: true });
  return points.length;
}

async function scenario(
  name: string,
  build: (userId: string) => Promise<{ shiftId: string }>,
  now: Date,
  expect: { source: string | null; endedAtHour?: number }
) {
  const user = await p.user.create({
    data: { email: `${MARK}${Date.now()}@test.local`, name: `${MARK} ${name}`, role: "SALES" },
  });
  const { shiftId } = await build(user.id);

  const shift = await p.shift.findUniqueOrThrow({
    where: { id: shiftId },
    select: { id: true, userId: true, startedAt: true, user: { select: { name: true } } },
  });
  const decision = await decideForShift(shift, now);

  const gotSource = decision.close?.source ?? null;
  check(
    `${name}: ${expect.source ?? "не закривати"}`,
    gotSource === expect.source,
    { got: gotSource, reason: decision.reason }
  );

  if (expect.endedAtHour != null && decision.close) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Kyiv",
        hour: "2-digit",
        hour12: false,
      }).format(decision.close.endedAt)
    );
    check(`${name}: час закінчення ~${expect.endedAtHour}:00`, hour === expect.endedAtHour, {
      got: hour,
      endedAt: decision.close.endedAt,
    });
  }

  return { userId: user.id, shiftId };
}

async function main() {
  if (process.argv.includes("--dry")) {
    console.log("Розбір живих відкритих змін (нічого не змінюємо):\n");
    const decisions = await autoCloseStaleShifts(new Date(), { dryRun: true });
    for (const d of decisions) {
      console.log(
        `${d.name ?? d.userId}: з ${d.startedAt.toISOString()} → ` +
          `${d.close ? `ЗАКРИТИ (${d.close.source}) о ${d.close.endedAt.toISOString()}` : "лишити"} — ${d.reason}`
      );
    }
    await p.$disconnect();
    return;
  }

  // --- А. Живий планшет, машина стоїть із 18:40 ---
  const a = await scenario(
    "А. стоїть з 18:40, зараз 20:30",
    async (userId) => {
      const shift = await p.shift.create({
        data: {
          userId,
          status: "OPEN",
          startedAt: kyivAt(0, 8, 0),
          startOdometer: 100_000,
          startOdometerSource: "AI",
        },
      });
      await drawTrack(userId, shift.id, kyivAt(0, 8, 0), kyivAt(0, 18, 40), kyivAt(0, 20, 30));
      return { shiftId: shift.id };
    },
    kyivAt(0, 20, 30),
    { source: "AUTO_GPS", endedAtHour: 18 }
  );

  // Та сама зміна, але о 19:50 — рано, робочий день ще триває.
  {
    const shift = await p.shift.findUniqueOrThrow({
      where: { id: a.shiftId },
      select: { id: true, userId: true, startedAt: true, user: { select: { name: true } } },
    });
    const early = await decideForShift(shift, kyivAt(0, 19, 50));
    check("А. о 19:50 ще не чіпаємо", early.close === null, early.reason);
  }

  // --- Б. Трек обірвався опівдні ---
  const b = await scenario(
    "Б. трек мертвий, зараз 20:30",
    async (userId) => {
      const shift = await p.shift.create({
        data: {
          userId,
          status: "OPEN",
          startedAt: kyivAt(0, 8, 0),
          startOdometer: 200_000,
          startOdometerSource: "AI",
        },
      });
      await drawTrack(userId, shift.id, kyivAt(0, 8, 0), kyivAt(0, 11, 55), kyivAt(0, 12, 0));
      return { shiftId: shift.id };
    },
    kyivAt(0, 20, 30),
    { source: null }
  );

  {
    const shift = await p.shift.findUniqueOrThrow({
      where: { id: b.shiftId },
      select: { id: true, userId: true, startedAt: true, user: { select: { name: true } } },
    });
    const late = await decideForShift(shift, kyivAt(0, 23, 5));
    check("Б. о 23:05 закриваємо як AUTO_DEAD", late.close?.source === "AUTO_DEAD", late.reason);
    const hour = late.close
      ? Number(
          new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(
            late.close.endedAt
          )
        )
      : null;
    check("Б. час = остання точка (12:00)", hour === 12, { hour });
  }

  // --- В. Машина ще їде о 23:05 ---
  await scenario(
    "В. їде о 23:05 → AUTO_FORCED",
    async (userId) => {
      const shift = await p.shift.create({
        data: {
          userId,
          status: "OPEN",
          startedAt: kyivAt(0, 8, 0),
          startOdometer: 300_000,
          startOdometerSource: "AI",
        },
      });
      // Рух до самого «зараз» — зупинки немає взагалі.
      await drawTrack(userId, shift.id, kyivAt(0, 8, 0), kyivAt(0, 23, 0), kyivAt(0, 23, 0));
      return { shiftId: shift.id };
    },
    kyivAt(0, 23, 5),
    { source: "AUTO_FORCED" }
  );

  // --- Коротка вечірня зміна не закривається о 20:00 ---
  await scenario(
    "Г. відкрита о 19:30, зараз 20:30 — рано",
    async (userId) => {
      const shift = await p.shift.create({
        data: {
          userId,
          status: "OPEN",
          startedAt: kyivAt(0, 19, 30),
          startOdometer: 400_000,
          startOdometerSource: "AI",
        },
      });
      return { shiftId: shift.id };
    },
    kyivAt(0, 20, 30),
    { source: null }
  );

  // --- Д. Повний цикл: автозакриття → вечірня поїздка → ранкове фото ---
  const rep = await p.user.create({
    data: { email: `${MARK}cycle@test.local`, name: `${MARK} Цикл`, role: "SALES" },
  });
  const cycle = await p.shift.create({
    data: {
      userId: rep.id,
      status: "OPEN",
      startedAt: kyivAt(1, 8, 0),
      startOdometer: 500_000,
      startOdometerSource: "AI",
    },
  });
  await drawTrack(rep.id, cycle.id, kyivAt(1, 8, 0), kyivAt(1, 18, 40), kyivAt(1, 20, 30));

  const decisions = await autoCloseStaleShifts(kyivAt(1, 20, 30));
  const mine = decisions.find((d) => d.shiftId === cycle.id);
  check("Д. автозакриття записалося", mine?.close?.source === "AUTO_GPS", mine?.reason);

  const closed = await p.shift.findUniqueOrThrow({ where: { id: cycle.id } });
  check("Д. статус ABANDONED + closedLate + auto", 
    closed.status === "ABANDONED" && closed.closedLate && closed.closedAutomatically,
    { status: closed.status, closedLate: closed.closedLate, auto: closed.closedAutomatically });
  check("Д. робочі км за GPS пораховані", (closed.gpsDistanceKm ?? 0) > 0, closed.gpsDistanceKm);
  check("Д. одометра ще немає", closed.endOdometer === null, closed.endOdometer);

  // Вечірня поїздка ПІСЛЯ закриття — саме те, що не має лягти в роботу.
  const eveningDay = new Date(kyivAt(1, 21, 0));
  eveningDay.setUTCHours(0, 0, 0, 0);
  const eveSession = await p.trackSession.upsert({
    where: { userId_day: { userId: rep.id, day: eveningDay } },
    create: { userId: rep.id, day: eveningDay, startedAt: kyivAt(1, 21, 0) },
    update: {},
  });
  await p.trackPoint.createMany({
    data: [0, 1, 2, 3, 4].map((i) => ({
      sessionId: eveSession.id,
      userId: rep.id,
      shiftId: cycle.id,
      lat: 49.95 + i * 0.02,
      lng: 24.03,
      accuracyM: 10,
      recordedAt: new Date(kyivAt(1, 21, 0).getTime() + i * 10 * 60_000),
      phase: "AFTER_SHIFT" as const,
    })),
    skipDuplicates: true,
  });

  // Ранкове фото: відкриваємо нову зміну через HTTP — рівно так, як застосунок.
  const token = await issueDeviceToken(rep.id, `${MARK} планшет`);
  const openRes = await api.open(token, {
    odometer: 500_260,
    source: "AI",
    clientRequestId: `${MARK}-open`,
  });
  const openBody = await openRes.json();
  check("Д. ранкове відкриття прийнято", openRes.ok, openBody);
  check("Д. відповідь несе час і джерело автозакриття",
    openBody?.autoClosed?.lateCloseSource === "AUTO_GPS" && !!openBody?.autoClosed?.endedAt,
    openBody?.autoClosed);

  const healed = await p.shift.findUniqueOrThrow({ where: { id: cycle.id } });
  check("Д. одометр добився зі старту наступної", healed.endOdometer === 500_260, healed.endOdometer);
  check("Д. вечірні км відняті від робочих",
    healed.distanceKm != null && healed.afterWorkKm != null && healed.distanceKm < 260,
    { distanceKm: healed.distanceKm, afterWorkKm: healed.afterWorkKm });

  // --- Е. Підтвердження торговим ---
  const cur = await (await api.current(token)).json();
  /**
   * Картка мусить бути видима саме зараз — зміна відкрита, і одометр
   * учорашньої щойно добився ранковим фото. Це єдиний момент, коли
   * людина тримає в голові і вчорашній вечір, і сьогоднішнє число.
   */
  check("Е. картка підтвердження видима одразу після ранкового фото",
    cur?.needsConfirmation?.shiftId === cycle.id, cur?.needsConfirmation);
  check("Е. картка несе розділені кілометри",
    cur?.needsConfirmation?.afterWorkKm != null && cur?.needsConfirmation?.distanceKm != null,
    cur?.needsConfirmation);

  await api.close(token, { odometer: 500_300, source: "AI" });

  const cur2 = await (await api.current(token)).json();
  check("Е. картка лишається після закриття сьогоднішньої", cur2?.needsConfirmation?.shiftId === cycle.id, cur2?.needsConfirmation);

  const confirmRes = await api.confirm(token, cycle.id, { ok: true });
  check("Е. підтвердження прийнято", confirmRes.ok, await confirmRes.clone().json());
  const confirmed = await p.shift.findUniqueOrThrow({ where: { id: cycle.id } });
  check("Е. відмітка REP стоїть",
    confirmed.confirmedAt != null && confirmed.confirmSource === "REP" && confirmed.confirmedById === rep.id,
    { at: confirmed.confirmedAt, source: confirmed.confirmSource });

  const cur3 = await (await api.current(token)).json();
  check("Е. картка зникла після підтвердження", cur3?.needsConfirmation === null, cur3?.needsConfirmation);

  // --- Є. Чужу зміну підтвердити не можна ---
  const stranger = await p.user.create({
    data: { email: `${MARK}stranger@test.local`, name: `${MARK} Чужий`, role: "SALES" },
  });
  const strangerToken = await issueDeviceToken(stranger.id, `${MARK} чужий планшет`);
  const forbidden = await api.confirm(strangerToken, cycle.id, { ok: true });
  check("Є. чужа зміна → 403", forbidden.status === 403, forbidden.status);

  // --- Ж. Межі одометра при ручному введенні ---
  const manual = await p.shift.create({
    data: {
      userId: stranger.id,
      status: "ABANDONED",
      startedAt: kyivAt(3, 8, 0),
      endedAt: kyivAt(3, 18, 0),
      startOdometer: 700_000,
      startOdometerSource: "AI",
      closedLate: true,
      lateCloseSource: "AUTO_GPS",
      closedAutomatically: true,
    },
  });
  const tooSmall = await api.confirm(strangerToken, manual.id, { endOdometer: 699_000 });
  check("Ж. одометр менший за стартовий → 400", tooSmall.status === 400, await tooSmall.clone().json());

  const good = await api.confirm(strangerToken, manual.id, { endOdometer: 700_180 });
  check("Ж. коректний одометр прийнято", good.ok, await good.clone().json());
  const fixed = await p.shift.findUniqueOrThrow({ where: { id: manual.id } });
  check("Ж. зміна стала CLOSED із CORRECTED",
    fixed.status === "CLOSED" && fixed.endOdometerSource === "CORRECTED" && fixed.distanceKm === 180,
    { status: fixed.status, source: fixed.endOdometerSource, km: fixed.distanceKm });

  // --- З. Повернення зміни в роботу ---
  const fresh = await p.shift.create({
    data: {
      userId: stranger.id,
      status: "ABANDONED",
      startedAt: new Date(Date.now() - 6 * 3_600_000),
      endedAt: new Date(Date.now() - 3_600_000),
      startOdometer: 800_000,
      startOdometerSource: "AI",
      closedLate: true,
      closedAutomatically: true,
      lateCloseSource: "AUTO_GPS",
    },
  });
  const reopen = await api.reopen(strangerToken, fresh.id);
  check("З. повернення прийнято", reopen.ok, await reopen.clone().json());
  const reopened = await p.shift.findUniqueOrThrow({ where: { id: fresh.id } });
  check("З. зміна знову OPEN без слідів закриття",
    reopened.status === "OPEN" && reopened.endedAt === null && !reopened.closedLate,
    { status: reopened.status, endedAt: reopened.endedAt });

  // Стара зміна (закрита давно) не повертається.
  const old = await p.shift.create({
    data: {
      userId: stranger.id,
      status: "ABANDONED",
      startedAt: kyivAt(5, 8, 0),
      endedAt: kyivAt(5, 18, 0),
      startOdometer: 900_000,
      startOdometerSource: "AI",
      closedLate: true,
      closedAutomatically: true,
      lateCloseSource: "AUTO_GPS",
    },
  });
  const tooLate = await api.reopen(strangerToken, old.id);
  check("З. стару зміну повернути не можна → 409", tooLate.status === 409, tooLate.status);

  // --- И. Офіс править і підтверджує ---
  const manager = await p.user.create({
    data: { email: `${MARK}manager@test.local`, name: `${MARK} Менеджер`, role: "MANAGER" },
  });
  const cookie = await sessionCookie(manager.id, "MANAGER", manager.email!);
  const officeShift = await p.shift.create({
    data: {
      userId: rep.id,
      status: "ABANDONED",
      startedAt: kyivAt(7, 8, 0),
      endedAt: kyivAt(7, 18, 0),
      startOdometer: 450_000,
      startOdometerSource: "AI",
      closedLate: true,
      closedAutomatically: true,
      lateCloseSource: "AUTO_DEAD",
    },
  });
  /**
   * Роут адмінки читає сесію через getServerSession, а той — cookies()
   * з контексту Next. Прямим викликом його не перевірити, тому тут
   * єдина HTTP-частина. Якщо сервер не піднятий (або тримає Prisma
   * Client, згенерований до міграції), крок пропускається з поясненням:
   * ядро правки перевіряється нижче в будь-якому разі.
   */
  const serverFresh = await fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);

  if (serverFresh) {
    const patch = await fetch(`${BASE}/api/admin/shifts/${officeShift.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ endOdometer: 450_150, confirm: true }),
    });
    if (patch.status === 500) {
      console.log(
        "· И. PATCH адмінки пропущено: сервер віддає 500 — найімовірніше, `next dev` тримає Prisma Client, згенерований до міграції. Перезапустіть його й прогоніть ще раз."
      );
    } else {
      check("И. офіс проставив одометр", patch.ok, await patch.clone().json());
      const byOffice = await p.shift.findUniqueOrThrow({ where: { id: officeShift.id } });
      check(
        "И. відмітка OFFICE стоїть",
        byOffice.confirmSource === "OFFICE" && byOffice.distanceKm === 150,
        { source: byOffice.confirmSource, km: byOffice.distanceKm }
      );

      const bySales = await fetch(`${BASE}/api/admin/shifts/${officeShift.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm: true }),
      });
      check("И. торговий в адмінку не пускається", bySales.status === 401 || bySales.status === 403, bySales.status);
    }
  } else {
    console.log("· И. PATCH адмінки пропущено: сервер за адресою " + BASE + " не відповідає");
  }

  /**
   * Ядро офісної правки — незалежно від того, чи вдалося сходити по
   * HTTP. Саме ці дві функції роут і викликає: закрити відкриту зміну
   * часом офісу й проставити їй одометр із підписом OFFICE.
   */
  const officeCore = await p.shift.create({
    data: {
      userId: rep.id,
      status: "OPEN",
      startedAt: kyivAt(9, 8, 0),
      startOdometer: 400_000,
      startOdometerSource: "AI",
    },
  });
  await p.$transaction((tx) =>
    closeWithoutPhoto(tx, { id: officeCore.id, startedAt: kyivAt(9, 8, 0), startOdometer: 400_000 }, {
      endedAt: kyivAt(9, 18, 0),
      source: "OFFICE",
      notes: autoCloseNote("OFFICE", null),
    })
  );
  const closedByOffice = await p.shift.findUniqueOrThrow({ where: { id: officeCore.id } });
  check("И. офіс закрив відкриту зміну",
    closedByOffice.status === "ABANDONED" && closedByOffice.lateCloseSource === "OFFICE" && !closedByOffice.closedAutomatically,
    { status: closedByOffice.status, source: closedByOffice.lateCloseSource, auto: closedByOffice.closedAutomatically });

  const loaded = await loadForConfirm(officeCore.id);
  const officeResult = await confirmShift(loaded!, { endOdometer: 400_220 }, { userId: manager.id, source: "OFFICE" });
  check("И. офіс проставив одометр і підпис", officeResult.ok, officeResult);
  const officeDone = await p.shift.findUniqueOrThrow({ where: { id: officeCore.id } });
  check("И. підпис OFFICE і пробіг 220 км",
    officeDone.confirmSource === "OFFICE" && officeDone.confirmedById === manager.id && officeDone.distanceKm === 220,
    { source: officeDone.confirmSource, km: officeDone.distanceKm });

  // --- Прибирання ---
  await p.trackPoint.deleteMany({ where: { user: { email: { startsWith: MARK } } } });
  await p.trackSession.deleteMany({ where: { user: { email: { startsWith: MARK } } } });
  await p.shift.deleteMany({ where: { user: { email: { startsWith: MARK } } } });
  await p.deviceToken.deleteMany({ where: { user: { email: { startsWith: MARK } } } });
  await p.user.deleteMany({ where: { email: { startsWith: MARK } } });

  const leftovers = await p.user.count({ where: { email: { startsWith: MARK } } });
  check("Прибрано без залишків", leftovers === 0, leftovers);

  console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено перевірок: ${failed}`);
  await p.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

/** Кука NextAuth під обома іменами — як у check-tablet-api. */
async function sessionCookie(id: string, role: "ADMIN" | "MANAGER", email: string): Promise<string> {
  const token = await encode({
    token: { sub: id, id, role, email, boltsBalance: 0 },
    secret: process.env.NEXTAUTH_SECRET!,
  });
  return `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;
}

main().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
