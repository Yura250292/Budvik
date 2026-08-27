/** Проба звіту «Польова робота» — ті самі запити, що й у API. Лише читання. */
import { geoCoverage, fieldWorkers, repGeoBacklog, fieldEvents } from "./src/lib/analytics/field-work";
import { parsePeriod } from "./src/lib/analytics/period";

const period = parsePeriod(new URLSearchParams("from=2026-08-01&to=2026-08-27"));

const cov = await geoCoverage();
console.log("ПОКРИТТЯ:", cov);

const workers = await fieldWorkers(period);
console.log("\nХТО ПРАЦЮЄ:");
for (const w of workers)
  console.log(
    `  ${w.name.padEnd(24)} ${w.role.padEnd(8)} точок ${w.pins} (на місці ${w.pinsOnSite}, усього ${w.pinsAllTime})  фото ${w.photos}  нотаток ${w.notes}  клієнтів ${w.clients}  остання ${w.lastAt}`
  );

const backlog = await repGeoBacklog();
console.log("\nЗАЛИШОК (топ-10):");
for (const r of backlog.slice(0, 10))
  console.log(`  ${r.name.padEnd(24)} клієнтів ${String(r.clients).padStart(4)}  точних ${String(r.exact).padStart(4)}  приблизних ${String(r.approx).padStart(4)}  без точки ${String(r.missing).padStart(3)}  готово ${r.ready.toFixed(0)}%`);

const events = await fieldEvents(period, 10);
console.log("\nОСТАННІ ДІЇ:");
for (const e of events)
  console.log(`  ${e.at}  ${e.kind.padEnd(5)} ${e.userName.padEnd(20)} ${e.clientName.slice(0, 40)}  ±${e.accuracyM ?? "—"}`);

process.exit(0);
