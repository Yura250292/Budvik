/** Проба ланцюга точності на відомих адресах. Лише читання, без бази. */
import { locateClient } from "../src/lib/geo/locate-client";
import { cleanAddress, settlementOf, shopNameOf } from "../src/lib/geo/clean-address";
import { searchBoxFor } from "../src/lib/geo/region";

const cases: Array<[string, string]> = [
  ["м. Жовква, вул. Б.Хмельницького, 8, магазин Будівельник", "тест"],
  ["м.Камянка -Бузька, вул.Незалежності ,79,", "тест"],
  ["м. Стрий, базар, контейнер 111", "тест"],
  ["м. Львів", "тест"],
  ["м.Бібрка, вул.Крушельницької 3", "тест"],
  ["м.Стрий, Базар, вул.Зелена 25 маг.Садиба", "тест"],
  ["81435,Львівська обл.,Самбірський р-н,с. Луки,вул.Шевченка,буд.57", "тест"],
  ["м..Львів, вул.Городницька,47 маг.Е1", "тест"],
  ["НОВА ПОШТА №  2,с.Солочин ,Пункт приймання -видачі", "тест"],
  ["", "Мартинець Уляна (м.Мостиська)"],
  // Доставка в інші міста не має переїжджати на Львівщину.
  ["НОВА ПОШТА №1, Ахтирка ,вул. Шевченка ,3", "тест"],
  ["MeestПОШТА №73,Чернігів,вул.просп.Мира,49", "тест"],
  ["с-ще Вільшана (Черкаська обл.), НП, Відділення №1, вул. Шевченка 57", "тест"],
];
for (const [addr, name] of cases) {
  const t = Date.now();
  const loc = await locateClient(addr, name);
  console.log(
    `${(addr || name).slice(0, 55).padEnd(56)} box=${searchBoxFor(addr) ? "L" : "-"} city=${settlementOf(addr) ?? "-"} shop=${shopNameOf(addr) ?? "-"}\n   clean=${cleanAddress(addr, { lviv: !!searchBoxFor(addr), requireSettlement: true }) ?? "-"}\n   → ${loc ? `${loc.geoSource}/${loc.precision} via ${loc.via} ${loc.lat.toFixed(5)},${loc.lng.toFixed(5)} ${loc.label.slice(0, 70)}` : "null"}  (${((Date.now() - t) / 1000).toFixed(0)} с)`
  );
}

// Ринок завжди приблизний, «площа Ринок» — ні.
for (const addr of ["м. Львів, вул. Кукурудзяна, 1-3 — ринок «Торпедо», перший ряд", "м. Львів, вул. Площа Ринок ,10 Копальня кави"]) {
  const loc = await locateClient(addr, "тест");
  console.log(`${addr.slice(0, 55).padEnd(56)} → ${loc ? `${loc.geoSource}/${loc.precision} ${loc.label.slice(0, 60)}` : "null"}`);
}

// Миколаїв біля Стрия і ринок без слова «ринок».
for (const addr of ["м.Миколаїв, вул.Воз'єднання 11 маг.Бригадир", "Торпедо №227 (центальний ряд, від кільця третя будка)", "м.Івано-Франково  / магазин Все для саду та городу"]) {
  const loc = await locateClient(addr, "тест");
  console.log(`${addr.slice(0, 55).padEnd(56)} → ${loc ? `${loc.geoSource}/${loc.precision} ${loc.lat.toFixed(3)},${loc.lng.toFixed(3)} ${loc.label.slice(0, 60)}` : "null"}`);
}
