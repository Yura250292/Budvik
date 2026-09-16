/**
 * Кожна таблиця у відповідях мусить мати стільки клітинок, скільки
 * заголовків.
 *
 * Зайва клітинка в маркдауні не падає й не підкреслюється: рядок просто
 * тихо втрачає останній стовпець, і помітити це можна лише очима на
 * готовому екрані. Саме так проскочили дві таблиці, коли до товарів
 * додавали колонку з артикулом.
 *
 * Друга перевірка — блоки діаграм, плиток і схем (```budvik-chart тощо):
 * зламаний JSON кабінет показує написом «не вдалося намалювати», і це теж
 * помітно лише очима.
 *
 *   npx tsx --env-file=.env scripts/assistant-tables.mts
 */
import { prisma } from "../src/lib/prisma";
import { tryDirectAnswer } from "../src/lib/assistant/direct";
import { scopeOf } from "../src/lib/assistant/scope";
import { kyivDate } from "../src/lib/date/kyiv";
import { BLOCK, parseChart, parseKpi, parseTree } from "../src/lib/assistant/blocks";

const rep = await prisma.user.findFirstOrThrow({
  where: { email: "rep-kavetskyi-viktor@budvik.local" },
  select: { id: true, role: true },
});
const admin = await prisma.user.findFirst({ where: { email: "ufedishin@gmail.com" }, select: { id: true } });
const today = kyivDate(new Date());

const QUESTIONS: Array<[string, "SALES" | "ADMIN"]> = [
  ["Скільки піни залишилось на складі", "SALES"],
  ["Які мертві товари можу розпрацювати", "SALES"],
  ["Чим замінити піну Soma fix", "SALES"],
  ["Що беруть разом із кругами Ataman", "SALES"],
  ["Сплануй день на завтра", "SALES"],
  ["Як я на фоні команди", "SALES"],
  ["Хто мені винен", "SALES"],
  ["Що нового", "ADMIN"],
  ["Продажі по торгових за місяць", "ADMIN"],
  ["Дебіторка по торгових", "ADMIN"],
  ["Зміни торгових за тиждень", "ADMIN"],
  ["Що закінчується на складі", "ADMIN"],
  ["Рух коштів за місяць", "ADMIN"],
  ["Скільки віддали знижками за місяць", "ADMIN"],
  ["Хто зараз на маршруті", "ADMIN"],
  ["Покажи вчорашній оборот Кулика з накладними", "ADMIN"],
  ["Накладна №6451", "ADMIN"],
  ["Розкажи про Кулика", "ADMIN"],
  ["Розкажи про Пайду", "ADMIN"],
  ["Складовщики за тиждень", "ADMIN"],
  ["ABC по товарах", "ADMIN"],
  ["ABC по брендах за квартал", "ADMIN"],
  ["Замовлення з сайту за вчора", "ADMIN"],
];

let bad = 0;
let blocks = 0;
const PARSERS: Record<string, (raw: string) => { ok: boolean; error?: string }> = {
  [BLOCK.chart]: parseChart,
  [BLOCK.kpi]: parseKpi,
  [BLOCK.tree]: parseTree,
};
for (const [q, kind] of QUESTIONS) {
  const who = kind === "ADMIN" ? admin?.id : rep.id;
  if (!who) continue;
  const ctx = {
    userId: who,
    role: kind,
    kind,
    today,
    scope: await scopeOf(who, kind === "ADMIN"),
  };
  const a = await tryDirectAnswer(ctx, q, { hasHistory: false });
  if (!a) continue;

  for (const m of a.markdown.matchAll(/```(budvik-(?:chart|kpi|tree))\s*\n([\s\S]*?)```/g)) {
    blocks++;
    const parsed = PARSERS[m[1]](m[2]);
    if (!parsed.ok) {
      console.log(`✗ ${q}: блок ${m[1]} — ${parsed.error}`);
      bad++;
    }
  }

  let headers = 0;
  for (const line of a.markdown.split("\n")) {
    if (!line.startsWith("|")) { headers = 0; continue; }
    const cells = line.split("|").length - 2;
    if (/^\|[\s-]+\|/.test(line)) continue;
    if (headers === 0) { headers = cells; continue; }
    if (cells !== headers) {
      console.log(`✗ ${q}: заголовків ${headers}, а в рядку ${cells}`);
      console.log(`   ${line.slice(0, 90)}`);
      bad++;
      headers = cells;
    }
  }
}
console.log(bad === 0 ? `✓ усі таблиці рівні, блоків перевірено ${blocks}` : `✗ кривих рядків і блоків: ${bad}`);
await prisma.$disconnect();
