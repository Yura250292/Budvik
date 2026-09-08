/**
 * «Вийшла нова збірка» — сповіщення тим, хто досі на старій.
 *
 * Навіщо, коли кнопка «Оновити» в застосунку вже є. Тому що її не бачать:
 * 08.09 у полі одночасно стояли ЧОТИРИ різні збірки, і двоє торгових їздили
 * на травневій за віком — без мікрофона, без обох сторожів треку і без
 * пробудження сповіщенням. Кнопка весь цей час лежала в меню профілю, куди
 * ніхто не заходить без причини.
 *
 * Кільце навколо аватарки (globals.css, .update-ring) закрило половину задачі:
 * воно видно тому, хто ВІДКРИВ кабінет. А не оновлюється якраз той, хто його
 * не відкриває. Тому друга половина — постукати ззовні.
 *
 * ЧОМУ ЦЕ СПОВІЩЕННЯ ВИДИМЕ, на відміну від пробудження треку. Там сигнал
 * тихий, бо його адресат — застосунок, і людині нема чого робити. Тут навпаки:
 * зробити мусить саме людина, натиснути кнопку за неї ми не можемо. Оновлення
 * ставиться з підтвердженням системи, і тихо це не відбувається.
 *
 * Один раз на версію на людину. Нагадувати щогодини про те саме — найшвидший
 * спосіб навчити ігнорувати наші сповіщення, і тоді замовкне й те, що про
 * мертвий трек.
 */

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push/send";
import { STAFF_APK_VERSION_NAME } from "@/lib/app-builds";
import { kyivHour } from "@/lib/date/kyiv";

/** Ролі, яким узагалі роздається робоча збірка. */
const STAFF_ROLES = ["SALES", "DRIVER", "WAREHOUSE"] as const;

/**
 * Не турбуємо вночі й до початку роботи.
 *
 * Оновлення — не аварія: воно почекає до ранку. А сповіщення о шостій ранку
 * псує ставлення до всіх наступних, включно з тими, що про втрачений маршрут.
 */
const FROM_HOUR = 8;
const TO_HOUR = 19;

/**
 * Скільки днів мовчати після виходу збірки.
 *
 * Нуль: пропозиція оновитися має прийти того ж дня. Але саме ЧЕРЕЗ це тут
 * потрібен тротл за версією — інакше кожна публікація за день (а їх буває
 * чотири) означала б чотири однакові сповіщення.
 */
const key = (userId: string) => `app:updateNudge:${userId}`;

/**
 * «1.6.2 ota.01a080fa» → 10602. Формула та сама, що в app.config.ts:
 * major*10000 + minor*100 + patch, тобто порівнюються числа, а не рядки
 * («1.10.0» проти «1.9.0» на рядках дало б неправильну відповідь).
 */
export function versionCodeOf(appVersion: string | null | undefined): number | null {
  if (!appVersion) return null;
  const m = appVersion.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

/**
 * Куди вести дотик — до сторінки з кнопкою, а не «кудись у кабінет».
 *
 * Сповіщення, яке просить оновитися й відкриває головну, перекладає пошук
 * кнопки на людину — тобто повторює саме ту ваду, через яку в полі й
 * зібралися чотири різні збірки.
 *
 * У складовщика власної сторінки оновлення немає, і вигадувати її сюди не
 * треба: у застосунку над кабінетом висить смуга оновлення (UpdateBar,
 * mobile/src/app/cabinet.tsx) — вона є на КОЖНОМУ його екрані, тож кнопка
 * буде перед очима одразу.
 */
function updatePageFor(role: string): string {
  if (role === "DRIVER") return "/driver/app";
  if (role === "WAREHOUSE") return "/warehouse";
  return "/sales/app";
}

export type NudgeResult = {
  name: string;
  installed: string;
  sent: boolean;
  why: string;
};

/**
 * Одна перевірка по всіх планшетах.
 *
 * Повертає рішення по кожному — і по тих, кому НЕ надіслали, теж. Без цього
 * «нікому не пішло» неможливо відрізнити від «усі вже оновлені», а це різні
 * новини: перша означає, що щось зламано.
 */
export async function notifyOutdatedApps(
  opts: { dry?: boolean; ignoreHours?: boolean } = {}
): Promise<NudgeResult[]> {
  const latest = versionCodeOf(STAFF_APK_VERSION_NAME);
  if (latest == null) return [];

  if (!opts.ignoreHours) {
    const hour = kyivHour(new Date());
    if (hour < FROM_HOUR || hour >= TO_HOUR) return [];
  }

  const users = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    select: { id: true, name: true, role: true },
  });

  const out: NudgeResult[] = [];

  for (const u of users) {
    const [beat, token, told] = await Promise.all([
      prisma.deviceHeartbeat.findFirst({
        where: { userId: u.id },
        orderBy: { at: "desc" },
        select: { appVersion: true },
      }),
      prisma.pushToken.findFirst({ where: { userId: u.id, revokedAt: null }, select: { id: true } }),
      prisma.syncState.findUnique({ where: { key: key(u.id) } }),
    ]);

    const name = u.name ?? "—";
    const installed = beat?.appVersion ?? "—";
    const code = versionCodeOf(beat?.appVersion);

    /**
     * Планшета не бачили ніколи — сповіщати нема кого й нема про що.
     * Такі рядки з'являються від офісних імен, у яких застосунку немає.
     */
    if (code == null) {
      out.push({ name, installed, sent: false, why: "планшета не бачили" });
      continue;
    }
    if (code >= latest) {
      out.push({ name, installed, sent: false, why: "уже актуальна" });
      continue;
    }
    if (!token) {
      /**
       * Найприкріший випадок: людина на старій збірці, і саме через це в неї
       * немає адреси для сповіщень (ключі Firebase з'явилися лише в 1.6.2).
       * Тобто тим, кому оновлення потрібне найбільше, постукати нічим — їхній
       * планшет доведеться взяти в руки.
       */
      out.push({ name, installed, sent: false, why: "немає адреси для сповіщень" });
      continue;
    }
    if (told?.value === STAFF_APK_VERSION_NAME) {
      out.push({ name, installed, sent: false, why: "уже казали про цю версію" });
      continue;
    }

    if (!opts.dry) {
      await sendPushToUser(u.id, {
        title: `Оновіть застосунок до ${STAFF_APK_VERSION_NAME}`,
        body: "Натисніть — відкриється сторінка оновлення з кнопкою.",
        /**
         * Не urgent: це не аварія, і будити планшет із глибокого сну заради
         * оновлення не варто. Прийде, коли пристрій сам прокинеться.
         */
        data: { screen: "/cabinet", target: updatePageFor(u.role) },
      });
      await prisma.syncState.upsert({
        where: { key: key(u.id) },
        create: { key: key(u.id), value: STAFF_APK_VERSION_NAME },
        update: { value: STAFF_APK_VERSION_NAME },
      });
    }

    out.push({ name, installed, sent: !opts.dry, why: `стара, треба ${STAFF_APK_VERSION_NAME}` });
  }

  return out;
}
