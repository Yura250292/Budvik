/**
 * Зіставлення торгового з 1С з користувачем сайту (src/lib/sync-ingest/rep-names.ts).
 *
 * Правило обміну: людина сайту — та, чиї всі слова імені є в імені з 1С, і
 * така одна. 24.09.2026: 1С перейменувала «Калашник Дарья» на «Калашник Дар`я
 * Олександрівна» (зворотний апостроф) — і 756 разів обмін писав «торгового не
 * знайдено». Апострофи всіх видів тепер одне й те саме.
 *
 *   npx tsx scripts/check-rep-names.mts
 *
 * Бази не торкається.
 */

import { matchRepByName } from "../src/lib/sync-ingest/rep-names";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${JSON.stringify(got)}`);
  if (!ok) fails.push(name);
}

const users = [
  { id: "daria", name: "Калашник Дар'я" },
  { id: "office", name: "Офіс" },
  { id: "kulyk", name: "Кулик Дмитро" },
  { id: "peredrii", name: "Передрій Дмитро" },
  { id: "lev", name: "Олександр Левкович" },
  { id: "pats", name: "Валентин Пац" },
];

check("«Калашник Дар`я Олександрівна» (зворотний апостроф) — Дар'я", matchRepByName("Калашник Дар`я Олександрівна", users) === "daria", matchRepByName("Калашник Дар`я Олександрівна", users));
check("типографський апостроф ’ — теж", matchRepByName("Калашник Дар’я", users) === "daria", matchRepByName("Калашник Дар’я", users));
check("модифікатор ʼ — теж", matchRepByName("Калашник Дарʼя", users) === "daria", matchRepByName("Калашник Дарʼя", users));
check("«Левкович Олександр» — Олександр Левкович", matchRepByName("Левкович Олександр", users) === "lev", matchRepByName("Левкович Олександр", users));
check("«Сенькаєв  Олександр Олександрович» — нікому", matchRepByName("Сенькаєв  Олександр Олександрович", users) === null, matchRepByName("Сенькаєв  Олександр Олександрович", users));
check("«Пац Валентин» — Валентин Пац", matchRepByName("Пац Валентин", users) === "pats", matchRepByName("Пац Валентин", users));
check("«Кулик Дмитро» — Кулик, не Передрій", matchRepByName("Кулик Дмитро", users) === "kulyk", matchRepByName("Кулик Дмитро", users));
check("незнайомий — нікому", matchRepByName("Козар Ярослав", users) === null, matchRepByName("Козар Ярослав", users));
{
  // Двоє на сайті лише з іменем «Дмитро» — неоднозначно, не вгадуємо.
  const two = [{ id: "a", name: "Дмитро" }, { id: "b", name: "Дмитро" }];
  check("два однакові кандидати — нікому", matchRepByName("Кулик Дмитро", two) === null, matchRepByName("Кулик Дмитро", two));
}

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
