/**
 * Чи вигадує модель числа — і як часто.
 *
 * Кожне число у відповіді звіряється з тим, що справді повернули
 * інструменти того ходу (див. guards.ts). Тут — підсумок за два тижні:
 * скільки чисел перевірено й скільки не знайшлося в даних.
 *
 * Незвірене число не завжди галюцинація: модель могла додати дві суми,
 * яких їй показали окремо. Тому дивимось на ЧАСТКУ й на приклади, а не
 * на факт наявності.
 *
 *   npx tsx --env-file=.env scripts/assistant-guard-report.mts
 */

import { prisma } from "../src/lib/prisma";
import { readLog } from "../src/lib/assistant/number-guard";

const log = await readLog();
const days = Object.keys(log).sort();

if (days.length === 0) {
  console.log("Даних ще немає: жодної відповіді моделі після ввімкнення вартового.");
} else {
  console.log("день        | відповідей | чисел | не з даних | частка");
  let answers = 0, checked = 0, bad = 0;
  for (const day of days) {
    const d = log[day];
    answers += d.answers; checked += d.checked; bad += d.unverified;
    const share = d.checked > 0 ? `${((d.unverified / d.checked) * 100).toFixed(1)} %` : "—";
    console.log(
      `${day}  |${String(d.answers).padStart(11)} |${String(d.checked).padStart(6)} |${String(d.unverified).padStart(11)} |${share.padStart(7)}`
    );
    if (d.samples.length) console.log(`             приклади: ${d.samples.join(", ")}`);
  }
  const share = checked > 0 ? `${((bad / checked) * 100).toFixed(1)} %` : "—";
  console.log(`РАЗОМ       |${String(answers).padStart(11)} |${String(checked).padStart(6)} |${String(bad).padStart(11)} |${share.padStart(7)}`);
}

await prisma.$disconnect();
