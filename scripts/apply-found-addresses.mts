/**
 * Застосування адрес, знайдених пошуком в інтернеті.
 *
 * Геокодер OSM не знає ринкових павільйонів і частини сільських адрес,
 * тож ці точки шукалися вручну по відкритих джерелах: офіційна база
 * магазинів DNIPRO-M, OSM Overpass по назвах ринків, довідники.
 *
 * Пишемо geoSource='MANUAL': це перевірені координати, і бекфіл не має
 * права їх перезаписати своєю здогадкою про центр міста.
 *
 * Запуск: npx tsx --env-file=.env scripts/apply-found-addresses.mts [--dry]
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

const FILE = new URL("./found-addresses.json", import.meta.url).pathname;

type Found = {
  name: string;
  lat: number;
  lng: number;
  resolvedAddress: string;
  confidence: "high" | "medium" | "low";
  source: string;
};

/**
 * Точні відповідники там, де назва з пошуку не збігається з базою
 * дослівно: у базі до прізвища додані уточнення в дужках, а «DNIPRO-M
 * ЛЬВІВ» — це п'ять різних магазинів, і кожен зі своєю адресою.
 */
const EXACT: Record<string, string> = {
  "DNIPRO-M ЛЬВІВ (Шевченка, 19)": "DNIPRO-M ЛЬВІВ (Шевченка, 19)",
};

/** Клієнти, яких свідомо пропускаємо. */
const SKIP: Record<string, string> = {
  "Арендарчук Микола":
    "адреса — відділення Нової Пошти в Цумані (Волинь, 180 км від Львова), " +
    "це точка доставки, а не магазин клієнта",
};

const found: Found[] = JSON.parse(fs.readFileSync(FILE, "utf8"));

let applied = 0;
let skipped = 0;

for (const f of found) {
  if (SKIP[f.name]) {
    console.log(`ПРОПУСК  ${f.name} — ${SKIP[f.name]}`);
    skipped += 1;
    continue;
  }

  const exact = EXACT[f.name];
  const candidates = exact
    ? await prisma.counterparty.findMany({
        where: { name: exact },
        select: { id: true, name: true, geoSource: true },
      })
    : await prisma.counterparty.findMany({
        // Прізвище + уточнення в дужках: «Дрозд Сергій» ловить усі три
        // його картки, і це правильно — магазин той самий.
        where: { name: { startsWith: f.name.split("(")[0].trim() } },
        select: { id: true, name: true, geoSource: true },
      });

  if (!candidates.length) {
    console.log(`НЕ ЗНАЙДЕНО  ${f.name}`);
    skipped += 1;
    continue;
  }

  for (const c of candidates) {
    // Уточнений рукою пін важливіший за будь-яку знахідку з довідника:
    // торговий стояв біля дверей, а довідник — ні.
    if (c.geoSource === "MANUAL") {
      console.log(`ЗБЕРЕЖЕНО ручний пін  ${c.name}`);
      skipped += 1;
      continue;
    }

    if (!DRY) {
      await prisma.$executeRaw`
        UPDATE "Counterparty"
        SET "deliveryLat" = ${f.lat}, "deliveryLng" = ${f.lng},
            "geoSource" = 'MANUAL', "geoAttemptedAt" = NOW(),
            address = COALESCE(NULLIF(address, ''), ${f.resolvedAddress})
        WHERE id = ${c.id}`;
    }
    applied += 1;
    console.log(`${DRY ? "[проба] " : ""}OK  ${c.name.slice(0, 44).padEnd(45)} → ${f.lat.toFixed(5)},${f.lng.toFixed(5)}  (${f.confidence})`);
  }
}

console.log(`\n${DRY ? "ПРОБА: " : ""}оновлено ${applied}, пропущено ${skipped}`);
await prisma.$disconnect();
