/**
 * Аркуш для проставляння типу цін «6.МАГАЗИНИ» на Polax у 1С.
 *
 * Сайт бере роздрібну ціну ЛИШЕ з типу «6.МАГАЗИНИ». Для Polax його
 * покинули 10.04.2022, тож 909 позицій із живою оптовою ціною приходять
 * на вітрину нулями, а 139 старих цін уже нижчі за поточну закупівлю.
 * Вигадувати ціну на боці сайту не можна — вона мусить бути з 1С, тому
 * цей скрипт лише готує файл, за яким менеджер проставить ціни в 1С.
 *
 * Вхід — CSV з agent/ps/probe-polax-price-gap.ps1 (лежать у ~/Downloads):
 *   polax-price-gap.csv   позиції без роздрібної ціни + поточні опт/VIP/вхід
 *   polax-stale.csv       позиції зі старою роздрібною ціною
 *   sigma-markup.csv      SIGMA, де тип живий — звідки беремо реальну націнку
 *   rates.csv             курси валют з 1С
 *
 * Запуск:
 *   npx tsx scripts/polax-price-sheet.mts ~/Downloads [--markup 1.35]
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";

const dir = process.argv[2] ?? `${process.env.HOME}/Downloads`;
const markupArg = process.argv.indexOf("--markup");
const forcedMarkup = markupArg > 0 ? Number(process.argv[markupArg + 1]) : null;

function readCsv(name: string): Record<string, string>[] {
  const path = join(dir, name);
  if (!existsSync(path)) throw new Error(`немає ${path} — спершу probe-polax-price-gap.ps1 у RDP`);
  const text = readFileSync(path, "utf8").replace(/^﻿/, "").trim();
  const [head, ...rows] = text.split(/\r?\n/);
  const cols = head.split(";");
  return rows.filter(Boolean).map((r) => Object.fromEntries(r.split(";").map((v, i) => [cols[i], v])));
}

const rates = new Map<string, number>();
for (const r of readCsv("rates.csv")) {
  const rate = Number(r.rate?.replace(",", ".")), mult = Number(r.mult?.replace(",", ".")) || 1;
  if (r.code?.trim() && rate > 0) rates.set(r.code.trim(), rate / mult);
}
rates.set("980", 1);
const num = (s?: string) => { const v = Number((s ?? "").replace(",", ".")); return Number.isFinite(v) && v > 0 ? v : null; };
/** Ціни в базі лежать у різних валютах по рядках — зводимо до гривні курсом із 1С. */
const uah = (price?: string, code?: string) => {
  const v = num(price); if (!v) return null;
  const r = rates.get((code ?? "").trim()); return r ? Math.round(v * r * 100) / 100 : null;
};

// Реальна націнка компанії: беремо з SIGMA, де тип «6.МАГАЗИНИ» ведеться далі.
const ratios: number[] = [];
for (const r of readCsv("sigma-markup.csv")) {
  const mag = uah(r.mag, r.mag_cur), opt = uah(r.opt, r.opt_cur);
  if (mag && opt) ratios.push(mag / opt);
}
ratios.sort((a, b) => a - b);
const q = (p: number) => ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * p))];
const median = ratios.length ? q(0.5) : 1;
const markup = forcedMarkup ?? Math.round(median * 100) / 100;
console.log(`SIGMA: пар «магазини/опт» ${ratios.length} | коефіцієнт: 25% ${q(0.25)?.toFixed(2)}, медіана ${median.toFixed(2)}, 75% ${q(0.75)?.toFixed(2)}`);
console.log(`Підказка ціни рахується як опт × ${markup}${forcedMarkup ? " (задано вручну)" : " (медіана SIGMA)"}`);

const wb = new ExcelJS.Workbook();
const money = "#,##0.00";
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD600" } } as const;

function sheet(name: string, columns: Partial<ExcelJS.Column>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns as ExcelJS.Column[];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = HEAD_FILL as ExcelJS.Fill;
  return ws;
}

const gap = sheet("Проставити ціну", [
  { header: "Артикул", key: "art", width: 14 },
  { header: "Назва", key: "name", width: 60 },
  { header: "Опт, ₴", key: "opt", width: 11, style: { numFmt: money } },
  { header: "VIP, ₴", key: "vip", width: 11, style: { numFmt: money } },
  { header: "Вхід, ₴", key: "vhid", width: 11, style: { numFmt: money } },
  { header: `Підказка (опт × ${markup}), ₴`, key: "hint", width: 20, style: { numFmt: money } },
  { header: "6.МАГАЗИНИ, ₴ ← вписати", key: "mag", width: 24, style: { numFmt: money } },
]);
let gapRows = 0;
for (const r of readCsv("polax-price-gap.csv")) {
  const opt = uah(r.opt, r.opt_cur);
  if (!opt) continue;
  gap.addRow({
    art: r.art, name: r.name, opt,
    vip: uah(r.vip, r.vip_cur),
    vhid: uah(r.vhid_uah, "980") ?? uah(r.vhid_usd, "840"),
    hint: Math.round(opt * markup * 100) / 100,
  });
  gapRows++;
}

const stale = sheet("Оновити стару ціну", [
  { header: "Артикул", key: "art", width: 14 },
  { header: "Назва", key: "name", width: 60 },
  { header: "Ціна на сайті, ₴", key: "mag", width: 17, style: { numFmt: money } },
  { header: "Записана", key: "date", width: 12 },
  { header: "Опт зараз, ₴", key: "opt", width: 14, style: { numFmt: money } },
  { header: "Нижче закупівлі", key: "loss", width: 16 },
  { header: `Підказка (опт × ${markup}), ₴`, key: "hint", width: 20, style: { numFmt: money } },
]);
let staleRows = 0, lossRows = 0;
for (const r of readCsv("polax-stale.csv")) {
  const mag = uah(r.mag, r.mag_cur), opt = uah(r.opt, r.opt_cur);
  if (!mag) continue;
  const loss = opt !== null && mag < opt;
  if (loss) lossRows++;
  const row = stale.addRow({
    art: r.art, name: r.name, mag, date: r.mag_date, opt,
    loss: loss ? "ТАК" : "", hint: opt ? Math.round(opt * markup * 100) / 100 : null,
  });
  if (loss) row.getCell("loss").font = { bold: true, color: { argb: "FFC00000" } };
  staleRows++;
}
stale.autoFilter = { from: "A1", to: "G1" };
gap.autoFilter = { from: "A1", to: "G1" };

const out = join(dir, "polax-ціни-для-1С.xlsx");
await wb.xlsx.writeFile(out);
console.log(`\nБез роздрібної ціни: ${gapRows} | зі старою ціною: ${staleRows}, з них нижче закупівлі: ${lossRows}`);
console.log(`Файл: ${out}`);
