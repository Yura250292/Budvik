/**
 * Переаудит точок клієнтів, які виглядають точними, а насправді ні.
 *
 * До 24.09.2026 геокодер писав GEOCODED на будь-яку знахідку, зокрема на
 * центр міста й однойменну вулицю в іншій області: 953 клієнти злиплися
 * групами (у центрі Львова 60 + 45), Жовква стояла в Криму, «Стрий, базар» —
 * у Києві. Тут кожного підозрілого проганяємо через новий ланцюг
 * (locateClient: OSM у рамці області → Google → центр пункту) і чесно
 * пишемо точність.
 *
 * Два ходи, щоб записалося рівно те, що показали людині:
 *   npx tsx --env-file=.env scripts/regeocode-suspect.mts [--active] [--limit N]
 *     → шукає (базу не змінює), пише план у output/regeocode-suspect-plan-*.json
 *   npx tsx --env-file=.env scripts/regeocode-suspect.mts --apply <план.json>
 *     → записує план; перед тим кладе бекап старих значень у output/
 *
 * MANUAL не чіпаємо ніколи. Рядок, який змінився між ходами (хтось поставив
 * пін), теж пропускаємо — UPDATE звіряє старі значення.
 *
 * `--active` — лише клієнти з документами за 180 днів (їм будують маршрути).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { locateClient } from "../src/lib/geo/locate-client";
import { inBox, LVIV_OBLAST_BOX, searchBoxFor } from "../src/lib/geo/region";

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const applyIdx = argv.indexOf("--apply");
const today = new Date().toISOString().slice(0, 10);

type Old = { lat: number | null; lng: number | null; geoSource: string | null };
type Step = {
  id: string;
  name: string;
  address: string | null;
  reason: string;
  old: Old;
  next: Old;
  via: string | null;
  label: string | null;
};

if (applyIdx >= 0) {
  await apply(argv[applyIdx + 1]);
} else {
  await plan();
}
await prisma.$disconnect();

async function plan() {
  const active = argv.includes("--active");
  const limitArg = argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) : Infinity;

  type Row = {
    id: string;
    name: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    geoSource: string | null;
    grp: number;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    WITH c AS (
      SELECT id, name, address, "deliveryLat" AS lat, "deliveryLng" AS lng, "geoSource"::text AS "geoSource",
             COUNT(*) OVER (
               PARTITION BY ROUND("deliveryLat"::numeric, 4), ROUND("deliveryLng"::numeric, 4)
             )::int AS grp
      FROM "Counterparty"
      WHERE "isActive" AND "geoSource" IN ('GEOCODED', 'CITY', 'FAILED')
    )
    SELECT c.* FROM c
    WHERE (${!active} OR EXISTS (
      SELECT 1 FROM "SalesDocument" s
      WHERE s."counterpartyId" = c.id AND s."createdAt" > NOW() - INTERVAL '180 days'
    ))
    ORDER BY c.name`;

  const suspects: Array<Row & { reason: string }> = [];
  for (const r of rows) {
    const addr = r.address ?? "";
    let reason: string | null = null;
    if (r.geoSource === "CITY") reason = "CITY";
    else if (r.geoSource === "FAILED") reason = addr.trim() ? "FAILED" : null;
    else if (r.lat != null && r.lng != null) {
      const wantLviv = addr.trim() ? !!searchBoxFor(addr) : false;
      if (wantLviv && !inBox(LVIV_OBLAST_BOX, r.lat, r.lng)) reason = "поза областю";
      else if (r.grp >= 3) reason = `купа ×${r.grp}`;
    }
    if (reason) suspects.push({ ...r, reason });
  }

  const todo = suspects.slice(0, limit);
  console.log(`${active ? "активні за 180 днів" : "уся база"}: підозрілих ${suspects.length}, беремо ${todo.length}`);

  const steps: Step[] = [];
  const t0 = Date.now();
  for (const [i, r] of todo.entries()) {
    const old: Old = { lat: r.lat, lng: r.lng, geoSource: r.geoSource };
    const loc = await locateClient(r.address, r.name);
    let next: Old;
    if (loc) {
      next = { lat: loc.lat, lng: loc.lng, geoSource: loc.geoSource };
    } else if (r.reason === "поза областю") {
      // Точка в чужій області гірша за відсутню: водій поїде в Крим.
      next = { lat: null, lng: null, geoSource: "FAILED" };
    } else if (r.geoSource === "GEOCODED") {
      // Нічого кращого, але й «точно» це не є.
      next = { ...old, geoSource: "CITY" };
    } else {
      next = old;
    }
    steps.push({
      id: r.id,
      name: r.name,
      address: r.address,
      reason: r.reason,
      old,
      next,
      via: loc?.via ?? null,
      label: loc?.label ?? null,
    });
    if ((i + 1) % 10 === 0 || i + 1 === todo.length) {
      const min = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`[${i + 1}/${todo.length}] ${min} хв`);
    }
  }

  const changed = steps.filter((s) => moved(s) || s.old.geoSource !== s.next.geoSource);
  mkdirSync("output", { recursive: true });
  const file = `output/regeocode-suspect-plan-${today}${active ? "-active" : ""}.json`;
  writeFileSync(file, JSON.stringify(changed, null, 2));

  report(steps);
  console.log(`\nПлан (${changed.length} змін) → ${file}\nБазу не змінено. Записати: --apply ${file}`);
}

function moved(s: Step): boolean {
  if (s.old.lat == null || s.next.lat == null) return s.old.lat !== s.next.lat;
  return Math.abs(s.old.lat - s.next.lat) > 1e-5 || Math.abs((s.old.lng ?? 0) - (s.next.lng ?? 0)) > 1e-5;
}

function report(steps: Step[]) {
  const key = (s: Step) =>
    `${s.old.geoSource} → ${s.next.geoSource}${s.next.lat == null ? " (без точки)" : moved(s) ? " (перенесено)" : ""}`;
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(key(s), (counts.get(key(s)) ?? 0) + 1);
  console.log("\nПереходи:");
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

  const via = new Map<string, number>();
  for (const s of steps) if (s.next.geoSource === "GEOCODED") via.set(s.via ?? "?", (via.get(s.via ?? "?") ?? 0) + 1);
  console.log(`Будинок знайшов: ${[...via].map(([k, n]) => `${k} ${n}`).join(", ") || "—"}`);

  console.log("\nПриклади знайдених будинків:");
  for (const s of steps.filter((x) => x.next.geoSource === "GEOCODED" && moved(x)).slice(0, 15)) {
    console.log(`  ${s.name.slice(0, 32).padEnd(33)} ${(s.address ?? "").slice(0, 45).padEnd(46)} → ${s.next.lat?.toFixed(5)},${s.next.lng?.toFixed(5)} [${s.via}] ${(s.label ?? "").slice(0, 50)}`);
  }
}

async function apply(file: string | undefined) {
  if (!file) throw new Error("--apply потребує шлях до плану");
  const steps = JSON.parse(readFileSync(file, "utf8")) as Step[];
  const backup = file.replace(/plan/, "backup").replace(/\.json$/, `-${Date.now()}.json`);
  writeFileSync(backup, JSON.stringify(steps.map((s) => ({ id: s.id, ...s.old })), null, 2));
  console.log(`бекап старих значень → ${backup}`);

  let done = 0;
  let skipped = 0;
  for (const s of steps) {
    // Звіряємо старі значення: якщо між ходами хтось поставив пін або
    // геокодер щось записав — не затираємо.
    const n = await prisma.$executeRaw`
      UPDATE "Counterparty"
      SET "deliveryLat" = ${s.next.lat}, "deliveryLng" = ${s.next.lng},
          "geoSource" = ${s.next.geoSource}::"GeoSource", "geoAttemptedAt" = NOW()
      WHERE id = ${s.id}
        AND "geoSource" IS DISTINCT FROM 'MANUAL'
        AND "geoSource"::text IS NOT DISTINCT FROM ${s.old.geoSource}
        AND "deliveryLat" IS NOT DISTINCT FROM ${s.old.lat}::float8
        AND "deliveryLng" IS NOT DISTINCT FROM ${s.old.lng}::float8`;
    if (n === 1) done++;
    else skipped++;
  }
  console.log(`записано ${done}, пропущено (змінились між ходами або MANUAL) ${skipped}`);
}
