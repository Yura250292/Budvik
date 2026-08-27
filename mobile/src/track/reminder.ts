/**
 * Нагадування закрити зміну — на самому пристрої, без сервера.
 *
 * Порядок подій увечері такий: спершу застосунок питає людину, і лише
 * якщо вона не відповіла — о 20:00 зміну закриває сервер за зупинкою в
 * треку. Тобто це не дублювання автозакриття, а спроба обійтися без
 * нього: закрита фото зміна має чесний одометр, а закрита сервером —
 * лише здогадку, яку потім доводиться звіряти.
 *
 * Локальні, а не push: push-токенів у робочих акаунтах немає жодного, а
 * нагадування має спрацювати й тоді, коли планшет цілий день без
 * мережі. Система тримає розклад сама, застосунок для цього навіть не
 * мусить бути запущений.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { SHIFT_CHANNEL } from "./notify";

/**
 * О котрій нагадувати. Перше — коли робочий день уже скінчився в
 * більшості (найпізніший звичний фініш у базі — 20:10), друге — остання
 * спроба перед тим, як о 20:00–23:00 за справу візьметься сервер.
 */
const HOURS: Array<{ hour: number; minute: number; body: string }> = [
  {
    hour: 19,
    minute: 30,
    body: "Якщо ви вже закінчили — сфотографуйте одометр, поки машина поруч.",
  },
  {
    hour: 21,
    minute: 0,
    body: "Зміна досі відкрита. Скоро її закриє система — за часом, коли машина стала, і без фото одометра.",
  },
];

/** Позначка в даних сповіщення: за нею відрізняємо свої від чужих. */
const TAG = "shift-close-reminder";

/**
 * Ставить нагадування на сьогоднішній вечір.
 *
 * Час, що вже минув, пропускаємо: зміна, відкрита о 20:30, не має
 * отримати сповіщення «за 19:30» негайно — система показала б його
 * тієї ж секунди.
 */
export async function scheduleCloseReminders(now: Date = new Date()): Promise<void> {
  try {
    await cancelCloseReminders();

    const perm = await Notifications.getPermissionsAsync().catch(() => null);
    // Дозволу немає — не просимо його тут: людина щойно натиснула
    // «відкрити зміну», і діалог посеред цього шляху лише заважає.
    if (perm && !perm.granted) return;

    for (const { hour, minute, body } of HOURS) {
      const at = new Date(now);
      at.setHours(hour, minute, 0, 0);
      if (at.getTime() <= now.getTime()) continue;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Зміна ще відкрита",
          body,
          /**
           * Куди вести — назвою екрана, а не адресою зі схемою.
           *
           * Тут була схема `budvik27://` — а це схема МАГАЗИННОЇ збірки;
           * у робочої вона `budvik27staff://` (різні навмисно, бо обидві
           * можуть стояти на одному планшеті). Сповіщення все одно
           * обробляється всередині застосунку, тож схема тут не потрібна
           * зовсім, а неправильна — це майбутній перехід не туди.
           */
          data: { tag: TAG, screen: "/shift" },
          ...(Platform.OS === "android" ? { channelId: SHIFT_CHANNEL } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
        },
      });
    }
  } catch {
    // Сповіщення — підказка, а не робота: збій тут не має заважати
    // відкрити зміну.
  }
}

/**
 * Знімає всі свої нагадування.
 *
 * Викликається звідусіль, де зміна перестала бути відкритою: закриття
 * фото, пізнє закриття, автозакриття сервером, вихід з акаунта. Якщо
 * пропустити хоч один шлях, людина отримає ввечері «зміна ще відкрита»
 * після того, як сама її закрила, — а сповіщення, яке бреше, гірше за
 * відсутнє: наступного разу його вимкнуть разом з усіма іншими.
 */
export async function cancelCloseReminders(): Promise<void> {
  try {
    const planned = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      planned
        .filter((n) => n.content.data?.tag === TAG)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}))
    );
  } catch {
    // мовчки
  }
}
