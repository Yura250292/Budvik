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
const DRIVER_QUESTIONS = ["Що в мене сьогодні на маршруті"];

const QUESTIONS = [
  "Сплануй мій день",
  "Хто мені винен",
  "Хто з моїх клієнтів давно не брав",
  "Які мертві товари можу розпрацювати",
  "Скільки я продав за місяць",
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
  "Хто мені заплатив за тиждень",
  "Чи заплатив Левкович",
  "Що беруть разом із кругами Ataman",
  "Чим замінити піну Soma fix",
  "Нагадай завтра о 9 подзвонити Левковичу про борг",
  "Мої нагадування",
];

const filter = process.argv[2]?.toLowerCase();
const rep = await prisma.user.findFirstOrThrow({ where: { email: REP }, select: { id: true } });
const today = kyivDate(new Date());

for (const question of [...QUESTIONS, ...DRIVER_QUESTIONS]) {
  if (filter && !question.toLowerCase().includes(filter)) continue;

  const kind = DRIVER_QUESTIONS.includes(question) ? "DRIVER" : "SALES";
  const ctx = {
    userId: rep.id,
    role: kind === "DRIVER" ? "DRIVER" : "SALES",
    kind: kind as "SALES" | "DRIVER",
    today,
    scope: await scopeOf(rep.id),
  };

  const started = Date.now();
  const answer = await tryDirectAnswer(ctx, question, { hasHistory: false });
  console.log(`\n${"═".repeat(72)}\n▸ ${question}   [${answer ? `${Date.now() - started} мс` : "МОДЕЛЬ"}]\n`);
  if (answer) console.log(answer.markdown);
}

await prisma.$disconnect();
