/**
 * «Трек не йде» — сповіщення, поки день ще можна врятувати.
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
 *
 * ГОЛОВНЕ РОЗРІЗНЕННЯ (03.09). Два стани виглядають однаково з боку бази
 * — точок немає, — але означають протилежне:
 *
 *   Дані ВТРАЧАЮТЬСЯ. Планшет не пише нічого: служба вбита, дозвіл знято,
 *   геолокація вимкнена. Кілометри цієї години не існуватимуть ніколи, і
 *   дзвонити треба зараз.
 *
 *   Дані ЧЕКАЮТЬ. Планшет пише справно, буфер росте, але пачки не
 *   долітають. Кілометри цілі, вони доїдуть самі — сьогодні, ввечері чи
 *   після перезапуску застосунку. Термінового в цьому нічого.
 *
 * Обидва довго йшли під заголовком «Трек не пишеться», і 03.09 власник
 * сказав прямо: заважає. Він мав рацію двічі. По-перше, заголовок брехав
 * — у трьох торгових саме тоді в планшетах лежало по 300-400 записаних
 * точок. По-друге, п'ять окремих повідомлень про одну спільну причину —
 * це не сигнал, а шум, і читати його починають по діагоналі.
 *
 * Тому тепер: два стани — два заголовки, і всі люди одного стану йдуть
 * ОДНИМ повідомленням.
 */

import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram/notify";
import { diagnose, BUFFER_ALARM, HEARTBEAT_WINDOW_MIN } from "@/lib/track/diagnosis";

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

/**
 * Не повторювати про ту саму людину частіше, ніж раз на стільки.
 *
 * Два числа, бо терміновість різна. Втрата даних незворотна, і про неї
 * нагадати вдруге за зміну доречно. Затримка доставки сама собою нічого
 * не псує, тож удруге про неї варто сказати хіба надвечір — інакше один
 * поганий канал зв'язку дає чотири однакові повідомлення за день.
 */
const COOLDOWN_LOST_MS = 2 * 60 * 60_000;
const COOLDOWN_DELAYED_MS = 6 * 60 * 60_000;

/** Ключ тротлу в спільному сховищі станів. */
const alertKey = (userId: string) => `track:silentAlert:${userId}`;

/** Що саме сталося: дані гинуть чи чекають у планшеті. */
type Kind = "LOST" | "DELAYED";

type Trouble = {
  userId: string;
  name: string;
  kind: Kind;
  reason: string;
  silentMin: number;
  buffered: number;
  startedAt: Date;
  lastPointAt: Date | null;
};

const clock = (d: Date) =>
  d.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });

async function alert(text: string): Promise<void> {
  const chatId = process.env.SYNC_ALERT_CHAT_ID;
  // Немає каналу — не помилка: сповіщення просто не налаштовані.
  if (!chatId) return;
  await sendTelegramMessage(chatId, text);
}

