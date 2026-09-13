/**
 * Виписка по клієнту — чиста збірка, без бази.
 *
 * «Скиньте клієнту акт звірки» — один із частих дзвінків торгового в офіс.
 * Офіційний акт робить бухгалтерія в 1С; тут — довідкова виписка, яку
 * торговий пересилає сам: відвантаження, повернення й оплати за період і
 * борг за даними 1С.
 *
 * ЧОМУ ПОЧАТКОВЕ САЛЬДО РОЗРАХУНКОВЕ. Кінцеве сальдо — з регістра
 * взаєморозрахунків 1С (Counterparty.receivableBalance), воно правдиве.
 * Початкового в базі немає: щоденні знімки DebtSnapshot пишуться лише для
 * ненульових рядків регістра (12–105 клієнтів на день із ~500), тож
 * відсутній знімок не означає нуль. Тому початок = кінець мінус рухи за
 * період, і так і підписано. У регістрі 1С бувають операції, яких немає
 * серед наших документів і ПКО (коригування, взаємозаліки) — тоді
 * розрахунковий початок відрізнятиметься від 1С на їхню суму.
 */

export type StatementKind = "SALE" | "RETURN" | "PAYMENT";

export type StatementEntry = {
  at: Date;
  kind: StatementKind;
  /** «Реалізація №6553», «Повернення №419/2026», «Оплата». */
  label: string;
  /** Вплив на борг: відвантаження +, повернення −, оплата −. */
  amount: number;
  docId?: string;
};

export type StatementRow = StatementEntry & { balance: number };

export type StatementResult = {
  opening: number;
  shipped: number;
  returned: number;
  paid: number;
  closing: number;
  rows: StatementRow[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildStatement(entries: StatementEntry[], closing: number): StatementResult {
  const rows = [...entries].sort((a, b) => a.at.getTime() - b.at.getTime());
  const movement = rows.reduce((s, e) => s + e.amount, 0);
  const opening = round2(closing - movement);

  let balance = opening;
  let shipped = 0;
  let returned = 0;
  let paid = 0;
  const out: StatementRow[] = rows.map((e) => {
    balance = round2(balance + e.amount);
    if (e.kind === "SALE") shipped += e.amount;
    else if (e.kind === "RETURN") returned += -e.amount;
    else paid += -e.amount;
    return { ...e, balance };
  });

  return {
    opening,
    shipped: round2(shipped),
    returned: round2(returned),
    paid: round2(paid),
    closing: round2(closing),
    rows: out,
  };
}

/** «00000006553» → «6553», «00000000419/2026» → «419/2026». */
export function docNo(number: string): string {
  const [head, ...rest] = number.split("/");
  const trimmed = head.replace(/^0+(?=\d)/, "");
  return [trimmed, ...rest].join("/");
}

/**
 * Підпис оплати з notes ПКО. Обмін кладе туди «№00000005356 (1С)» — у
 * виписці клієнту це шум; лишаємо «Оплата ПКО №5356». Без номера — «Оплата».
 */
export function paymentLabel(notes: string | null | undefined): string {
  const m = notes?.match(/№\s*0*(\d+)/);
  return m ? `Оплата ПКО №${m[1]}` : "Оплата";
}

/** «12 400,00» з нерозривними пробілами; мінус — справжній «−». */
export function money2(n: number): string {
  const s = Math.abs(n)
    .toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\s/g, " ");
  return n < 0 ? `−${s}` : s;
}

/** Дата 1С «дд.мм» — стінний час, записаний як UTC. */
export function wallDay(at: Date): string {
  return at.toLocaleDateString("uk-UA", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
}

/** Текст для пересилання клієнту в месенджер. */
export function statementText(input: {
  clientName: string;
  fromDay: string;
  toDay: string;
  result: StatementResult;
  closingAt: string | null;
}): string {
  const d = (day: string) => day.split("-").reverse().join(".");
  const r = input.result;
  const lines = [
    "Виписка по клієнту",
    input.clientName,
    `Період: ${d(input.fromDay)} — ${d(input.toDay)}`,
    "",
    `Сальдо на початок (розрахунково): ${money2(r.opening)} ₴`,
    ...r.rows.map((row) => {
      const sign = row.amount >= 0 ? "+" : "−";
      return `${wallDay(row.at)} ${row.label} ${sign}${money2(Math.abs(row.amount))}`;
    }),
    "",
    `Відвантажено: ${money2(r.shipped)} ₴`,
    `Повернено: ${money2(r.returned)} ₴`,
    `Оплачено: ${money2(r.paid)} ₴`,
    `Борг за даними 1С${input.closingAt ? ` на ${input.closingAt}` : ""}: ${money2(r.closing)} ₴`,
    "",
    "Довідково. Офіційний акт звірки — з 1С.",
  ];
  return lines.join("\n");
}
