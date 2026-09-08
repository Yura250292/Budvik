/**
 * Перевірка пробудження: чи справді сповіщення будить застосунок.
 *
 * Це не діагностика, а натискання на кнопку: скрипт робить рівно те, що
 * робитиме воркер, коли побачить мертвий трек. Перевіряти інакше нічим —
 * штучно вбити службу на чужому планшеті ми не можемо, а чекати справжньої
 * поламки означає дізнатися про результат випадково й нескоро.
 *
 * Доказом буде не сам факт відправки (Expo відповість «ok» і на адресу
 * вимкненого планшета), а подія `wake` у журналі пристрою через хвилину.
 *
 *   npx tsx scripts/test-wake-push.mts Кавецький
 */
import { prisma } from "../src/lib/prisma";
import { sendPushToUser } from "../src/lib/push/send";

async function main() {
  const who = process.argv[2];
  if (!who) {
    console.error("Вкажіть частину імені: npx tsx scripts/test-wake-push.mts Кавецький");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: { name: { contains: who, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!user) {
    console.error(`Не знайшов людину за «${who}»`);
    process.exit(1);
  }

  const tokens = await prisma.pushToken.count({ where: { userId: user.id, revokedAt: null } });
  console.log(`${user.name}: живих адрес для сповіщень — ${tokens}`);
  if (tokens === 0) {
    console.error("Адреси немає: планшет ще не на 1.6.2 або не відкривав застосунок після оновлення.");
    process.exit(1);
  }

  const before = await prisma.trackEvent.count({ where: { userId: user.id, kind: "wake" } });

  /**
   * Тихе — точно таке, як шле воркер. Видиме сповіщення тут було б не лише
   * зайвим для людини, а й неправильною перевіркою: Android віддає його в
   * шторку, застосунок не будить, і ми знову міряли б не те.
   */
  await sendPushToUser(user.id, {
    silent: true,
    urgent: true,
    data: { screen: "/shift", reason: "test" },
  });
  console.log("Надіслано. Чекаю на подію «wake» у журналі планшета…\n");

  /**
   * Хвилина очікування: доставка йде секунди, але планшет міг бути в
   * глибокому сні, а підйом JS із нуля на слабкому планшеті — це ще кілька
   * секунд. Довше чекати немає сенсу: не прийшло за хвилину — не прийде.
   */
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const rows = await prisma.trackEvent.findMany({
      where: { userId: user.id, kind: "wake" },
      orderBy: { at: "desc" },
      take: 3,
      select: { at: true, note: true },
    });
    if (rows.length > before) {
      console.log("✅ ПРАЦЮЄ: планшет прокинувся від сповіщення.");
      for (const r of rows.reverse()) {
        const hm = r.at.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
        console.log(`   ${hm}  ${r.note}`);
      }
      return;
    }
    process.stdout.write(".");
  }
  console.log("\n⚠️  Події «wake» немає за хвилину.");
  console.log("   Можливі причини: планшет вимкнений; застосунок змахнули зі списку");
  console.log("   відкритих (тоді Android не доставляє нічого); немає мережі.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