/**
 * Одна перевірка по всіх відкритих змінах.
 *
 * Повертає, скільки людей потрапило в сповіщення — воркеру це потрібно
 * лише для логу, рішень за цим числом ніхто не ухвалює.
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

  const troubles: Trouble[] = [];

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
          lastFixAccuracyM: true,
          lastError: true,
          locationPermission: true,
          locationMode: true,
          batteryOptimized: true,
          appVersion: true,
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

    const minutesSince = (d: Date | null | undefined) =>
      d ? Math.floor((now - d.getTime()) / 60_000) : null;

    const beatAgo = minutesSince(lastBeat?.at);
    const buffered = lastBeat?.buffered ?? 0;

    /**
     * Межа між «гине» і «чекає» — саме буфер, а не причина словами.
     *
     * Точки лежать у планшеті й пульс свіжий: значить, застосунок живий,
     * пише і намагається віддати. Все інше — від вимкненої геолокації до
     * вбитої служби — лишає буфер порожнім, бо писати нічого.
     *
     * Пульс мусить бути свіжим окремо: старий каже лише те, яким стан був
     * пів години тому, а за цей час застосунок могли й прибити разом із
     * буфером.
     */
    const delayed =
      buffered > BUFFER_ALARM &&
      !!lastBeat?.tracking &&
      beatAgo != null &&
      beatAgo <= HEARTBEAT_WINDOW_MIN;
    const kind: Kind = delayed ? "DELAYED" : "LOST";

    /**
     * Тротл пам'ятає не лише час, а й стан.
     *
     * Погіршення «чекають» → «гинуть» мусить пройти негайно, навіть якщо
     * про затримку писали десять хвилин тому: це вже інша новина, і
     * шестигодинна пауза сховала б саме те, заради чого все це є.
     */
    const prev = throttled?.value ?? "";
    const [prevKind, prevAt] = prev.includes("|") ? prev.split("|") : ["LOST", prev];
    const lastAlertMs = Date.parse(prevAt);
    const cooldown = kind === "LOST" ? COOLDOWN_LOST_MS : COOLDOWN_DELAYED_MS;
    const worsened = prevKind === "DELAYED" && kind === "LOST";
    if (!worsened && Number.isFinite(lastAlertMs) && now - lastAlertMs < cooldown) continue;

    // Та сама фраза, що й на карті: людина, яка прочитає сповіщення й
    // відкриє «На маршруті», має побачити те саме пояснення.
    const reason = diagnose({
      hasDevice: !!device,
      shiftOpen: true,
      beat: lastBeat
        ? {
            minutesAgo: beatAgo,
            tracking: lastBeat.tracking,
            buffered: lastBeat.buffered,
            lastFixMinutesAgo: minutesSince(lastBeat.lastFixAt),
            lastFixAccuracyM: lastBeat.lastFixAccuracyM,
            locationPermission: lastBeat.locationPermission,
            locationMode: lastBeat.locationMode,
            batteryOptimized: lastBeat.batteryOptimized,
            lastError: lastBeat.lastError,
          }
        : null,
    });

    troubles.push({
      userId: shift.userId,
      name: shift.user.name ?? "Без імені",
      kind,
      reason: reason ?? "Планшет на зв'язку — схоже, GPS не бачить неба",
      silentMin,
      buffered,
      startedAt: shift.startedAt,
      lastPointAt: lastPoint?.recordedAt ?? null,
    });
  }

  if (troubles.length === 0) return 0;

  const lost = troubles.filter((t) => t.kind === "LOST");
  const delayed = troubles.filter((t) => t.kind === "DELAYED");

  /**
   * Втрата йде першою і окремим повідомленням.
   *
   * Її читають, щоб зараз зателефонувати, — і вона не має ділити місце з
   * тим, що можна подивитися ввечері.
   */
  if (lost.length > 0) {
    await alert(
      `📍 <b>Трек не пишеться</b>${lost.length > 1 ? ` — ${lost.length}` : ""}\n` +
        `Кілометри цього часу не збережуться ніде.\n\n` +
        lost
          .map(
            (t) =>
              `• <b>${t.name}</b> — зміна з ${clock(t.startedAt)}, ` +
              (t.lastPointAt
                ? `остання точка ${t.silentMin} хв тому\n`
                : `жодної точки за зміну\n`) +
              `  ${t.reason}`
          )
          .join("\n\n")
    );
  }

  if (delayed.length > 0) {
    await alert(
      `📡 <b>Точки не доїжджають</b>${delayed.length > 1 ? ` — ${delayed.length}` : ""}\n` +
        `Записані й лежать у планшетах. Дані цілі, маршрут відновиться, ` +
        `щойно пачки долетять.\n\n` +
        delayed
          .map(
            (t) =>
              `• <b>${t.name}</b> — ${t.buffered} точок у буфері, ` +
              (t.lastPointAt ? `останнє доїхало ${clock(t.lastPointAt)}` : `нічого не доїхало`)
          )
          .join("\n") +
        `\n\nЯкщо до вечора не розсмокчеться — перезапустити застосунок на планшеті.`
    );
  }

  const stamp = new Date(now).toISOString();
  await Promise.all(
    troubles.map((t) =>
      prisma.syncState.upsert({
        where: { key: alertKey(t.userId) },
        create: { key: alertKey(t.userId), value: `${t.kind}|${stamp}` },
        update: { value: `${t.kind}|${stamp}` },
      })
    )
  );

  return troubles.length;
}
