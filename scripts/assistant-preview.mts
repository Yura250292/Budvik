/**
 * Як виглядають усі типові відповіді помічника — одним прогоном.
 *
 * Оформлення однакове для всіх відповідей (заголовок зі знаком, таблиці
 * там, де числа порівнюються, світлофор і кнопки «спитати далі»), а
 * перевірити його інакше можна лише клікаючи по одній у кабінеті.
 * Модель тут не бере участі: усе це складає код.
 *
 *   npx tsx --env-file=.env scripts/assistant-preview.mts [фрагмент питання]
 */

import { prisma } from "../src/lib/prisma";
import { tryDirectAnswer } from "../src/lib/assistant/direct";
import { kyivDate } from "../src/lib/date/kyiv";
import { scopeOf } from "../src/lib/assistant/scope";

const REP = "rep-kavetskyi-viktor@budvik.local";
/** Керівник дивиться тією самою розмовою, але про всю фірму. */
const ADMIN = process.env.ADMIN_EMAIL ?? "ufedishin@gmail.com";
const DRIVER_QUESTIONS = ["Що в мене сьогодні на маршруті"];

const ADMIN_QUESTIONS = [
  "Хто зараз на маршруті",
  "Продажі по торгових за місяць",
  "Скільки продав Кулик за тиждень",
  "Дебіторка по торгових",
  "Дебіторка по Кулику",
  "Хто скільки зібрав за тиждень",
  "Зміни торгових за тиждень",
  "Де зараз водії",
  "Зарплата водіїв за минулий місяць",
  "Замовлення з сайту за тиждень",
  "Що закінчується на складі",
  "Оборотність складу",
  "Що з обміном 1С",
  "Прогноз по фірмі",
  "Повернення по фірмі за 90 днів",
  "Що ти вмієш",
];

const QUESTIONS = [
  "Сплануй мій день",
  "Сплануй день на завтра",
  "Хто мені винен",
  "Хто з моїх клієнтів давно не брав",
  "Які мертві товари можу розпрацювати",
  "Скільки я продав",
  "Скільки я продав за 30 днів",
  "Скільки я продав за минулий місяць",
  "Скільки я продав з 01.08 по 15.08",
  "Чи витягну план",
  "Як я на фоні команди",
  "Мої найважливіші клієнти",
  "Скільки в мене повернень",
  "Куди я їжджу по вівторках",
  "З чим зайти до Левковича",
  "Що запропонувати Левковичу",
  "Що з Левковичем",
  "Скільки піни залишилось на складі",
  "Хто поруч",
  "знайди мені клієнтів у місті Сокільники кого можна розпрацювати і до кого завітати",
  "Хто мені заплатив за тиждень",
  "Чи заплатив Левкович",
  "Покажи останню накладну Левковича",
  "Чи брав Левкович дріт",
  "Що ти вмієш",
  "Що беруть разом із кругами Ataman",
  "Чим замінити піну Soma fix",
  "Нагадай завтра о 9 подзвонити Левковичу про борг",
  "Мої нагадування",
  "Побудуй маршрут: Левкович, Скуратов, Хома Юля",
];

const filter = process.argv[2]?.toLowerCase();
const rep = await prisma.user.findFirstOrThrow({ where: { email: REP }, select: { id: true } });
const admin = await prisma.user.findFirst({ where: { email: ADMIN }, select: { id: true } });
const today = kyivDate(new Date());

if (!admin) console.log(`(акаунта ${ADMIN} немає — питання керівника пропускаю)\n`);

for (const question of [...QUESTIONS, ...DRIVER_QUESTIONS, ...(admin ? ADMIN_QUESTIONS : [])]) {
  if (filter && !question.toLowerCase().includes(filter)) continue;

  const kind = ADMIN_QUESTIONS.includes(question)
    ? "ADMIN"
    : DRIVER_QUESTIONS.includes(question)
      ? "DRIVER"
      : "SALES";
  const who = kind === "ADMIN" ? admin!.id : rep.id;
  const ctx = {
    userId: who,
    role: kind === "ADMIN" ? "ADMIN" : kind,
    kind: kind as "SALES" | "DRIVER" | "ADMIN",
    today,
    scope: await scopeOf(who, kind === "ADMIN"),
  };

  const started = Date.now();
  const answer = await tryDirectAnswer(ctx, question, { hasHistory: false });
  console.log(`\n${"═".repeat(72)}\n▸ ${question}   [${answer ? `${Date.now() - started} мс` : "МОДЕЛЬ"}]\n`);
  if (answer) console.log(answer.markdown);
}

await prisma.$disconnect();
