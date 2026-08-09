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

export async function alertAgentSilent(lastSeen: Date, hours: number): Promise<void> {
  await alert(
    `🔕 <b>Агент 1С мовчить</b>\n` +
      `Останній зв'язок: ${lastSeen.toLocaleString("uk-UA")} (${hours} год тому)\n\n` +
      `Перевірте службу BudvikSyncAgent на сервері 1С.`
  );
}
