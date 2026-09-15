/**
 * Перевірка розсилки підсумку наради (src/lib/meetings/share.ts) на справжній базі.
 *
 * Створює тимчасових людей — без пароля й пуш-токенів, тож увійти чи
 * отримати пуш вони не можуть, — нараду з підсумком і задачами, проганяє
 * розсилку, кабінет, відкликання й видалення наради. Усе прибирає за собою,
 * навіть якщо перевірка впала посередині.
 *
 *   npx tsx --env-file=.env scripts/check-meeting-share.mts
 */

import { prisma } from "../src/lib/prisma";
import { MeetingError, deleteMeeting } from "../src/lib/meetings";
import {
  getShareState,
  getSharedMeeting,
  listSharedMeetings,
  pushMeetingShare,
  shareKey,
  shareMeeting,
  unshareMeeting,
} from "../src/lib/meetings/share";

const tag = `check-share-${Date.now()}`;
let failures = 0;

function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!ok) failures++;
}

async function rejects(name: string, fn: () => Promise<unknown>, status: number) {
  try {
    await fn();
    check(name, false, "помилки не було");
  } catch (e) {
    // Не instanceof: tsx вантажить src/lib/meetings двічі (шлях скрипта й ./index
    // усередині share.ts), і клас помилки виходить іншим екземпляром.
    const ok = e instanceof Error && e.name !== "PrismaClientKnownRequestError" && (e as Partial<MeetingError>).status === status;
    check(name, ok, e instanceof Error ? e.message : String(e));
  }
}

const boss = await prisma.user.create({ data: { email: `${tag}-boss@budvik.local`, name: "Перевірка Менеджер", role: "MANAGER" } });
const rep = await prisma.user.create({ data: { email: `${tag}-rep@budvik.local`, name: "Перевірка Торговий", role: "SALES" } });
const driver = await prisma.user.create({ data: { email: `${tag}-drv@budvik.local`, name: "Перевірка Водій", role: "DRIVER" } });
const userIds = [boss.id, rep.id, driver.id];

