/**
 * Сповіщення про проблеми синхронізації в Telegram.
 *
 * Мовчазна синхронізація небезпечніша за зламану: якщо агент перестав
 * надсилати дані, сайт тижнями показуватиме застарілі залишки й ніхто цього
 * не помітить. Тому пороги нижче навмисно чутливі.
 *
 * Відсутність SYNC_ALERT_CHAT_ID не є помилкою — алерти просто не надсилаються.
 */

import { sendTelegramMessage } from "@/lib/telegram/notify";

/** Частка товарів зі зміненою ціною, вище якої прогін виглядає підозріло. */
export const PRICE_CHANGE_ALERT_RATIO = 0.1;
/** Скільки зниклих сутностей у повній звірці вважати аномалією. */
export const MISSING_ALERT_THRESHOLD = 50;

async function alert(text: string): Promise<void> {
  const chatId = process.env.SYNC_ALERT_CHAT_ID;
  if (!chatId) return;
  await sendTelegramMessage(chatId, text);
}

export async function alertRunFailed(runId: string, error: string): Promise<void> {
  await alert(
    `❌ <b>Синхронізація 1С впала</b>\n` +
      `Прогін: <code>${runId}</code>\n` +
      `Помилка: ${error.slice(0, 300)}`
  );
}

export async function alertMassPriceChange(
  runId: string,
  changed: number,
  total: number
): Promise<void> {
  const percent = total > 0 ? Math.round((changed / total) * 100) : 0;
  await alert(
    `⚠️ <b>Масова зміна цін з 1С</b>\n` +
      `Прогін: <code>${runId}</code>\n` +
      `Змінено цін: ${changed} з ${total} товарів (${percent}%)\n\n` +
      `Перевірте розбіжності в адмінці, якщо це не планова переоцінка.`
  );
}

export async function alertMissingEntities(runId: string, missing: number): Promise<void> {
  await alert(
    `⚠️ <b>Повна звірка: зниклі позиції</b>\n` +
      `Прогін: <code>${runId}</code>\n` +
      `Немає в 1С, але є на сайті: ${missing}\n\n` +
      `Товари НЕ деактивовані автоматично — рішення за адміністратором.`
  );
}

/**
 * Запит у 1С упав, але прогін завершився успішно.
 *
 * Борг і оплати читаються в кінці циклу як best-effort: помилка запиту не
 * зупиняє прогін, щоб не втратити вже прочитані документи. Ціна цього —
 * вотермарк просувається повз вікно, яке ніхто не прочитав, і повторного
 * читання не буде. Тому про кожен такий випадок треба знати одразу.
 */
export async function alertQueryFailed(
  runId: string,
  entity: string,
  message: string
): Promise<void> {
  await alert(
    `⚠️ <b>Запит «${entity}» пропущено</b>\n` +
      `Прогін: <code>${runId}</code> (завершився успішно)\n` +
      `Причина: ${message.slice(0, 300)}\n\n` +
      `Дані за це вікно не прочитані, вотермарк уже просунувся — ` +
      `повторно вони самі не підтягнуться.`
  );
}

/**
 * Звірка боргів відмовилась обнуляти: зниклих підозріло багато.
 *
 * Штатно за прогін закривається кілька боргів. Сотні «зниклих» означають
 * не масовий розрахунок, а обірваний зріз із 1С — і обнулення в такому разі
 * стерло б живу дебіторку. Тому звірка нічого не робить і кличе людину.
 */
export async function alertDebtReconcileSkipped(
  runId: string,
  stale: number,
  seen: number
): Promise<void> {
  await alert(
    `⚠️ <b>Звірку дебіторки пропущено</b>\n` +
      `Прогін: <code>${runId}</code>\n` +
      `Зникло з 1С: ${stale}, лишилось у зрізі: ${seen}\n\n` +
      `Це схоже на обірване вивантаження, тому сальдо НЕ обнулялись. ` +
      `Якщо наступні прогони покажуть те саме — перевірте запит боргу в агента.`
  );
}

/**
 * Звірка оплат відмовилась прибирати: непідтверджених підозріло багато.
 *
 * Розпроведення ордера — подія поштучна. Десятки одразу означають радше
 * обірване вивантаження, і видалення в такому разі стерло б живі гроші.
 */
export async function alertPaymentsReconcileSkipped(
  runId: string,
  stale: number,
  confirmed: number
): Promise<void> {
  await alert(
    `⚠️ <b>Звірку оплат пропущено</b>\n` +
      `Прогін: <code>${runId}</code>\n` +
      `Без підтвердження: ${stale}, підтверджено: ${confirmed}\n\n` +
      `Схоже на обірване вивантаження ПКО, тому оплати НЕ прибирались. ` +
      `Якщо повториться — перевірте запит оплат в агента.`
  );
}

export async function alertAgentSilent(lastSeen: Date, hours: number): Promise<void> {
  await alert(
    `🔕 <b>Агент 1С мовчить</b>\n` +
      `Останній зв'язок: ${lastSeen.toLocaleString("uk-UA")} (${hours} год тому)\n\n` +
      `Перевірте службу BudvikSyncAgent на сервері 1С.`
  );
}
