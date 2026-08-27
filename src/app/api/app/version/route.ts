/**
 * Яка версія застосунку лежить на сервері.
 *
 * Застосунок питає це при запуску й порівнює зі своєю. Якщо серверна
 * новіша — у меню профілю з'являється «Оновити застосунок». Без такої
 * перевірки торговий не має жодного способу дізнатися, що вийшла нова
 * збірка: свого магазину в компанії немає, а Play Market ми не
 * використовуємо.
 */

import { stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyDeviceToken } from "@/lib/track/device-token";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["SALES", "DRIVER", "ADMIN", "MANAGER"];

const APK_PATH = path.join(process.cwd(), "assets", "app", "BudvikTracker.apk");

/**
 * Версія збірки, що лежить у assets/app/.
 *
 * Мусить збігатися з versionCode у app/build.gradle.kts трекера й
 * оновлюватись тим самим комітом, що й сам APK.
 *
 * Числа тут, а не з двійкового AndroidManifest усередині APK: розбір
 * того формату — окрема залежність, яка ламається від зміни формату
 * заради двох чисел. А так версія видна в дифі поруч із файлом, і
 * розбіжність помітна одразу.
 *
 * Наслідок помилки м'який в обидва боки: забули підняти — людина не
 * побачить кнопку і оновиться зі сторінки /sales/app чи /driver/app;
 * підняли зайве — побачить кнопку й перевстановить ту саму збірку.
 *
 * 3 (1.2) — одна збірка на дві ролі, кабінет за роллю, трек водія від
 * входу. Перша збірка з постійним ключем підпису, тому саме її ставлять
 * з видаленням старої: попередній ключ утрачено разом із тим оточенням.
 */
const CURRENT_VERSION_CODE = 6;
const CURRENT_VERSION_NAME = "1.5";

export async function GET(req: Request) {
  /** Дві авторизації, як у решти роутів застосунку: Bearer і кукі. */
  const device = await verifyDeviceToken(req.headers.get("authorization"));
  const session = device ? null : await getServerSession(authOptions);
  const role = device?.role ?? (session?.user as { role?: string } | undefined)?.role;

  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });
  }

  /**
   * Заразом запам'ятовуємо, що саме стоїть на цьому планшеті.
   *
   * Питання «у кого яка збірка» коштує дорого рівно тоді, коли воно
   * терміново потрібне. 27.08 треба було знати, кому оновлення стане
   * поверх, а кому доведеться ставити застосунок наново через зміну
   * ключа підпису 25.08 — і відповіді не було: пульс зі своєю версією
   * шлють лише збірки від 1.3, а питання саме про старіші.
   *
   * Версію старі збірки все одно називають — у User-Agent свого
   * WebView. А цей роут смикає шапка кабінету при кожному відкритті,
   * тож картина збирається сама, без жодних дій від людей.
   */
  const installed = req.headers.get("user-agent")?.match(/BudvikApp\/([\d.]+)/)?.[1];
  const userId = device?.userId ?? (session?.user as { id?: string } | undefined)?.id;
  if (installed && userId) {
    // Помилка запису тут не має ламати перевірку оновлень: це довідка
    // для офісу, а не частина відповіді застосунку.
    await prisma.syncState
      .upsert({
        where: { key: `app:installed:${userId}` },
        create: { key: `app:installed:${userId}`, value: installed },
        update: { value: installed },
      })
      .catch(() => {});
  }

  let sizeBytes: number;
  try {
    sizeBytes = (await stat(APK_PATH)).size;
  } catch {
    /*
     * Файлу немає — кажемо прямо. Застосунок на такій відповіді просто
     * не показує кнопку: пропонувати оновлення, яке не завантажиться,
     * гірше, ніж не пропонувати нічого.
     */
    console.error("[app/version] APK не знайдено:", APK_PATH);
    return NextResponse.json({ error: "Збірка недоступна" }, { status: 503 });
  }

  return NextResponse.json(
    {
      versionCode: CURRENT_VERSION_CODE,
      versionName: CURRENT_VERSION_NAME,
      sizeBytes,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
