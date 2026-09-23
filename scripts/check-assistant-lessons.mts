/**
 * Проба петлі правил помічника: завести → відібрати → побачити в ході → прибрати.
 *
 * Перевіряє п'ять меж, кожна з яких колись була помилкою або могла нею стати:
 * порожній набір не творить блоку; чернетка в хід не йде ніколи; правило з
 * тригером їде ЛИШЕ на своє питання (перша проба показала протилежне —
 * правило про закупівлю доїхало в питання про маршрут); правило одного виду
 * помічника не тече в інший; блок стоїть останнім у контексті ходу.
 *
 *   npx tsx --env-file=.env scripts/check-assistant-lessons.mts
 *
 * Пише три рядки у власну таблицю правил і прибирає їх за собою. У базу 1С
 * не пишеться нічого.
 */
import { prisma } from "@/lib/prisma";
import { pickLessons, suggestTriggers } from "@/lib/assistant/lessons";
import { buildTurnContext } from "@/lib/assistant/prompt";

async function main() {
  const before = await pickLessons("ADMIN", "що закупити на грудень");
  console.log("1. Порожній набір правил →", before.block === null ? "блоку немає ✅" : "!!! блок є");

  const general = await prisma.assistantLesson.create({
    data: { text: "Відповідай числами, а не описом: спершу сума, потім пояснення.", status: "ACTIVE", triggers: [] },
  });
  const triggers = suggestTriggers("що закупити на грудень із генераторів");
  console.log("2. Тригери з питання →", triggers.join(", "));
  const scoped = await prisma.assistantLesson.create({
    data: { text: "У питаннях про закупівлю завжди називай залишок, а не тільки продажі.", status: "ACTIVE", triggers, kind: "ADMIN" },
  });
  const draft = await prisma.assistantLesson.create({
    data: { text: "Це чернетка, вона не має потрапити в хід ніколи.", status: "DRAFT", triggers: [] },
  });

  const hit = await pickLessons("ADMIN", "що закупити на грудень із генераторів");
  console.log("3. Питання з тригером → правил у ході:", hit.ids.length);
  console.log("   чернетка всередині:", hit.block?.includes("чернетка") ? "!!! Є — помилка" : "немає ✅");
  console.log("   тригерне всередині:", hit.block?.includes("залишок") ? "є ✅" : "!!! немає");

  const miss = await pickLessons("ADMIN", "хто сьогодні на маршруті");
  console.log("4. Питання без тригера → правил:", miss.ids.length, miss.block?.includes("залишок") ? "!!! тригерне просочилось" : "(лише загальне) ✅");

  const other = await pickLessons("SALES", "що закупити на грудень із генераторів");
  console.log("5. Інший вид помічника → правил:", other.ids.length, other.block?.includes("залишок") ? "!!! чуже правило" : "(лише загальне) ✅");

  const ctx = buildTurnContext({
    today: "2026-09-23", scope: { repId: "x", repName: "Офіс", company: true },
    selfScoped: true, kind: "ADMIN", lessons: hit.block,
  });
  console.log("\n6. Хвіст контексту ходу:\n---");
  console.log(ctx.split("\n").slice(-4).join("\n"));
  console.log("---");

  await prisma.assistantLesson.deleteMany({ where: { id: { in: [general.id, scoped.id, draft.id] } } });
  const after = await prisma.assistantLesson.count();
  console.log("\n7. Прибрано, лишилось правил у базі:", after);
}

main().finally(() => prisma.$disconnect());
