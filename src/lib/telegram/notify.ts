/**
 * Мінімальний клієнт Telegram Bot API для повідомлень зі сторони адмінки.
 * Сам бот живе окремим воркером на Railway — тут лише вихідні сповіщення.
 *
 * Помилки надсилання ніколи не кидаються назовні: невдале повідомлення в чат
 * не повинно ламати транзакцію прив'язки в адмінці.
 */

const BOT_TOKEN = process.env.TELEGRAM_SKLAD_BOT_TOKEN || "";
const API_BASE = "https://api.telegram.org";

/**
 * Результат надсилання. status потрібен рівно для одного випадку — 403
 * («bot was blocked by the user»): такого адресата немає сенсу смикати
 * далі, і розсилка замовлень вимикає його сама.
 */
export type SendResult = { ok: boolean; status: number | null };

export async function sendTelegramMessageResult(
  chatId: string,
  text: string
): Promise<SendResult> {
  if (!BOT_TOKEN) {
    console.warn("TELEGRAM_SKLAD_BOT_TOKEN не налаштовано — повідомлення не надіслано");
    return { ok: false, status: null };
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
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    console.error("Telegram sendMessage error:", e);
    return { ok: false, status: null };
  }
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  return (await sendTelegramMessageResult(chatId, text)).ok;
}

/**
 * Повідомити працівника, що адмін підтвердив прив'язку.
 * Текст залежить від ролі: у складовщика і торгового різні кнопки,
 * і загальна інструкція вела б до кнопки, якої в людини немає.
 */
export async function notifyWorkerLinked(
  telegramId: string,
  workerName: string,
  role: "WAREHOUSE" | "SALES" = "WAREHOUSE"
): Promise<boolean> {
  const roleLabel = role === "SALES" ? "торгового представника" : "складовщика";
  const button = role === "SALES" ? "🚗 Розпочати поїздку" : "🟢 Відкрити зміну";

  return sendTelegramMessage(
    telegramId,
    `✅ Вас підключено як ${roleLabel} — <b>${workerName}</b>.\n\n` +
      `Надішліть /start, щоб оновити клавіатуру, і натисніть «${button}».`
  );
}