try {
  const old = await prisma.staffTask.create({
    data: { createdById: boss.id, assigneeId: driver.id, title: "Стара задача водію", status: "ASSIGNED", sentAt: new Date() },
  });
  const summary = "Обговорили борги Стрия. Друге речення.";
  const meeting = await prisma.meeting.create({
    data: {
      title: "Перевірка розсилки",
      createdById: boss.id,
      status: "READY",
      noteText: "перевірка",
      processedAt: new Date(),
      transcript: "Speaker A [00:01]: секретна розмова",
      summary,
      structured: {
        suggestedTitle: "Перевірка",
        summary,
        speakers: [{ label: "A", guessedName: "Хтось", userId: null, role: null, evidence: "цитата" }],
        keyPoints: ["Борг 12 000"],
        decisions: ["Відвантаження лише після оплати", "Нові ціни з понеділка"],
        tasks: [],
        progressUpdates: [{ taskId: old.id, taskTitle: old.title, status: "BLOCKED", note: "Клієнт не бере трубку" }],
        openQuestions: ["Хто забере повернення?"],
      },
    },
  });
  await prisma.staffTask.createMany({
    data: [
      { meetingId: meeting.id, createdById: boss.id, assigneeId: rep.id, title: "Звірити борг Стрия", status: "ASSIGNED", sentAt: new Date() },
      { meetingId: meeting.id, createdById: boss.id, assigneeId: rep.id, title: "Пропозиція без підтвердження", status: "PROPOSED" },
      { meetingId: meeting.id, createdById: boss.id, assigneeId: driver.id, title: "Забрати повернення", status: "DONE", sentAt: new Date(), doneAt: new Date() },
    ],
  });

  const st = await getShareState(meeting.id);
  const person = (id: string) => st.people.find((p) => p.id === id);
  check("у виборі є торговий і водій, менеджера нема", !!person(rep.id) && !!person(driver.id) && !person(boss.id));
  check("відмічено торгового (за роллю) і водія (виконавець задачі)", st.suggested.includes(rep.id) && st.suggested.includes(driver.id), st.suggested);

  await rejects("менеджеру надіслати не можна", () => shareMeeting(meeting.id, { userIds: [boss.id] }), 400);
  await rejects("порожній вибір — помилка", () => shareMeeting(meeting.id, { userIds: [] }), 400);
  await rejects("без розсилки торговий нараду не відкриє", () => getSharedMeeting(rep.id, meeting.id), 404);

  const first = await shareMeeting(meeting.id, { userIds: [rep.id, driver.id] });
  check("надіслано двом", first.added === 2, first);
  const again = await shareMeeting(meeting.id, { userIds: [rep.id] });
  check("повторне надсилання нічого не дублює", again.added === 0, again);

  const row = await prisma.notification.findUnique({ where: { dedupKey: shareKey(meeting.id, rep.id) } });
  check(
    "рядок стрічки: REP_MEETING, назва наради, перше речення підсумку",
    row?.type === "REP_MEETING" && row.title === "Нарада: Перевірка розсилки" && row.body === "Обговорили борги Стрия.",
    { type: row?.type, title: row?.title, body: row?.body }
  );

  const pushed = await pushMeetingShare(meeting.id);
  console.log(`  пуш: ${pushed} (0 означає поза 08–19; токенів у тимчасових людей немає)`);

  const list = await listSharedMeetings(rep.id);
  check("у списку торгового одна нарада", list.length === 1 && list[0].id === meeting.id, list.map((x) => x.title));
  check(
    "у рядку списку: 1 відкрита задача, 2 рішення, «нова»",
    list[0]?.myOpenTasks === 1 && list[0]?.decisions === 2 && list[0]?.isNew === true,
    list[0]
  );

  const view = await getSharedMeeting(rep.id, meeting.id);
  check("свої задачі — лише підтверджена", view.mine.length === 1 && view.mine[0].title === "Звірити борг Стрия", view.mine.map((t) => t.title));
  check(
    "«хто що робить» — виконана задача водія, пропозицій нема",
    view.team.length === 1 && view.team[0].done && view.team[0].assigneeName === "Перевірка Водій",
    view.team
  );
  check(
    "хід по старій задачі з ім'ям виконавця",
    view.progress[0]?.assigneeName === "Перевірка Водій" && view.progress[0]?.status === "BLOCKED",
    view.progress
  );
  check("рішення, питання й підсумок на місці", view.decisions.length === 2 && view.openQuestions.length === 1 && view.summary === summary && !view.updating);
  const json = JSON.stringify(view);
  check("транскрипту й спікерів у відповіді немає", !json.includes("секретна розмова") && !json.includes("цитата"));
  const read = await prisma.notification.findUnique({ where: { dedupKey: shareKey(meeting.id, rep.id) }, select: { isRead: true } });
  check("відкриття позначає рядок прочитаним", read?.isRead === true);

  await rejects("кому не надсилали — не відкриє", () => getSharedMeeting(boss.id, meeting.id), 404);

  await unshareMeeting(meeting.id, rep.id);
  await rejects("після «прибрати» торговий нараду не бачить", () => getSharedMeeting(rep.id, meeting.id), 404);
  check("водій після цього досі бачить", (await getSharedMeeting(driver.id, meeting.id)).id === meeting.id);

  await deleteMeeting(meeting.id);
  const left = await prisma.notification.count({ where: { type: "REP_MEETING", relatedId: meeting.id } });
  check("видалення наради прибирає розсилку", left === 0, left);
} finally {
  await prisma.staffTask.deleteMany({ where: { OR: [{ createdById: { in: userIds } }, { assigneeId: { in: userIds } }] } });
  await prisma.meeting.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}

console.log(failures ? `\nНе пройшло перевірок: ${failures}` : "\nУсе пройшло. Тимчасових людей, нараду й рядки прибрано.");
process.exit(failures ? 1 : 0);
