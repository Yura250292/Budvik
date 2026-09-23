/**
 * Бектест сезонного профілю — ГЕЙТ випуску. READ ONLY.
 *
 * Питання, на яке відповідає цей скрипт, одне: чи справді сезонна модель
 * угадує краще за наївну «кожен місяць однаковий». Якщо ні — сезонний
 * коефіцієнт у закупівлю не пускаємо, лишаються тільки помічник і
 * ранкове зведення, де ціна помилки — зайвий рядок, а не зайві гроші.
 *
 * Як міряємо. Профіль будується на ОДНИХ роках, а перевіряється на
 * ІНШОМУ, якого він не бачив: інакше це не перевірка, а переказ тих
 * самих даних. Для кожної групи рахуємо, наскільки помилився прогноз
 * помісячних часток:
 *
 *   наївний   — кожен місяць 1/12 року;
 *   сезонний  — частки з профілю попередніх років.
 *
 * Метрика — середня абсолютна похибка частки (MAE). Виграє той, у кого
 * вона менша. Порогом узято 60% груп високої довіри: саме на них
 * спирається закупівля, і якщо профіль не б'є наївну модель бодай на
 * такій частці, він не вартий того, щоб рухати заявку.
 *
 *   npx tsx --env-file=.env scripts/check-season-backtest.mts
 *
 * Нічого не пишеться ні в базу сайту, ні в 1С.
 */

import { prisma } from "@/lib/prisma";
import { buildProfiles, completeYears } from "@/lib/analytics/seasonality";

/** Частка груп, які профіль має вгадати краще за наївну модель. */
const GATE_SHARE = 0.6;

/** Менше за це — статистика на одній групі, а не перевірка. */
const MIN_GROUPS = 10;

function mae(actual: number[], predicted: number[]): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Math.abs(actual[i] - predicted[i]);
  return sum / 12;
}

async function main() {
  const { years, note } = await completeYears();
  console.log(`Повні роки: ${years.length ? years.join(", ") : "жодного"} (${note})`);

  if (years.length < 2) {
    console.log("\nБектест неможливий: потрібно ЩОНАЙМЕНШЕ ДВА повні роки.");
    console.log("Одним роком можна побудувати профіль, але перевірити його нема на чому —");
    console.log("це була б перевірка даних самими собою.");
    console.log("\nПоки так: сезон у помічнику й зведенні працює, у закупівлю не пускається.");
    return;
  }

  // Учимось на всіх роках, крім останнього; перевіряємось на ньому.
  const trainYears = years.slice(0, -1);
  const testYear = years[years.length - 1];
  console.log(`\nУчимось на ${trainYears.join(", ")}, перевіряємось на ${testYear}.\n`);

  const trained = await buildProfiles("TYPE", trainYears);
  const actual = await buildProfiles("TYPE", [testYear]);
  const actualBy = new Map(actual.map((a) => [a.key, a]));

  const rows: Array<{ key: string; label: string; naive: number; season: number; conf: string }> = [];
  for (const t of trained) {
    const a = actualBy.get(t.key);
    if (!a) continue;

    // Фактичні частки перевірочного року: індекс поділений на 12 — це
    // рівно та частка, з якої він і зроблений.
    const actualShares = a.qtyIndex.map((v) => v / 12);
    const seasonShares = t.qtyIndex.map((v) => v / 12);
    const naiveShares = Array(12).fill(1 / 12);

    rows.push({
      key: t.key,
      label: t.label,
      naive: mae(actualShares, naiveShares),
      season: mae(actualShares, seasonShares),
      conf: t.confidence,
    });
  }

  const high = rows.filter((r) => r.conf === "HIGH");
  const pool = high.length >= MIN_GROUPS ? high : rows;
  const poolName = high.length >= MIN_GROUPS ? "групи високої довіри" : "усі групи (високої довіри замало)";

  if (pool.length < MIN_GROUPS) {
    console.log(`Груп для перевірки лише ${pool.length} — замало, щоб робити висновок.`);
    return;
  }

  const better = pool.filter((r) => r.season < r.naive);
  const share = better.length / pool.length;

  console.log(`Перевірено: ${pool.length} (${poolName})`);
  console.log(`Сезонна модель точніша за наївну: ${better.length} (${Math.round(share * 100)}%)`);
  console.log(`Поріг для закупівлі: ${Math.round(GATE_SHARE * 100)}%`);

  console.log("\n=== Де сезон допоміг найбільше ===");
  [...pool]
    .sort((x, y) => y.naive - y.season - (x.naive - x.season))
    .slice(0, 10)
    .forEach((r) => {
      console.log(
        `${r.label.slice(0, 34).padEnd(36)} наївна ${r.naive.toFixed(4)} → сезонна ${r.season.toFixed(4)}`
      );
    });

  const worse = [...pool].filter((r) => r.season > r.naive).sort((x, y) => y.season - y.naive - (x.season - x.naive));
  if (worse.length > 0) {
    console.log("\n=== Де сезон ЗАШКОДИВ (дивитись саме сюди) ===");
    worse.slice(0, 10).forEach((r) => {
      console.log(
        `${r.label.slice(0, 34).padEnd(36)} наївна ${r.naive.toFixed(4)} → сезонна ${r.season.toFixed(4)}`
      );
    });
  }

  console.log(
    share >= GATE_SHARE
      ? "\n✅ Гейт пройдено: сезонний коефіцієнт можна пускати в закупівлю."
      : "\n⛔ Гейт НЕ пройдено: у закупівлі сезон не вмикати. Помічник і зведення — можна."
  );
  console.log("\nREAD ONLY: nothing was written.");
  if (share < GATE_SHARE) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
