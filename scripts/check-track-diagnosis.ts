/**
 * Що діагноз каже про типові дні — на вигаданих, але списаних із життя станах.
 *
 * Тестового раннера в проєкті немає, тому перевірка живе тут. `diagnose` —
 * чиста функція, тож ні бази, ні мережі не треба:
 *   npx tsx scripts/check-track-diagnosis.ts
 *
 * Кожен випадок нижче колись коштував робочого дня, і саме тому він тут.
 */

import { diagnose, type DeviceBeat } from "../src/lib/track/diagnosis";

let failed = 0;

function check(name: string, got: string | null, want: string | null | RegExp) {
  const ok =
    want instanceof RegExp ? got != null && want.test(got) : got === want;
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}\n      маємо: ${got}\n      треба: ${want}`);
  }
}

/** Здоровий пульс: усе гаразд, поки явно не зіпсуємо поле. */
function beat(over: Partial<DeviceBeat> = {}): DeviceBeat {
  return {
    minutesAgo: 2,
    tracking: true,
    buffered: 0,
    lastFixMinutesAgo: 1,
    lastFixAccuracyM: 12,
    locationPermission: "ALWAYS",
    locationMode: "GPS",
    batteryOptimized: false,
    lastError: null,
    ...over,
  };
}

console.log("\nТочки — головніший доказ за пульс");
/**
 * 04.09: Передрій написав 1845 точок і 2 пульси — сторож на TB350XU спить.
 * Карта весь день казала «застосунок мовчить» про планшет, який працював.
 */
check(
  "Пульс шестигодинної давності при свіжих точках — не проблема",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ minutesAgo: 392, lastFixMinutesAgo: 1052 }),
    lastPointMinutesAgo: 0,
  }),
  null
);
check(
  "Свіжі точки не дають сказати «GPS не дає координат»",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ minutesAgo: 14, lastFixMinutesAgo: 15 }),
    lastPointMinutesAgo: 0,
  }),
  null
);

console.log("\nЩо лишається видимим навіть при живих точках");
/** Серпень Валентина: трек писався по вежах, і з вигляду все було справне. */
check(
  "Вимкнений перемикач локації видно й при свіжих точках",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ locationMode: "OFF" }),
    lastPointMinutesAgo: 1,
  }),
  /по вежах/
);
check(
  "Дозвіл «лише поки відкрито» теж",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ locationPermission: "WHILE_USING" }),
    lastPointMinutesAgo: 1,
  }),
  /у фоні запис зупиниться/
);

console.log("\nОбрив треку");
check(
  "Мовчать і пульс, і точки — називаємо обидва числа",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ minutesAgo: 86, lastFixMinutesAgo: 90 }),
    lastPointMinutesAgo: 88,
  }),
  "Трек стоїть 88 хв, застосунок мовчить 86 хв"
);
check(
  "Обрив на ходу називає швидкість",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ minutesAgo: 40, lastFixMinutesAgo: 45 }),
    lastPointMinutesAgo: 42,
    lastPointSpeedKmh: 63,
  }),
  /НА ХОДУ \(63 км\/год\)/
);
/**
 * Стан, якого діагноз не вмів назвати зовсім: у застосунку загубився режим
 * запису, рекордер викидає всю пачку, а пульс при цьому бездоганний.
 */
check(
  "Координати є, а точок немає — окремий стан",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ minutesAgo: 2, lastFixMinutesAgo: 1 }),
    lastPointMinutesAgo: 40,
  }),
  /в трек нічого не лягло 40 хв/
);

console.log("\nТрек, який не почався");
/**
 * 05.09: Валентин відкрив зміну о 08:07, за 24 хвилини жодної точки, а
 * остання точка взагалі — учорашня. Стара фраза казала «трек стоїть 1139 хв».
 */
check(
  "Зміна відкрита, а точок у ній ще не було",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ minutesAgo: 23, lastFixMinutesAgo: 1139, tracking: false }),
    lastPointMinutesAgo: 1139,
    shiftMinutes: 24,
    hasPointsInShift: false,
  }),
  "Зміна відкрита 24 хв, а трек не почався — відкрийте застосунок на планшеті"
);
check(
  "Перші хвилини зміни ще не привід тривожити",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ minutesAgo: 2 }),
    lastPointMinutesAgo: 600,
    shiftMinutes: 4,
    hasPointsInShift: false,
  }),
  null
);
check(
  "Коли точки в зміні є, фраза не спрацьовує",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ minutesAgo: 2 }),
    lastPointMinutesAgo: 1,
    shiftMinutes: 120,
    hasPointsInShift: true,
  }),
  null
);

console.log("\nСтаре поводження не змінилося");
check("Планшета немає", diagnose({ hasDevice: false, shiftOpen: true, beat: null }), "Планшет не зареєстрований");
check(
  "Закрита зміна без пульсу — не проблема",
  diagnose({ hasDevice: true, shiftOpen: false, beat: null }),
  null
);
check(
  "Буфер росте, а зв'язок є",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ buffered: 400 }),
    lastPointMinutesAgo: 30,
  }),
  /перезапустіть застосунок/
);
check(
  "У приміщенні — не поламка",
  diagnose({
    hasDevice: true,
    shiftOpen: true,
    beat: beat({ lastFixAccuracyM: 900 }),
    lastPointMinutesAgo: 30,
  }),
  /У приміщенні/
);
check(
  "Пульсу немає, точок немає, зміна відкрита",
  diagnose({ hasDevice: true, shiftOpen: true, beat: null }),
  /Пульсу немає/
);
check(
  "Пульсу немає, але точки йдуть — стара збірка робить своє",
  diagnose({ hasDevice: true, shiftOpen: true, beat: null, lastPointMinutesAgo: 2 }),
  null
);

console.log(failed === 0 ? "\nУсе зійшлося.\n" : `\nНе зійшлося: ${failed}.\n`);
process.exit(failed === 0 ? 0 : 1);
