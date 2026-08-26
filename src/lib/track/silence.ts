/**
 * «Зміна відкрита, а треку немає» — сповіщення, поки день ще можна врятувати.
 *
 * Досі про мертвий трек дізнавалися ввечері або наступного дня: людина
 * відкривала зміну, планшет мовчав, і жодного сигналу про це не було
 * ніде. 26.08 так минуло три години в одного торгового і вся зміна в
 * іншого. Ввечері з цим уже нічого не зробиш — маршрут проїхано, а в
 * базі порожньо.
 *
 * Тому перевірка ходить у тому самому воркері, що й перевірка мовчання
 * агента 1С: раз на чверть години, з тим самим Telegram-каналом. Поріг
 * навмисно не маленький — 25 хвилин без точки в місті трапляється
 * (підземний паркінг, глухий склад), а от година вже означає, що день
 * пишеться в нікуди.
 */

import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram/notify";
import { diagnose } from "@/lib/track/diagnosis";

/** Скільки хвилин без жодної точки при відкритій зміні вважати аварією. */
const SILENT_MINUTES = 25;

/**
 * Скільки хвилин після відкриття зміни не турбувати.
 *
 * Перша координата приходить не миттєво: планшет прокидається, ловить
 * небо, шле пачку раз на дві хвилини. Сповіщення через хвилину після
 * відкриття зміни було б помилковим у більшості випадків.
 */
const GRACE_MINUTES = 15;

/** Не повторювати сповіщення про ту саму людину частіше, ніж раз на стільки. */
const COOLDOWN_MS = 2 * 60 * 60_000;

/** Ключ тротлу в спільному сховищі станів. */
const alertKey = (userId: string) => `track:silentAlert:${userId}`;

async function alert(text: string): Promise<void> {
  const chatId = process.env.SYNC_ALERT_CHAT_ID;
  // Немає каналу — не помилка: сповіщення просто не налаштовані.
  if (!chatId) return;
  await sendTelegramMessage(chatId, text);
}

/**
 * Одна перевірка по всіх відкритих змінах.
 *
 * Повертає, скільки сповіщень надіслано — воркеру це потрібно лише для
 * логу, рішень за цим числом ніхто не ухвалює.
 */
export async function checkTrackSilence(): Promise<number> {
  const now = Date.now();

  const shifts = await prisma.shift.findMany({
    where: { status: "OPEN", startedAt: { lt: new Date(now - GRACE_MINUTES * 60_000) } },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      user: { select: { name: true } },
    },
  });
  if (shifts.length === 0) return 0;

  let sent = 0;

  for (const shift of shifts) {
    /**
     * Остання точка саме цієї людини, а не зміни.
     *
     * Зміна може перетнути північ, і тоді її точки лежать у двох
     * добових сесіях; та й прив'язку до зміни ставить сервер уже при
     * прийомі — шукати по людині надійніше.
     */
    const [lastPoint, lastBeat, device, throttled] = await Promise.all([
      prisma.trackPoint.findFirst({
        where: { userId: shift.userId, recordedAt: { gte: shift.startedAt } },
        orderBy: { recordedAt: "desc" },
        select: { recordedAt: true },
      }),
      prisma.deviceHeartbeat.findFirst({
        where: { userId: shift.userId },
        orderBy: { at: "desc" },
        select: {
          at: true,
          tracking: true,
          buffered: true,
          lastFixAt: true,
          locationPermission: true,
          locationMode: true,
          batteryOptimized: true,
        },
      }),
      prisma.deviceToken.findFirst({
        where: { userId: shift.userId, scope: "track", revokedAt: null },
        select: { id: true },
      }),
      prisma.syncState.findUnique({ where: { key: alertKey(shift.userId) } }),
    ]);

    const silentMin = Math.floor(
      (now - (lastPoint?.recordedAt.getTime() ?? shift.startedAt.getTime())) / 60_000
    );
    if (silentMin < SILENT_MINUTES) continue;

    const lastAlertMs = throttled ? Date.parse(throttled.value) : 0;
    if (Number.isFinite(lastAlertMs) && now - lastAlertMs < COOLDOWN_MS) continue;

    const minutesSince = (d: Date | null | undefined) =>
      d ? Math.floor((now - d.getTime()) / 60_000) : null;

    // Та сама фраза, що й на карті: людина, яка прочитає сповіщення й
    // відкриє «На маршруті», має побачити те саме пояснення.
    const reason = diagnose({
      hasDevice: !!device,
      shiftOpen: true,
      beat: lastBeat
        ? {
            minutesAgo: minutesSince(lastBeat.at),
            tracking: lastBeat.tracking,
            buffered: lastBeat.buffered,
            lastFixMinutesAgo: minutesSince(lastBeat.lastFixAt),
            locationPermission: lastBeat.locationPermission,
            locationMode: lastBeat.locationMode,
            batteryOptimized: lastBeat.batteryOptimized,
          }
        : null,
    });

    const hoursOpen = Math.floor((now - shift.startedAt.getTime()) / 60_000 / 60);

    await alert(
      `📍 <b>Трек не пишеться</b>\n` +
        `${shift.user.name ?? "Без імені"} — зміна відкрита ${hoursOpen ? `${hoursOpen} год ` : ""}` +
        `(з ${shift.startedAt.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" })})\n` +
        (lastPoint
          ? `Остання точка ${silentMin} хв тому.\n`
          : `Жодної точки за всю зміну.\n`) +
        (reason ? `\nПричина: ${reason}` : `\nПланшет на зв'язку — схоже, GPS не бачить неба.`)
    );

    await prisma.syncState.upsert({
      where: { key: alertKey(shift.userId) },
      create: { key: alertKey(shift.userId), value: new Date(now).toISOString() },
      update: { value: new Date(now).toISOString() },
    });
    sent++;
  }

  return sent;
}
