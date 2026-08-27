/**
 * Прибирає з описів товарів обгортку вікна ChatGPT.
 *
 * Що сталося: колись описи набивали, копіюючи відповідь просто з браузера, —
 * і разом із текстом у базу поїхала розмітка самого чату («flex flex-col»,
 * «data-message-author-role», «text-message»). Опис на картці рендериться як
 * HTML (ProductDescription використовує dangerouslySetInnerHTML), тож ця
 * обгортка не просто лежить у базі — вона малюється на сторінці.
 *
 * Сам текст усередині нормальний, тому нічого не переписуємо: витягуємо вміст
 * блоку .markdown/.prose (там уже правильні <p> і <ul>) і кладемо назад. Якщо
 * такого блоку немає — знімаємо теги до чистого тексту.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/clean-chatgpt-descriptions.mts           # звіт
 *   npx tsx --env-file=.env scripts/clean-chatgpt-descriptions.mts --apply
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Ознаки саме вікна чату, а не звичайної HTML-розмітки з сайту виробника. */
const MARKER = /data-message-author-role|text-message|flex flex-col|data-(start|end)=/;

const toText = (h: string) =>
  h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

/** Вміст найглибшого div.markdown/.prose — там лежить сам опис. */
function unwrap(html: string): string | null {
  const open = /<div[^>]*class="[^"]*(?:markdown|prose)[^"]*"[^>]*>/i.exec(html);
  if (!open) return null;
  const i = open.index + open[0].length;
  let depth = 1;
  const tag = /<\/?div\b[^>]*>/gi;
  tag.lastIndex = i;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html))) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(i, m.index).trim();
  }
  return html.slice(i).trim();
}

/** Класи, які бувають лише в розмітці вікна чату, а не в описі товару. */
const CHAT_CLASS = /(flex|text-message|markdown|prose|whitespace-pre-wrap|break-words|min-h-|overflow-x|gizmo|dark:)/i;

/**
 * Знімає обгортку, лишаючи саму верстку опису.
 *
 * Навмисно НЕ зводимо все до голого тексту: у половині карток усередині
 * лежить нормальний <p><strong><ul>, і зняти теги означало б зіпсувати
 * оформлення заради косметики. Прибираємо тільки чуже: атрибути data-*,
 * тайлвіндові класи чату і порожні <div>-обгортки.
 */
function scrub(html: string): string {
  return (unwrap(html) ?? html)
    .replace(/\sdata-[\w-]+="[^"]*"/gi, "")
    .replace(/\sclass="([^"]*)"/gi, (full, cls: string) => (CHAT_CLASS.test(cls) ? "" : full))
    .replace(/<\/?div[^>]*>/gi, " ")
    .replace(/<(p|h\d|ul|ol|li|strong|em|br)\s+>/gi, "<$1>")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "> <")
    .trim();
}

const rows = await prisma.product.findMany({
  where: { description: { contains: "text-message" } },
  select: { id: true, sku: true, name: true, description: true, isActive: true, stock: true },
});
const more = await prisma.product.findMany({
  where: { OR: [{ description: { contains: "flex flex-col" } }, { description: { contains: "data-start=" } }] },
  select: { id: true, sku: true, name: true, description: true, isActive: true, stock: true },
});
const all = [...new Map([...rows, ...more].map((r) => [r.id, r])).values()].filter((r) => MARKER.test(r.description));

type Change = { id: string; sku: string | null; name: string; from: string; to: string; how: "верстку збережено" | "знято теги" };
const changes: Change[] = [];
for (const r of all) {
  let to = scrub(r.description);
  let how: Change["how"] = "верстку збережено";
  // Якщо після чистки не лишилось нічого схожого на текст — беремо чистий текст.
  if (to.replace(/<[^>]+>/g, "").trim().length < 20) { to = toText(r.description); how = "знято теги"; }
  if (!to || to.length < 20 || to === r.description) continue;
  changes.push({ id: r.id, sku: r.sku, name: r.name, from: r.description, to, how });
}

const active = changes.filter((c) => all.find((r) => r.id === c.id)!.isActive);
const inStock = changes.filter((c) => all.find((r) => r.id === c.id)!.stock > 0);
console.log(`Карток з обгорткою чату: ${all.length}`);
console.log(`  чистимо: ${changes.length} (активних ${active.length}, у наявності ${inStock.length})`);
console.log(`  з них верстку збережено: ${changes.filter((c) => c.how === "верстку збережено").length}, знято теги: ${changes.filter((c) => c.how === "знято теги").length}`);
for (const c of changes.slice(0, 5)) {
  console.log(`\n  ${c.sku} ${c.name.slice(0, 55)} [${c.how}]`);
  console.log(`    було:  ${c.from.slice(0, 110).replace(/\n/g, " ")}…`);
  console.log(`    стане: ${c.to.slice(0, 110).replace(/\n/g, " ")}…`);
}
if (changes.length > 5) console.log(`\n  … ще ${changes.length - 5}`);

if (!APPLY) {
  console.log("\nЦе звіт. Щоб застосувати — --apply");
  await prisma.$disconnect();
  process.exit(0);
}

const backup = `scripts/backup-chatgpt-descriptions-${new Date().toISOString().slice(0, 10)}.json`;
fs.writeFileSync(backup, JSON.stringify(changes.map(({ id, sku, from }) => ({ id, sku, from })), null, 1));
console.log(`\nЗлiпок попереднього стану: ${backup}`);
for (const c of changes) await prisma.product.update({ where: { id: c.id }, data: { description: c.to } });
console.log(`Очищено описів: ${changes.length}`);

const base = process.env.NEXTAUTH_URL;
const agent = process.env.SYNC_AGENT_ID;
const secret = process.env.SYNC_AGENT_SECRET;
if (base && agent && secret) {
  const body = "{}";
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  const res = await fetch(`${base}/api/sync-ingest/revalidate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-agent": agent, "x-sync-timestamp": ts, "x-sync-signature": sig },
    body,
  });
  console.log(`Кеш вітрини: ${res.status} ${await res.text()}`);
}
await prisma.$disconnect();
