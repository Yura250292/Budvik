/**
 * Перевірка виписки по клієнту без бази: сальдо, порядок, суми, текст.
 *
 *   npx tsx scripts/check-client-statement.mts
 */
import { buildStatement, docNo, money2, paymentLabel, statementText } from "../src/lib/clients/statement-build";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

const at = (s: string) => new Date(`${s}Z`);
const r = buildStatement(
  [
    { at: at("2026-09-12T11:00:00"), kind: "PAYMENT", label: "Оплата", amount: -3000 },
    { at: at("2026-09-10T09:00:00"), kind: "SALE", label: "Реалізація №6553", amount: 5280 },
    { at: at("2026-09-11T15:00:00"), kind: "RETURN", label: "Повернення №419/2026", amount: -129.5 },
  ],
  20900
);
check("початок = кінець − рухи", r.opening === 18749.5, r.opening);
check("рядки за часом", r.rows.map((x) => x.kind).join() === "SALE,RETURN,PAYMENT", r.rows.map((x) => x.kind));
check("біжуче сальдо сходиться до кінця", r.rows[r.rows.length - 1].balance === 20900, r.rows.map((x) => x.balance));
check("суми: відвантажено/повернено/оплачено", r.shipped === 5280 && r.returned === 129.5 && r.paid === 3000, r);
const empty = buildStatement([], 1500);
check("без рухів початок = кінець", empty.opening === 1500 && empty.rows.length === 0);
check("переплата: борг від'ємний тримає знак", buildStatement([], -3559).closing === -3559);

check("docNo: провідні нулі", docNo("00000006553") === "6553");
check("docNo: з роком", docNo("00000000419/2026") === "419/2026");
check("docNo: нуль лишається нулем", docNo("0000") === "0");
check("оплата: номер ПКО без нулів і «(1С)»", paymentLabel("№00000005356 (1С)") === "Оплата ПКО №5356", paymentLabel("№00000005356 (1С)"));
check("оплата: без номера", paymentLabel(null) === "Оплата" && paymentLabel("готівка") === "Оплата");
check("money2: копійки й пробіл", money2(12400) === "12 400,00", money2(12400));
check("money2: мінус", money2(-3559) === "−3 559,00", money2(-3559));

const t = statementText({ clientName: "ФОП Химич", fromDay: "2026-08-15", toDay: "2026-09-13", result: r, closingAt: "13.09 14:05" });
check("текст: шапка з періодом", t.includes("Період: 15.08.2026 — 13.09.2026"), t);
check("текст: рядок реалізації з плюсом", t.includes("10.09 Реалізація №6553 +5 280,00"), t);
check("текст: оплата з мінусом", t.includes("12.09 Оплата −3 000,00"), t);
check("текст: борг 1С з часом", t.includes("Борг за даними 1С на 13.09 14:05: 20 900,00 ₴"), t);
check("текст: застереження", t.endsWith("Довідково. Офіційний акт звірки — з 1С."));

console.log(failed ? `\n✗ помилок: ${failed}` : "\n✓ усе гаразд");
process.exit(failed ? 1 : 0);
