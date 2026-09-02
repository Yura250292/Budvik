/**
 * Як виглядатимуть телеграм-звіти про зміни — до того, як їх побачить чат.
 *
 * Запуск:
 *   npx tsx scripts/check-shift-telegram-report.ts --dry
 *   npx tsx scripts/check-shift-telegram-report.ts --shift <id> --dry
 *   npx tsx scripts/check-shift-telegram-report.ts --shift <id> --send --chat <chat_id>
 *   npx tsx scripts/check-shift-telegram-report.ts --late --dry
 *
 * Навіщо окремий скрипт. Звіт зводить чотири різні джерела — одометр,
 * трек, годинник і замовлення з 1С, — і кожне з них має власну систему
 * координат (див. шапку telegram-report.ts). Помилку в такому зведенні
 * видно тільки на живих даних: синтетична зміна з рівними числами
 * зійдеться завжди. Тому тексти будуються з реальної бази, а надсилання
 * лишається окремим кроком з явним chat_id.
 *
 * Нічого не пише: лише читає базу й, на прохання, шле повідомлення.
 */

import { PrismaClient } from "@prisma/client";
import { buildShiftClosedMessage, buildShiftOpenedMessage } from "../src/lib/shift/telegram-report";
import { alertUnclosedShifts } from "../src/lib/shift/late-alert";
import { kyivDate, kyivTime } from "../src/lib/date/kyiv";
import { ordersSummaryForRep } from "../src/lib/track/orders-today";

const p = new PrismaClient();

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function show(shiftId: string) {
  const shift = await p.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      userId: true,
      status: true,
      startedAt: true,
      distanceKm: true,
      gpsDistanceKm: true,
      user: { select: { name: true } },
    },
  });
  if (!shift) {
    console.log(`Зміни ${shiftId} немає.`);
    return;
  }

  const day = kyivDate(shift.startedAt);
  console.log("─".repeat(64));
  console.log(
    `${shift.user.name ?? shift.userId} · ${day} ${kyivTime(shift.startedAt)} · ${shift.status}`
  );

  /**
   * Замовлення показуємо ще й окремим рядком — щоб було з чим звірити
   * колонку «Замовлень» у списку змін адмінки за той самий день. Якщо
   * числа розійдуться, помилка саме тут, а не в тексті повідомлення.
   */
  const orders = await ordersSummaryForRep(shift.userId, day);
  console.log(
    `   звірка з адмінкою: проведених ${orders.count} на ${orders.totalUah} грн, ` +
      `чернеток ${orders.draftCount} на ${orders.draftUah} грн (день ${day})`
  );
  console.log("─".repeat(64));

  console.log(await buildShiftOpenedMessage(shift.id));
  console.log();
  console.log(await buildShiftClosedMessage(shift.id, { reasonLine: "приклад причини від автозакриття" }));
  console.log();
}

async function main() {
  /**
   * Перевірка вечірнього сигналу.
   *
   * `--at 20:30` симулює вечір: удень функція мовчить за годинником, і
   * без підміни часу перевірити її можна було б лише ввечері. Мітки в
   * базі при цьому не ставляться (dryRun) — поставлена вдень, вона з'їла
   * б справжній сигнал того ж вечора.
   */
  if (has("late")) {
    const at = arg("at");
    let now = new Date();
    if (at) {
      const [h, m] = at.split(":").map(Number);
      // Київ = UTC+3 влітку; для перевірки достатньо, зимою вкажіть --at на годину пізніше.
      now = new Date(`${kyivDate(new Date())}T${String(h).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}:00+03:00`);
    }

    console.log(`Момент перевірки: ${kyivTime(now)} за Києвом\n`);
    const decisions = await alertUnclosedShifts(now, { dryRun: !has("send") });

    if (decisions.length === 0) {
      console.log("Сигналів не буде: або ще не вечір, або незакритих змін немає.");
    }
    for (const d of decisions) {
      console.log(
        `  ${d.send ? "СИГНАЛ" : "пропуск"} · ${d.name ?? d.shiftId} · з ${kyivTime(d.startedAt)} — ${d.reason}`
      );
    }
    console.log(
      has("send")
        ? "\n(--send: сигнали надіслано, мітки поставлено)"
        : "\n(без --send: нічого не надіслано, мітки не ставились)"
    );
    await p.$disconnect();
    return;
  }

  const one = arg("shift");
  if (one) {
    await show(one);
  } else {
    const recent = await p.shift.findMany({
      where: { endedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { id: true },
    });
    if (recent.length === 0) console.log("Закритих змін у базі немає.");
    for (const s of recent) await show(s.id);
  }

  /**
   * Надсилання — лише з явним чатом. Взяти канал зі змінних оточення тут
   * було б зручно й неправильно: перевірка не має шуміти в робочий чат.
   */
  if (has("send")) {
    const chat = arg("chat");
    const shiftId = one;
    if (!chat || !shiftId) {
      console.log("\nДля надсилання потрібні і --shift <id>, і --chat <chat_id>.");
    } else {
      const { notifyShiftClosed, notifyShiftOpened } = await import(
        "../src/lib/shift/telegram-report"
      );
      await notifyShiftOpened(shiftId, null, { chatId: chat });
      await notifyShiftClosed(shiftId, { chatId: chat });
      console.log(`\nНадіслано в чат ${chat}.`);
    }
  }

  await p.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
