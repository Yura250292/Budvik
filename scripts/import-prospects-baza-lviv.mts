/**
 * Імпорт «База Львів» (бланк актуалізації бази торгових точок) у точки для
 * розпрацювання — ProspectClient із source = "baza-lviv-2026-09".
 *
 * Два кроки, бо геокодування — це півгодини Nominatim, а запис — секунди:
 *
 *   npx tsx -r dotenv/config scripts/import-prospects-baza-lviv.mts
 *     геокодує адреси в output/baza-lviv/geo.json (у базу НЕ пише, повторний
 *     прогін бере вже знайдене з файла);
 *   ... --apply
 *     пише точки. Повторний запуск оновлює ті самі рядки за (source, код),
 *     дублів не буде; статус і торговий, які вже змінили люди, не чіпає.
 *
 * Вхід — output/baza-lviv/rows.json (рядки аркуша «База» як є). Файл не
 * в git: там ПІБ фізосіб-підприємців.
 *
 * «нерабочая» не імпортуються — торговому нема чого їхати в закриту точку.
 *
 * Схожого контрагента 1С НЕ зливаємо з точкою: в одного ФОП буває кілька
 * магазинів (у Владичка чотири адреси), а збіг прізвища — ще не той самий
 * магазин. Тож лише підказка в попапі: «у 1С схожий: …, остання покупка …».
 */
import { PrismaClient, Prisma } from "@prisma/client";
import fs from "node:fs";
import { geocodeAddress } from "../src/lib/geo/nominatim";

const SOURCE = "baza-lviv-2026-09";
const DIR = "output/baza-lviv";
const REGION = "Львівська область";
const apply = process.argv.includes("--apply");

type Row = {
  code: string; name: string; tt: string | null; addr: string | null;
  cat: string | null; spec: string | null; type: string | null; city: string | null;
  status: string | null; price: string | null; citytype: string | null;
};
type Geo = { lat: number; lng: number; precision: "ADDRESS" | "CITY"; query: string } | null;

const rows: Row[] = JSON.parse(fs.readFileSync(`${DIR}/rows.json`, "utf8"));
const geoPath = `${DIR}/geo.json`;
const geo: Record<string, Geo> = fs.existsSync(geoPath) ? JSON.parse(fs.readFileSync(geoPath, "utf8")) : {};

const working = rows.filter((r) => r.status !== "нерабочая" && r.name);
console.log(`рядків ${rows.length}, робочих ${working.length}, уже геокодовано ${Object.keys(geo).length}`);

/**
 * Адреса для геокодера. У бланку вона написана для людини:
 * «Львів; ринок Антонича,8 пав.№11», «Сокаль, Яворницького,86 маг.База».
 * Назва магазину й номер павільйону для Nominatim — шум, а місто буває
 * відсутнє зовсім («м. Львів вул. Б.Хмельницького» — ок, «Наукова,49» — ні).
 */
function addressQuery(r: Row): string | null {
  let a = (r.addr ?? "").replace(/;/g, ",");
  a = a
    // «Наукова,49 м.Електрокрамниця»: скорочення впритул до назви магазину
    // після пробілу. Не «м. Львів» на початку — там пробіл після крапки.
    .replace(/(?<=\s)(маг|м|пав|к)\.\p{Lu}[^,]*$/gu, "")
    .replace(/(?<=^|[^\p{L}])(маг|пав|кіоск|ТЦ|ТВЦ)\.?\s*[^,]*$/giu, "")
    .replace(/№\s*\S+/g, "")
    .replace(/^\d{5},?\s*/, "")
    .replace(/Львівський,?/g, "")
    .replace(/\s+/g, " ")
    .replace(/[,\s]+$/, "")
    .trim();
  if (!a) return null;
  const city = (r.city ?? "").trim();
  // Адреса з самого лише міста («м. Львів») — геокодувати нема чого, це
  // рівно те саме, що центр пункту.
  const rest = a
    .toLowerCase()
    .replace(city.toLowerCase(), "")
    .replace(/(?<=^|[^\p{L}])(м|смт|с|вул)\.?/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  if (rest.length < 3) return null;
  const stem = city.slice(0, Math.max(4, city.length - 2)).toLowerCase();
  if (city && !a.toLowerCase().includes(stem)) a = `${city}, ${a}`;
  return `${a}, ${REGION}`;
}

/** Результат, що впав до самого населеного пункту, — не адреса. */
function isCityLevel(displayName: string, city: string | null): boolean {
  const first = displayName.split(",")[0].trim().toLowerCase();
  return !!city && first === city.trim().toLowerCase();
}

/**
 * Запасні стратегії geocodeAddress шукають без області й без міста — і на
 * «Львів Наукова,49» віддають вулицю Наукову в Києві, а на «м. Львів» —
 * інфощит «Львівська область» на трасі під Тернополем. Тому адресну точку
 * приймаємо лише поруч із центром її населеного пункту.
 */
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}
const inOblast = (g: { lat: number; lng: number }) => g.lat > 48.7 && g.lat < 50.8 && g.lng > 22.5 && g.lng < 25.5;
const cityCenter = new Map<string, { lat: number; lng: number } | null>();
async function centerOf(city: string) {
  if (!cityCenter.has(city)) {
    const g = await geocodeAddress(`${city}, ${REGION}, Україна`);
    cityCenter.set(city, g && inOblast(g) ? { lat: g.lat, lng: g.lng } : null);
  }
  return cityCenter.get(city)!;
}

