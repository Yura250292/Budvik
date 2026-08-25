/**
 * Розбір виводу probe-polax-prices.ps1 (UTF-16LE з RDP) — рахує покриття
 * типу цін «6.МАГАЗИНИ» для POLAX і націнку відносно «4.ОПТ».
 *
 *   node agent/ps/analyze-polax-prices.mjs ~/Downloads/probe-polax-prices.out.txt
 */
import { readFileSync } from "fs";

const path = process.argv[2];
if (!path) { console.error("вкажіть файл виводу проби"); process.exit(1); }
const raw = readFileSync(path);
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le") : raw.toString("utf8");

const blocks = {};
let current = null;
for (const line of text.split(/\r?\n/)) {
  const head = line.match(/^\s{2}OK (\w+)\s+rows=(\d+)/);
  if (head) { current = { label: head[1], rows: Number(head[2]), lines: [] }; blocks[head[1]] = current; continue; }
  if (/^\s*--/.test(line) || !line.trim()) { if (!/^\s{7}/.test(line)) current = null; continue; }
  if (current && /^\s{7}/.test(line)) current.lines.push(line.trim().split(" | ").map((s) => s.trim()));
}

const num = (s) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : null; };
const RATES = { "840": 46, "980": 1, "120": 12.4 };
const uah = (price, code) => { const r = RATES[String(code).trim()]; return r ? price * r : null; };

const show = (label, fn) => { const b = blocks[label]; if (!b) return console.log(`  (немає блоку ${label})`); fn(b); };

console.log("== Покриття типу цін «6.МАГАЗИНИ» для POLAX");
show("polax_total", (b) => console.log(`  всього POLAX у номенклатурі 1С: ${b.lines[0]?.[0]}`));
show("polax_mag_cnt", (b) => console.log(`  з рядком 6.МАГАЗИНИ: ${b.lines[0]?.[0]} | з них ціна > 0: ${b.lines[0]?.[1]}`));
show("polax_gap_cnt", (b) => console.log(`  БЕЗ 6.МАГАЗИНИ, але з 4.ОПТ: ${b.lines[0]?.[0]}  ← саме вони на сайті з 0 ₴`));
show("polax_mag_dates", (b) => b.lines.forEach((l) => console.log(`  ${l[0]}: записи 6.МАГАЗИНИ з ${l[1]} по ${l[2]}, позицій ${l[3]}`)));

console.log("\n== Націнка 6.МАГАЗИНИ до 4.ОПТ (там, де заповнені обидва)");
show("polax_both", (b) => {
  const k = [];
  for (const [art, magP, magC, optP, optC] of b.lines) {
    const m = uah(num(magP), magC), o = uah(num(optP), optC);
    if (m && o) k.push({ art, m, o, k: m / o });
  }
  if (!k.length) return console.log("  порівнювати нема що");
  k.sort((a, b2) => a.k - b2.k);
  const q = (p) => k[Math.min(k.length - 1, Math.floor(k.length * p))].k;
  console.log(`  пар: ${k.length} | коефіцієнт: мін ${k[0].k.toFixed(2)}, 25% ${q(0.25).toFixed(2)}, медіана ${q(0.5).toFixed(2)}, 75% ${q(0.75).toFixed(2)}, макс ${k[k.length - 1].k.toFixed(2)}`);
  console.log("  приклади:", k.slice(0, 3).concat(k.slice(-3)).map((x) => `${x.art} ${x.o.toFixed(2)}→${x.m.toFixed(2)} (×${x.k.toFixed(2)})`).join("; "));
});

console.log("\n== Приклади товарів без роздрібної ціни (артикул | назва | 4.ОПТ | 5.VIP | 1.ВХІД, ₴)");
show("polax_gap_sample", (b) => b.lines.slice(0, 15).forEach(([art, name, optP, optC, vipP, vhidP]) => {
  const o = uah(num(optP), optC);
  console.log(`  ${art.padEnd(12)} ${name.slice(0, 42).padEnd(44)} ${o ? o.toFixed(2) : "—"} | ${num(vipP) ?? "—"} | ${num(vhidP) ?? "—"}`);
}));

console.log("\n== Конкретні товари, що висять на сайті з 0 ₴");
show("zero_sku_prices", (b) => {
  const byArt = {};
  for (const [art, type, price, code, per] of b.lines) (byArt[art] ??= []).push(`${type}: ${price} ${String(code).trim() === "840" ? "$" : "₴"} (${per})`);
  for (const [art, rows] of Object.entries(byArt)) console.log(`  ${art}: ${rows.join("; ")}`);
});

console.log("\n== POLAX по всіх типах цін");
show("polax_by_type_all", (b) => b.lines.forEach((l) => console.log(`  ${l[0].padEnd(26)} вал ${String(l[1]).trim() || "—"} | позицій ${l[2]} | ${l[3]}…${l[4]}`)));
