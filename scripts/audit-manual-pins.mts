/**
 * Ручні точки клієнтів: чи стояв автор біля магазину, коли ставив точку.
 * Лише читання. Деталі вердиктів — src/lib/geo/pin-audit.ts.
 *
 *   npx tsx --env-file=.env scripts/audit-manual-pins.mts
 *
 * Список сумнівних (AT_BASE, ELSEWHERE) іде в output/manual-pins-audit-<дата>.csv.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { auditManualPins } from "../src/lib/geo/pin-audit";

const rows = await auditManualPins();
const kyiv = (d: Date) => d.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });

const byAuthor = new Map<string, Record<string, number>>();
for (const r of rows) {
  const key = `${r.authorName}${r.byGps ? "" : " (пальцем)"}`;
  const m = byAuthor.get(key) ?? {};
  m[r.verdict] = (m[r.verdict] ?? 0) + 1;
  byAuthor.set(key, m);
}
console.log(`Ручних точок з автором: ${rows.length}\n`);
console.log("автор".padEnd(32), "ON_SITE AT_BASE ELSEWHERE NO_TRACK");
for (const [a, m] of [...byAuthor].sort()) {
  console.log(
    a.slice(0, 31).padEnd(32),
    String(m.ON_SITE ?? 0).padStart(7),
    String(m.AT_BASE ?? 0).padStart(7),
    String(m.ELSEWHERE ?? 0).padStart(9),
    String(m.NO_TRACK ?? 0).padStart(8)
  );
}

const doubtful = rows.filter((r) => r.verdict === "AT_BASE" || r.verdict === "ELSEWHERE");
console.log(`\nСумнівні (${doubtful.length}):`);
for (const r of doubtful) {
  console.log(
    `  ${r.verdict.padEnd(9)} ${kyiv(r.geoAt)} ${r.authorName.slice(0, 16).padEnd(17)} ${r.byGps ? "GPS" : "пал"} ${r.name.slice(0, 34).padEnd(35)} автор за ${r.distanceM} м${r.baseLabel ? `, біля: ${r.baseLabel}` : ""}`
  );
}

mkdirSync("output", { recursive: true });
const file = `output/manual-pins-audit-${new Date().toISOString().slice(0, 10)}.csv`;
const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
writeFileSync(
  file,
  [
    "verdict,geoAt,author,byGps,client,address,pinLat,pinLng,authorLat,authorLng,distanceM,lagMin,base,counterpartyId",
    ...rows.map((r) =>
      [r.verdict, kyiv(r.geoAt), r.authorName, r.byGps, r.name, r.address, r.lat, r.lng, r.authorLat, r.authorLng, r.distanceM, r.lagMin, r.baseLabel, r.counterpartyId]
        .map(esc)
        .join(",")
    ),
  ].join("\n")
);
console.log(`\n→ ${file}. Базу не змінено.`);
await prisma.$disconnect();
