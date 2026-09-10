/**
 * Кожна таблиця у відповідях мусить мати стільки клітинок, скільки
 * заголовків.
 *
 * Зайва клітинка в маркдауні не падає й не підкреслюється: рядок просто
 * тихо втрачає останній стовпець, і помітити це можна лише очима на
 * готовому екрані. Саме так проскочили дві таблиці, коли до товарів
 * додавали колонку з артикулом.
 *
 *   npx tsx --env-file=.env scripts/assistant-tables.mts
 */
import { prisma } from "../src/lib/prisma";
import { tryDirectAnswer } from "../src/lib/assistant/direct";
import { scopeOf } from "../src/lib/assistant/scope";
import { kyivDate } from "../src/lib/date/kyiv";

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
console.log(bad === 0 ? "✓ усі таблиці рівні" : `✗ кривих рядків: ${bad}`);
await prisma.$disconnect();
