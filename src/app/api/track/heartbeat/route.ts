/**
 * Пульс планшета: застосунок звітує про себе, а не лише про маршрут.
 *
 * Причина, з якої це з'явилося. Раніше єдиним свідченням про трекер були
 * самі точки. Коли їх немає, з сервера нерозрізненні чотири різні біди:
 * служба вбита оптимізацією батареї, дозвіл на локацію звузили до «поки
 * відкрито», GPS не бачить неба в приміщенні, планшет просто вимкнули.
 * Розбір кожного випадку впирався в «треба взяти планшет у руки».
 *
 * Пульс іде раз на кілька хвилин НАВІТЬ коли надсилати нічого. Тому
 * мовчання тут — уже діагноз, а не невідомість: точок може не бути й
 * тому, що людина стоїть на місці, а пульс не зникає ніколи.
 *
 * Рядки дописуються, а не оновлюються: цінне саме те, КОЛИ пристрій
 * замовк, а поточний стан і так видно з останнього рядка.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDeviceToken } from "@/lib/track/device-token";

export const dynamic = "force-dynamic";

type Body = {
  /** Час на пристрої, ISO. Розбіжність із сервером ловить збитий годинник. */
  reportedAt?: string;
  tracking?: boolean;
  /** Чи підтверджує система живу підписку — не те саме, що tracking. */
  subscribed?: boolean;
  mode?: string;
  shiftOpen?: boolean;
  buffered?: number;
  lastFixAt?: string;
  lastFixAccuracyM?: number;
  lastSyncAt?: string;
  lastError?: string;
  locationPermission?: string;
  batteryOptimized?: boolean;
  batteryPct?: number;
  locationMode?: string;
  appVersion?: string;
  osVersion?: string;
  osBuild?: string;
  watchdogAt?: string;
  watchdogStatus?: string;
};

/** Дата з тіла запиту або null: сміття в полі не має валити весь пульс. */
function date(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Ціле в межах або null. Пристрій може прислати що завгодно. */
function int(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Короткий рядок: поле для ока людини, а не сховище логів. */
function text(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export async function POST(req: NextRequest) {
  /**
   * Тільки Bearer: пульс — це доповідь пристрою про самого себе, і з
   * браузерної вкладки він сенсу не має. Заразом verifyDeviceToken
   * оновлює lastUsedAt, тож навіть порожній пульс лишає слід.
   */
  const device = await verifyDeviceToken(req.headers.get("authorization"));
  if (!device) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    // Порожній пульс кращий за жодного: сам факт запиту вже каже, що
    // застосунок живий і з мережею.
    body = {};
  }

  const token = await prisma.deviceToken.findUnique({
    where: { id: device.tokenId },
    select: { deviceName: true },
  });

  await prisma.deviceHeartbeat.create({
    data: {
      userId: device.userId,
      tokenId: device.tokenId,
      deviceName: token?.deviceName ?? null,
      reportedAt: date(body.reportedAt),
      tracking: body.tracking === true,
      subscribed: typeof body.subscribed === "boolean" ? body.subscribed : null,
      mode: text(body.mode, 20),
      shiftOpen: body.shiftOpen === true,
      buffered: int(body.buffered, 0, 100_000) ?? 0,
      lastFixAt: date(body.lastFixAt),
      lastFixAccuracyM: int(body.lastFixAccuracyM, 0, 100_000),
      lastSyncAt: date(body.lastSyncAt),
      lastError: text(body.lastError),
      locationPermission: text(body.locationPermission, 20),
      batteryOptimized:
        typeof body.batteryOptimized === "boolean" ? body.batteryOptimized : null,
      batteryPct: int(body.batteryPct, 0, 100),
      locationMode: text(body.locationMode, 20),
      appVersion: text(body.appVersion, 40),
      /**
       * Прошивка планшета. Довжина під `Build.FINGERPRINT` — він буває
       * довгим (виробник/модель/версія/дата/ключі одним рядком).
       */
      osVersion: text(body.osVersion, 20),
      osBuild: text(body.osBuild, 200),
      /**
       * Стан сторожа. Без нього мовчання пульсу не має адреси: сплячий
       * сторож при живому треку й мертвий застосунок виглядають однаково.
       */
      watchdogAt: date(body.watchdogAt),
      watchdogStatus: text(body.watchdogStatus, 20),
    },
  });

  /**
   * У відповідь кажемо пристрою правду сервера про зміну.
   *
   * Досі планшет жив власним кешем `shiftOpen` і дізнавався про закриту
   * адміном зміну, лише коли людина заходила на екран зміни. Пульс іде
   * постійно, тож це найдешевше місце, щоб звірити дві картини.
   */
  const openShift = await prisma.shift.findFirst({
    where: { userId: device.userId, status: "OPEN" },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });

  return NextResponse.json({
    ok: true,
    /** Час сервера — пристрій може порівняти зі своїм і показати розбіжність. */
    serverTime: new Date().toISOString(),
    shiftOpen: !!openShift,
    shiftStartedAt: openShift?.startedAt ?? null,
    /**
     * Чи має служба працювати. Для водія — завжди (він зміни не
     * відкриває), для решти — поки відкрита зміна. Вирішує сервер:
     * пристрій міг проспати закриття зміни адміном.
     */
    shouldTrack: device.role === "DRIVER" ? true : !!openShift,
  });
}
