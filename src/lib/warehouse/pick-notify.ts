/**
 * «У накладній зʼявилася нова позиція» — сповіщення тому, хто її збирає.
 *
 * Причина, з якої це взагалі потрібно: менеджер набирає накладну протягом
 * дня, а склад збирає її паралельно. Людина винесла коробку, вважає роботу
 * зробленою — і не знає, що через десять хвилин у документ дописали ще два
 * рядки. Дізнається вона про це від водія, коли машина вже завантажена.
 *
 * Два правила, які тримають це від перетворення на спам:
 *
 * 1. Сповіщаємо ЛИШЕ про накладні, за які людина вже взялася (є хоч одна
 *    позначка «зібрано»), і лише тих, хто їх збирає. Нова накладна сама по
 *    собі — не подія: їх десятки на день, і склад бачить їх у списку.
 * 2. Знімок «що я вже бачив» ставиться в мить, коли людина відмічає першу
 *    позицію. Усе, що дописали після, — новина; усе, що було до, — ні.
 *
 * Модуль не імпортує нічого з next/*: він викликається з обміну, який має
 * працювати і в воркері на Railway (див. CLAUDE.md).
 */

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push/send";
import { sendTelegramMessage } from "@/lib/telegram/notify";

/**
 * Запамʼятати поточний склад накладної як «уже бачений».
 *
 * Викликається, коли складовщик відмічає першу позицію. Ідемпотентно:
 * повторний виклик нічого не змінює (unique на парі документ+товар).
 */
export async function baselineSeenLines(salesDocumentId: string): Promise<void> {
  const [items, seen] = await Promise.all([
    prisma.salesDocumentItem.findMany({
      where: { salesDocumentId },
      select: { productId: true },
    }),
    prisma.pickSeenLine.count({ where: { salesDocumentId } }),
  ]);

  // Знімок уже є — людина взялася раніше, і переписувати його не можна:
  // це стерло б памʼять про те, що вже бачили.
  if (seen > 0 || items.length === 0) return;

  await prisma.pickSeenLine.createMany({
    data: Array.from(new Set(items.map((i) => i.productId))).map((productId) => ({
      salesDocumentId,
      productId,
    })),
    skipDuplicates: true,
  });
}

/**
 * Перевірити накладні, які щойно приїхали з обміну, і сповістити про дописане.
 *
 * `externalIds` — те, що прийшло в пачці. Далі відсіюємо все, за що ніхто не
 * брався: у типовій пачці таких 60 із 64.
 *
 * Нічого не кидає: обмін не має падати через сповіщення.
 */
export async function notifyNewPickLines(externalIds: string[]): Promise<void> {
  if (externalIds.length === 0) return;

  try {
    const docs = await prisma.salesDocument.findMany({
      where: {
        externalId: { in: externalIds },
        docType: "REALIZATION",
        // Взялися = є хоч одна позначка. Без цього перевіряли б усі
        // документи бази щоп'ять хвилин заради нікому не потрібної різниці.
        pickMarks: { some: {} },
      },
      select: {
        id: true,
        number: true,
        counterparty: { select: { name: true } },
        items: { select: { productId: true, product: { select: { name: true } } } },
        pickSeenLines: { select: { productId: true } },
        pickMarks: { select: { userId: true, user: { select: { telegramId: true } } } },
      },
    });

    for (const doc of docs) {
      // Знімка немає — людина ще не бачила документа цілком; вважаємо все
      // баченим і мовчимо. Інакше перший же обмін після взяття в роботу
      // прислав би сповіщення про рядки, які вона щойно й дивилася.
      if (doc.pickSeenLines.length === 0) {
        await baselineSeenLines(doc.id);
        continue;
      }

      const seen = new Set(doc.pickSeenLines.map((s) => s.productId));
      const fresh = new Map<string, string>();
      for (const item of doc.items) {
        if (seen.has(item.productId)) continue;
        fresh.set(item.productId, item.product.name);
      }
      if (fresh.size === 0) continue;

      const names = [...fresh.values()];
      const head = names[0].slice(0, 60);
      const body =
        names.length === 1 ? head : `${head} і ще ${names.length - 1}`;

      /**
       * Спершу запис, потім надсилання.
       *
       * Якщо Expo не відповість, людина не отримає сповіщення — але побачить
       * рядок на екрані. А от повторне сповіщення про ту саму позицію кожні
       * пʼять хвилин, поки Expo лежить, — це те, після чого сповіщення
       * вимикають назавжди.
       */
      await prisma.pickSeenLine.createMany({
        data: [...fresh.keys()].map((productId) => ({ salesDocumentId: doc.id, productId })),
        skipDuplicates: true,
      });

      const title = `№${doc.number}: ${fresh.size === 1 ? "нова позиція" : `нових позицій: ${fresh.size}`}`;

      /**
       * Два канали, і Telegram тут НЕ запасний — не видаляйте його, коли
       * пуші почнуть ходити.
       *
       * Причина, з якої обидва лишаються назавжди: Android не доставляє
       * «примусово зупиненому» застосунку НІЧОГО — ні пуша, ні будильника,
       * ні широкомовлення. А застосунок стає таким від одного змаху зі
       * списку відкритих, і саме це на складі роблять щодня: планшет лежить
       * на стелажі, його беруть у руки, гортають, змахують. Прапорець
       * `urgent` пробиває режим сну, але цей стан не пробиває ніщо.
       *
       * Telegram у складовщика прив'язаний до того самого бота Budvik_Sklad
       * і приходить незалежно від стану застосунку.
       *
       * (Історія: до 08.09.2026 пуші не ходили взагалі — у проєкті не було
       * ключів FCM, і реєстрація мовчки падала з «Default FirebaseApp is not
       * initialized». Тоді Telegram був єдиним живим каналом; тепер він
       * просто другий із двох.)
       */
      const workers = new Map<string, string | null>();
      for (const m of doc.pickMarks) workers.set(m.userId, m.user.telegramId ?? null);

      await Promise.all(
        [...workers].flatMap(([userId, telegramId]) => [
          sendPushToUser(userId, {
            title,
            body: `${doc.counterparty?.name ?? "Накладна"} — ${body}`,
            data: { screen: "/cabinet", target: `/warehouse/picking/${doc.id}` },
            /**
             * Пробивати режим сну тут доречно, і не заради терміновості.
             *
             * Складовщик кладе планшет на стелаж і йде носити коробки —
             * екран гасне, Android притишує все, що прийшло без високого
             * пріоритету. Саме в цю мить менеджер і дописує рядок. Тихе
             * сповіщення людина побачить, коли машина вже поїде.
             */
            urgent: true,
          }),
          telegramId
            ? sendTelegramMessage(
                telegramId,
                `📦 <b>${title}</b>\n${doc.counterparty?.name ?? ""}\n${names.map((n) => `• ${n}`).join("\n")}`
              ).then(() => undefined)
            : Promise.resolve(),
        ])
      );
    }
  } catch (e) {
    console.error("[pick-notify] не вдалося сповістити про нові позиції:", e);
  }
}
