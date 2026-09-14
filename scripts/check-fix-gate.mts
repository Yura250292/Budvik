/**
 * Заслінка фіксів на справжніх треках: старе правило дрейфу проти нового.
 *
 * Навіщо. 14.09.2026 пульси Джумаги показали 9 пачок фіксів за три хвилини
 * їзди і одну записану точку: правило дрейфу вірило «швидкості 0», яку планшети
 * Lenovo звітують і на ходу. Нове правило (mobile/src/track/fix-gate.ts)
 * притримує підозрілий фікс до наступного. Цей скрипт проганяє обидва на
 * записаних днях і показує, що кожне пише, скільки з того вусів і скільки
 * виходить пробігу за тим самим підрахунком, що й у звіті зміни.
 *
 * Обмеження, про яке треба пам'ятати: у базі лежить уже відсіяне. Точок, які
 * застосунок тоді відкинув, тут немає, тож «старе правило» на даних після
 * 03.09 показує, що воно зробило б із тим, що доїхало, а не з усім, що бачив
 * приймач. 03.09 до обіду — сирі дані, фільтра дрейфу ще не було.
 *
 *   npx tsx --env-file=.env scripts/check-fix-gate.mts
 *
 * Лише читання бази.
 */

import { prisma } from "../src/lib/prisma";
import { trackKmFromPoints } from "../src/lib/shift/service";
import { collapseSimultaneous, dropSpikes } from "../src/lib/track/spikes";
import {
  createFixGate,
  haversineM,
  DRIFT_KMH,
  IDLE_WRITE_MS,
  MAX_ACCURACY_M,
  MOVE_M,
  STANDING_KMH,
  WEAK_ACCURACY_M,
  type GateFix,
  type LastWritten,
} from "../mobile/src/track/fix-gate";

type Row = { at: Date; lat: number; lng: number; accuracyM: number | null; speedKmh: number | null };

/** Правило, яке стояло в recorder.ts з 03.09 до 14.09 — один в один. */
function oldGate() {
  let driftSkips = 0;
  return (fix: GateFix, last: LastWritten): GateFix[] => {
    if (fix.accuracyM != null && fix.accuracyM > MAX_ACCURACY_M) return [];
    if (fix.accuracyM != null && fix.accuracyM > WEAK_ACCURACY_M && (fix.kmh === null || fix.kmh < STANDING_KMH)) return [];
    const movedM = last ? haversineM(last.lat, last.lng, fix.lat, fix.lng) : Infinity;
    const waitedMs = last ? fix.at - last.at : Infinity;
    if (movedM < MOVE_M && waitedMs < IDLE_WRITE_MS) return [];
    if (last && fix.kmh != null && fix.kmh < STANDING_KMH && waitedMs > 0) {
      const implied = movedM / 1000 / (waitedMs / 3_600_000);
      if (implied > DRIFT_KMH && driftSkips < 5) {
        driftSkips++;
        return [];
      }
    }
    driftSkips = 0;
    return [fix];
  };
}

function run(fixes: GateFix[], decide: (f: GateFix, l: LastWritten) => GateFix[]): GateFix[] {
  const out: GateFix[] = [];
  let last: LastWritten = null;
  for (const f of fixes) {
    for (const w of decide(f, last)) {
      out.push(w);
      last = { at: w.at, lat: w.lat, lng: w.lng };
    }
  }
  return out;
}

function describe(label: string, written: GateFix[]) {
  const rows = written.map((w) => ({
    lat: w.lat,
    lng: w.lng,
    recordedAt: new Date(w.at),
    accuracyM: w.accuracyM,
    speedKmh: w.kmh != null ? Math.round(w.kmh) : null,
    // Домальованих доріг заслінка не знає: пробіг рахуємо лише за прямими.
    roadMetersFromPrev: null,
  }));
  const clean = dropSpikes(collapseSimultaneous(rows));
  const spurs = collapseSimultaneous(rows).length - clean.length;
  const km = trackKmFromPoints(rows);
  const moving: number[] = [];
  let gaps = 0;
  for (let i = 1; i < written.length; i++) {
    const s = (written[i].at - written[i - 1].at) / 1000;
    const m = haversineM(written[i - 1].lat, written[i - 1].lng, written[i].lat, written[i].lng);
    if (s <= 0 || s > 600 || (m / s) * 3.6 < 15) continue;
    moving.push(s);
    if (s >= 90) gaps++;
  }
  moving.sort((a, b) => a - b);
  const med = moving.length ? Math.round(moving[Math.floor(moving.length / 2)]) : null;
  console.log(
    `  ${label.padEnd(5)} записано ${String(written.length).padStart(4)} · у русі інтервал мед ${med ?? "—"} с, розривів ≥90 с ${moving.length ? Math.round((gaps / moving.length) * 100) : 0}% · вусів лишилось ${spurs} · пробіг їзди ${km?.driveKm ?? "—"} км`
  );
}

async function day(name: string, date: string, opts: { zeroSpeed?: boolean; until?: string; note: string }) {
  const user = await prisma.user.findFirst({
    where: { name: { contains: name, mode: "insensitive" }, role: "SALES" },
    select: { id: true, name: true },
  });
  if (!user) return;
  const rows: Row[] = (
    await prisma.trackPoint.findMany({
      where: {
        userId: user.id,
        recordedAt: { gte: new Date(`${date}T03:00:00Z`), lt: new Date(opts.until ?? `${date}T20:00:00Z`) },
      },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true, lat: true, lng: true, accuracyM: true, speedKmh: true },
    })
  ).map((p) => ({ at: p.recordedAt, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, speedKmh: p.speedKmh }));
  if (rows.length < 3) return;

  const fixes: GateFix[] = rows.map((r) => ({
    at: r.at.getTime(),
    lat: r.lat,
    lng: r.lng,
    accuracyM: r.accuracyM,
    kmh: opts.zeroSpeed ? 0 : r.speedKmh,
  }));

  const gate = createFixGate<GateFix>();
  console.log(`\n${user.name}, ${date} — ${opts.note} (фіксів ${fixes.length})`);
  describe("як є", fixes);
  describe("старе", run(fixes, oldGate()));
  describe("нове", run(fixes, gate.decide));
  const k = gate.counters();
  console.log(`        нове: притримано ${k.held}, з них вусів ${k.spur}, стоянка ${k.idle}, слабкі ${k.accuracy + k.weak}`);
}

async function main() {
  await day("Джумаг", "2026-09-03", { until: "2026-09-03T09:40:00Z", note: "сирі дані до фільтра, стоянки з вусами" });
  await day("Джумаг", "2026-09-07", { note: "Lenovo, у русі швидкість 0 у 43% фіксів" });
  await day("Джумаг", "2026-09-11", { note: "Lenovo, ранок без розривів" });
  await day("Олександр", "2026-09-11", { note: "Lenovo TB330XU" });
  await day("Кавецьк", "2026-09-13", { note: "Samsung, чесна швидкість, одометр 206 км" });
  await day("Кавецьк", "2026-09-13", { zeroSpeed: true, note: "той самий день, швидкість обнулено (найгірший Lenovo)" });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