if (!apply) {
  let i = 0;
  for (const r of working) {
    i++;
    if (r.code in geo) continue;
    let hit: Geo = null;
    const center = r.city ? await centerOf(r.city) : null;
    const q = addressQuery(r);
    if (q) {
      const g = await geocodeAddress(q);
      const radius = r.city === "Львів" ? 20 : 15;
      const near = g && inOblast(g) && (!center || km(center, g) <= radius);
      if (g && near) {
        hit = { lat: g.lat, lng: g.lng, precision: isCityLevel(g.displayName, r.city) ? "CITY" : "ADDRESS", query: q };
      }
    }
    if (!hit && center) {
      hit = { ...center, precision: "CITY", query: `${r.city}, ${REGION}` };
    }
    geo[r.code] = hit;
    fs.writeFileSync(geoPath, JSON.stringify(geo, null, 1));
    if (i % 20 === 0 || i === working.length) {
      const v = Object.values(geo);
      console.log(`[${i}/${working.length}] адресою ${v.filter((g) => g?.precision === "ADDRESS").length} · містом ${v.filter((g) => g?.precision === "CITY").length} · не знайдено ${v.filter((g) => !g).length}`);
    }
  }
  console.log("Геокодування готове. У базу нічого не записано; далі --apply.");
  process.exit(0);
}

// ── запис ─────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const norm = (s: string) => (s || "").toLowerCase().replace(/[ʼ’'`"«»]/g, "").replace(/і/g, "i");
const ORG = /^(фоп|тзов|тов|пп|ват|зат|прат|пат|товариство|обмеженою|відповідальністю|приватне|акціонерне|відкрите|підприємство)$/;
/** Прізвище й перша літера імені: «Белей і.В. (Львів…)» → ["белей", "i"]. */
function person(name: string): { surname: string; initial: string } | null {
  const words = norm(name.split("/")[0].replace(/\(.*$/, "")).split(/[^\p{L}]+/u).filter(Boolean).filter((w) => !ORG.test(w));
  if (!words.length || words[0].length < 3) return null;
  return { surname: words[0], initial: words[1]?.[0] ?? "" };
}

const cps: Array<{ id: string; name: string; address: string | null; last: Date | null }> = await prisma.$queryRaw`
  SELECT c.id, c.name, c.address,
    (SELECT max(s."confirmedAt") FROM "SalesDocument" s
      WHERE s."counterpartyId" = c.id AND s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED') AS last
  FROM "Counterparty" c WHERE c."isActive"`;
const bySurname = new Map<string, typeof cps>();
for (const c of cps) {
  const p = person(c.name);
  if (!p) continue;
  if (!bySurname.has(p.surname)) bySurname.set(p.surname, []);
  bySurname.get(p.surname)!.push(c);
}

/** Схожий контрагент: те саме прізвище, не суперечить ініціал, те саме місто. */
function similar(r: Row) {
  const p = person(r.name);
  if (!p) return null;
  const city = norm(r.city ?? "").slice(0, 5);
  const found = (bySurname.get(p.surname) ?? []).filter((c) => {
    const cp = person(c.name)!;
    if (p.initial && cp.initial && p.initial !== cp.initial) return false;
    return !city || norm(`${c.name} ${c.address ?? ""}`).includes(city);
  });
  if (!found.length) return null;
  found.sort((a, b) => (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));
  const c = found[0];
  return { id: c.id, name: c.name, lastSale: c.last ? c.last.toISOString().slice(0, 10) : null };
}

let created = 0, updated = 0, skipped = 0, withSimilar = 0;
for (const r of working) {
  const g = geo[r.code];
  if (!g) { skipped++; continue; }
  const sim = similar(r);
  if (sim) withSimilar++;
  const details = {
    category: r.cat, specialization: r.spec, outletType: r.type, city: r.city,
    pricePositioning: r.price, settlementType: r.citytype, precision: g.precision, similarClient: sim,
  };
  const name = r.name.replace(/\s*\/.*$/, "").trim() || r.name;
  const existing = await prisma.prospectClient.findUnique({
    where: { source_externalCode: { source: SOURCE, externalCode: r.code } },
    select: { id: true },
  });
  if (existing) {
    // Координати не перезаписуємо: їх міг уже перетягнути торговий.
    await prisma.prospectClient.update({
      where: { id: existing.id },
      data: { name, address: r.addr, details: details as Prisma.InputJsonValue },
    });
    updated++;
  } else {
    await prisma.prospectClient.create({
      data: {
        source: SOURCE, externalCode: r.code, name, address: r.addr,
        lat: g.lat, lng: g.lng, details: details as Prisma.InputJsonValue,
      },
    });
    created++;
  }
}
console.log(`ГОТОВО: створено ${created}, оновлено ${updated}, без координат пропущено ${skipped}, зі схожим у 1С ${withSimilar}`);
await prisma.$disconnect();
