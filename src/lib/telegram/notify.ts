/**
 * Мінімальний клієнт Telegram Bot API для повідомлень зі сторони адмінки.
 * Сам бот живе окремим воркером на Railway — тут лише вихідні сповіщення.
 *
 * Помилки надсилання ніколи не кидаються назовні: невдале повідомлення в чат
 * не повинно ламати транзакцію прив'язки в адмінці.
 */

const BOT_TOKEN = process.env.TELEGRAM_SKLAD_BOT_TOKEN || "";
const API_BASE = "https://api.telegram.org";

export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.warn("TELEGRAM_SKLAD_BOT_TOKEN не налаштовано — повідомлення не надіслано");
    return false;
  }

  try {
    const res = await fetch(`${API_BASE}/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      console.error("Telegram sendMessage failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Telegram sendMessage error:", e);
    return false;
  }
}

/** Повідомити складовщика, що адмін підтвердив прив'язку. */
export async function notifyWorkerLinked(
  telegramId: string,
  workerName: string
): Promise<boolean> {
  return sendTelegramMessage(
    telegramId,
    `✅ Вас підключено як <b>${workerName}</b>.\n\n` +
      "Надішліть /start, щоб оновити клавіатуру, і натисніть «📍 Відкрити зміну»."
  );
}
