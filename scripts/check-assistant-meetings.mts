/**
 * Інструмент помічника `meetings` на справжній (локальній) базі.
 *
 * Створює тимчасового менеджера й торгового (без пароля — увійти не можуть),
 * нараду з підсумком у тому форматі, який пише воркер (теми, ризики, клієнти),
 * і три задачі в різних станах. Проганяє режими list / meeting / tasks і пошук
 * по транскрипту. Усе прибирає за собою, навіть якщо перевірка впала.
 *
 *   npx tsx --env-file=.env scripts/check-assistant-meetings.mts
 *
 * Пише в базу — лише локальна.
 */

import { prisma } from "../src/lib/prisma";
import { meetingsTool } from "../src/lib/assistant/tools/meetings";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${typeof got === "string" ? got : JSON.stringify(got)?.slice(0, 300)}`);
  if (!ok) fails.push(name);
}

const tag = `check-meetings-${Date.now()}`;
const boss = await prisma.user.create({ data: { email: `${tag}-boss@budvik.local`, name: "Перевірка Менеджер", role: "MANAGER" } });
const rep = await prisma.user.create({ data: { email: `${tag}-rep@budvik.local`, name: "Перевіркович Торговий", role: "SALES" } });
const today = new Date().toISOString().slice(0, 10);
const ctx = { userId: boss.id, role: "ADMIN", kind: "ADMIN", scope: { repId: boss.id, repName: "x", company: true }, today } as never;
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const run = async (args: Record<string, unknown>) => (await meetingsTool.run(ctx, args)) as Out;

let meetingId = "";
try {
  const m = await prisma.meeting.create({
    data: {
      title: `Нарада ${tag}`,
      createdById: boss.id,
      status: "READY",
      recordedAt: new Date(Date.now() - 3600_000),
      audioDurationMs: 23 * 60_000,
      transcript: "Спершу про погоду. Потім довго про Атаман: демпінг з багажників у Стрию, треба перевірити точки. Кінець.",
      summary: "Коротко: демпінг Атамана і стенди.",
      structured: {
        suggestedTitle: "Атаман і стенди",
        summary: "Обговорили демпінг Атамана у Стрию і оплату стендів Полакс.",
        speakers: [{ label: "A", guessedName: "Юрій", role: "власник", userId: null, evidence: "" }],
        keyPoints: ["Демпінг з багажників"],
        decisions: ["Стенди Полакс обслуговуємо самі", "Атаман продаємо по старій ціні до п'ятниці"],
        tasks: [],
        progressUpdates: [],
        openQuestions: ["Хто платить за стенд?"],
        topics: [{ title: "Демпінг Атамана", timeRange: "00:00–05:10", points: ["Багажникові продажі у Стрию", "Треба фото точок"] }],
        risks: ["Демпінг підриває ціну"],
        clients: [{ name: "Київзахід", note: "продає по 13,2" }],
      },
      processedAt: new Date(),
    },
  });
  meetingId = m.id;
  const past = new Date(Date.now() - 2 * 86_400_000);
  await prisma.staffTask.createMany({
    data: [
      { meetingId: m.id, createdById: boss.id, assigneeId: rep.id, title: "Сфотографувати стенди", status: "ASSIGNED", sentAt: past, dueAt: past },
      { meetingId: m.id, createdById: boss.id, assigneeNameHeard: "менеджер", title: "Порахувати оплату стендів", status: "PROPOSED" },
      { meetingId: m.id, createdById: boss.id, assigneeId: rep.id, title: "Обдзвонити Стрий", status: "DONE", doneAt: new Date(), doneNote: "обдзвонив 12" },
    ],
  });

  /* ── list ─────────────────────────────────────────────────────────── */
  const list = await run({});
  const mine = (list.наради ?? []).find((x: Out) => x.id === m.id);
  check("список: нарада є", !!mine, list.наради?.map((x: Out) => x.назва));
  check("список: рішення", mine?.рішення?.length === 2, mine?.рішення);
  check("список: задачі по станах", mine?.задачі?.чекають_підтвердження === 1 && mine?.задачі?.надіслано === 1 && mine?.задачі?.виконано === 1, mine?.задачі);
  check("список: тривалість", mine?.хвилин === 23, mine?.хвилин);

  /* ── пошук по транскрипту ─────────────────────────────────────────── */
  const found = await run({ q: "багажник" });
  const hit = (found.наради ?? []).find((x: Out) => x.id === m.id);
  check("пошук знаходить за словом з транскрипту", !!hit, found.наради?.length);
  check("пошук дає уривок навколо слова", typeof hit?.уривок === "string" && hit.уривок.includes("багажник"), hit?.уривок);
  const none = await run({ q: "слово-якого-точно-немає-xyz" });
  check("пошук без збігів — порожньо", (none.наради ?? []).every((x: Out) => x.id !== m.id), none.наради?.length);

  /* ── meeting ──────────────────────────────────────────────────────── */
  const one = await run({ mode: "meeting", meeting: m.id });
  check("нарада: теми з пунктами", one.теми?.[0]?.пункти?.length === 2, one.теми);
  check("нарада: ризики, питання, клієнти", one.ризики?.length === 1 && one.відкриті_питання?.length === 1 && one.клієнти?.[0]?.назва === "Київзахід", [one.ризики, one.відкриті_питання, one.клієнти]);
  check("нарада: задачі з виконавцями й станами", one.задачі?.length === 3 && one.задачі.some((t: Out) => t.кому === "Перевіркович Торговий" && t.прострочено), one.задачі);
  check("нарада: учасники", one.учасники?.[0]?.хто === "Юрій", one.учасники);
  const byTitle = await run({ mode: "meeting", meeting: tag });
  check("нарада за шматком назви", byTitle.id === m.id, byTitle.id ?? byTitle.помилка);
  const nope = await run({ mode: "meeting", meeting: "немає-такої-наради-xyz" });
  check("невідома нарада — помилка, а не виняток", typeof nope.помилка === "string", nope);

  /* ── tasks ────────────────────────────────────────────────────────── */
  const tasks = await run({ mode: "tasks" });
  const person = (tasks.по_людях ?? []).find((p: Out) => p.хто === "Перевіркович Торговий");
  check("задачі: по людях", person?.відкриті === 1 && person?.прострочені === 1 && person?.виконано_за_період === 1, person);
  check("задачі: прострочені списком", (tasks.прострочені ?? []).some((t: Out) => t.що === "Сфотографувати стенди"), tasks.прострочені);
  check("задачі: чекають підтвердження", (tasks.чекають_підтвердження ?? []).some((t: Out) => t.що === "Порахувати оплату стендів"), tasks.чекають_підтвердження);
  const forRep = await run({ mode: "tasks", person: "Перевіркович" });
  check("задачі однієї людини", forRep.по_людях?.length === 1, forRep.по_людях);
} finally {
  if (meetingId) {
    await prisma.staffTask.deleteMany({ where: { meetingId } });
    await prisma.meeting.delete({ where: { id: meetingId } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: [boss.id, rep.id] } } });
  await prisma.$disconnect();
}

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
