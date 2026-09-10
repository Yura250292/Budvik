/**
 * Наскрізна перевірка чату персоналу: хто що бачить і кому може писати.
 *
 * Запуск (дев-сервер НЕ потрібен):
 *   npx tsx --env-file=.env scripts/check-chat.ts
 *
 * Заради чого. Правило видимості тут не одне, а чотири, і всі вони живуть
 * у різних місцях: група за роллю, «Усі», особисте й журнал адміністратора.
 * Помилка в будь-якому означає або що людина не бачить адресованого їй, або
 * що вона читає чуже листування — і друге виявиться не в логах, а в розмові
 * між людьми.
 *
 * Роути кличемо НАПРЯМУ через Bearer-токен пристрою: cookie-шлях вимагав би
 * контексту запиту Next, а поведінка requireRoles для обох однакова (це
 * окремо перевіряє scripts/check-identity.ts).
 *
 * Створює користувачів із маркером __e2e_chat__ і прибирає за собою.
 */
import { PrismaClient, type Role } from "@prisma/client";
import { issueDeviceToken } from "../src/lib/track/device-token";
import { GET as conversationsHandler } from "../src/app/api/chat/conversations/route";
import { GET as messagesHandler } from "../src/app/api/chat/messages/[conversation]/route";
import { POST as sendHandler } from "../src/app/api/chat/messages/route";
import { POST as readHandler } from "../src/app/api/chat/read/route";
import { GET as unreadHandler } from "../src/app/api/chat/unread/route";
import { chatPathFor, dmKey, participantsOf, parseKey } from "../src/lib/chat/audience";
import { notifyStaffMessage } from "../src/lib/chat/notify";

const p = new PrismaClient();
const MARK = "__e2e_chat__";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

type Res = { status: number; body: any };
const json = async (r: Response): Promise<Res> => ({ status: r.status, body: await r.json().catch(() => null) });

const auth = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

const conversations = (t: string) =>
  conversationsHandler(new Request("http://x/api/chat/conversations", { headers: auth(t) })).then(json);

const messages = (t: string, key: string) =>
  messagesHandler(new Request(`http://x/api/chat/messages/${key}`, { headers: auth(t) }), {
    params: Promise.resolve({ conversation: key }),
  }).then(json);

const send = (t: string, body: unknown) =>
  sendHandler(new Request("http://x/api/chat/messages", { method: "POST", headers: auth(t), body: JSON.stringify(body) })).then(json);

const markRead = (t: string, conversation: string, upTo: string) =>
  readHandler(
    new Request("http://x/api/chat/read", { method: "POST", headers: auth(t), body: JSON.stringify({ conversation, upTo }) })
  ).then(json);

const unread = (t: string) => unreadHandler(new Request("http://x/api/chat/unread", { headers: auth(t) })).then(json);

/** Чи прийшло поле reads узагалі (а не лише чи воно непорожнє). */
const res0 = (res: Res) => (res.body as { reads?: unknown } | null)?.reads;

/** Чи є повідомлення з таким текстом у розмові. */
const seen = (res: Res, text: string) =>
  Array.isArray(res.body?.messages) && res.body.messages.some((m: any) => m.text === text);

async function cleanup() {
  const users = await p.user.findMany({ where: { email: { startsWith: MARK } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  await p.staffMessage.deleteMany({ where: { OR: [{ authorId: { in: ids } }, { toUserId: { in: ids } }] } });
  await p.assistantThread.deleteMany({ where: { userId: { in: ids } } });
  await p.deviceToken.deleteMany({ where: { userId: { in: ids } } });
  await p.staffChatRead.deleteMany({ where: { userId: { in: ids } } });
  await p.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await cleanup();

  const mk = async (key: string, name: string, role: Role) =>
    p.user.create({ data: { email: `${MARK}${key}@test.local`, name: `${MARK} ${name}`, role } });

  const sales1 = await mk("sales1", "Торговий 1", "SALES");
  const sales2 = await mk("sales2", "Торговий 2", "SALES");
  const driver = await mk("driver", "Водій", "DRIVER");
  const wh = await mk("wh", "Складовщик", "WAREHOUSE");
  const manager = await mk("manager", "Менеджер", "MANAGER");
  const admin = await mk("admin", "Адмін", "ADMIN");

  const T = {
    sales1: await issueDeviceToken(sales1.id, "e2e"),
    sales2: await issueDeviceToken(sales2.id, "e2e"),
    driver: await issueDeviceToken(driver.id, "e2e"),
    wh: await issueDeviceToken(wh.id, "e2e"),
    manager: await issueDeviceToken(manager.id, "e2e"),
    admin: await issueDeviceToken(admin.id, "e2e"),
  };

  // --- 1. Група торгових ---
  const t1 = `${MARK} у групу торгових`;
  const r1 = await send(T.sales1, { text: t1, toRoles: ["SALES"] });
  check("Торговий пише у свою групу → 201", r1.status === 201, r1);
  check("…колега-торговий бачить", seen(await messages(T.sales2, "role-SALES"), t1));
  check("…менеджер бачить (офіс — член кожної групи)", seen(await messages(T.manager, "role-SALES"), t1));
  check("…адмін бачить", seen(await messages(T.admin, "role-SALES"), t1));
  const driverInSales = await messages(T.driver, "role-SALES");
  check("…водієві група торгових закрита → 403", driverInSales.status === 403, driverInSales);

  // --- 2. «Усі» ---
  const t2 = `${MARK} усім`;
  check("Водій пише в «Усі» → 201", (await send(T.driver, { text: t2, toAll: true })).status === 201);
  for (const [who, tok] of [["торговий", T.sales1], ["склад", T.wh], ["менеджер", T.manager], ["адмін", T.admin]] as const) {
    check(`…${who} бачить`, seen(await messages(tok, "all"), t2));
  }

  // --- 3. Особисте ---
  const t3 = `${MARK} особисте`;
  const dm = dmKey(sales1.id, sales2.id);
  const r3 = await send(T.sales1, { text: t3, toUserId: sales2.id });
  check("Особисте торговому → 201", r3.status === 201, r3);
  check("…ключ розмови однаковий з обох боків", r3.body?.conversation === dm, { got: r3.body?.conversation, want: dm });
  check("…адресат бачить", seen(await messages(T.sales2, dm), t3));
  const dmDriver = await messages(T.driver, dm);
  check("…чужий водій → 403", dmDriver.status === 403, dmDriver);
  const dmManager = await messages(T.manager, dm);
  check("…менеджер у чуже особисте → 403", dmManager.status === 403, dmManager);
  const dmAdmin = await messages(T.admin, dm);
  check("…адмін бачить чуже особисте", dmAdmin.status === 200 && seen(dmAdmin, t3), { status: dmAdmin.status });
  check("…і воно є в журналі адміна", seen(await messages(T.admin, "journal"), t3));
  const journalManager = await messages(T.manager, "journal");
  check("Журнал менеджеру закрито → 403", journalManager.status === 403, journalManager);

  // --- 4. Офіс обирає кілька груп галочками ---
  const t4 = `${MARK} двом групам`;
  check("Менеджер пише торговим і водіям → 201", (await send(T.manager, { text: t4, toRoles: ["SALES", "DRIVER"] })).status === 201);
  check("…видно в групі торгових", seen(await messages(T.sales1, "role-SALES"), t4));
  check("…видно в групі водіїв", seen(await messages(T.driver, "role-DRIVER"), t4));
  check("…НЕ видно в групі складу", !seen(await messages(T.wh, "role-WAREHOUSE"), t4));

  // --- 5. Заборони на запис ---
  const foreign = await send(T.sales1, { text: `${MARK} у чужу групу`, toRoles: ["DRIVER"] });
  check("Торговий у групу водіїв → 403", foreign.status === 403, foreign);
  const self = await send(T.sales1, { text: `${MARK} собі`, toUserId: sales1.id });
  check("Особисте самому собі → 400", self.status === 400, self);
  const nobody = await send(T.sales1, { text: `${MARK} нікому` });
  check("Без адресата → 400", nobody.status === 400, nobody);
  const both = await send(T.manager, { text: `${MARK} і туди і сюди`, toRoles: ["SALES"], toUserId: driver.id });
  check("Групи разом з людиною → 400", both.status === 400, both);
  const empty = await send(T.sales1, { text: "   ", toAll: true });
  check("Порожній текст без фото → 400", empty.status === 400, empty);
  const long = await send(T.sales1, { text: "я".repeat(4001), toAll: true });
  check("Задовге повідомлення → 400", long.status === 400, long);
  const badPhoto = await send(T.sales1, {
    toAll: true,
    photos: [{ key: `chat/2026/09/${sales2.id}-abc123.jpg`, width: 10, height: 10, bytes: 10 }],
  });
  check("Фото з чужим ключем → 400", badPhoto.status === 400, badPhoto);
  const journalWrite = await messages(T.admin, "journal");
  check("У журнал писати не можна (canWrite=false)", journalWrite.body?.conversation?.canWrite === false);

  // --- 6. Непрочитане ---
  const beforeRead = await conversations(T.sales2);
  const salesRow = beforeRead.body?.conversations?.find((c: any) => c.key === "role-SALES");
  check("У колеги є непрочитане в групі", (salesRow?.unread ?? 0) > 0, salesRow);
  const totalBefore = (await unread(T.sales2)).body?.total ?? 0;
  check("Лічильник непрочитаного більший за нуль", totalBefore > 0, { totalBefore });
  const last = (await messages(T.sales2, "role-SALES")).body.messages.at(-1);
  check("Відмітка прочитання → ok", (await markRead(T.sales2, "role-SALES", last.createdAt)).body?.ok === true);
  const afterRead = await conversations(T.sales2);
  const salesAfter = afterRead.body?.conversations?.find((c: any) => c.key === "role-SALES");
  check("…після відмітки непрочитаного в групі немає", salesAfter?.unread === 0, salesAfter);
  /**
   * Власне повідомлення не робить розмову непрочитаною.
   *
   * Спеціально від чистого аркуша: у групі вже лежать чужі повідомлення, і
   * без відмітки перевірка міряла б їх, а не те, що перевіряється. Мітку
   * прочитання при відправці НЕ ставимо навмисно — вона заодно погасила б
   * чуже непрочитане, якого людина не бачила.
   */
  const salesLast = (await messages(T.sales1, "role-SALES")).body.messages.at(-1);
  await markRead(T.sales1, "role-SALES", salesLast.createdAt);
  const zeroRow = (await conversations(T.sales1)).body?.conversations?.find((c: any) => c.key === "role-SALES");
  check("Після дочитування непрочитаного немає", (zeroRow?.unread ?? 0) === 0, zeroRow);
  await send(T.sales1, { text: `${MARK} власне після дочитування`, toRoles: ["SALES"] });
  const authorRow = (await conversations(T.sales1)).body?.conversations?.find((c: any) => c.key === "role-SALES");
  check("Автор не має непрочитаного у власному повідомленні", (authorRow?.unread ?? 0) === 0, authorRow);
  const colleagueRow = (await conversations(T.sales2)).body?.conversations?.find((c: any) => c.key === "role-SALES");
  check("…а колега його бачить як непрочитане", (colleagueRow?.unread ?? 0) === 1, colleagueRow);

  // --- 7. Склад списку розмов ---
  const listSales = await conversations(T.sales1);
  const keys = (listSales.body?.conversations ?? []).map((c: any) => c.key);
  check("У торгового: «Усі» і своя група", keys.includes("all") && keys.includes("role-SALES"));
  check("…без чужих груп", !keys.includes("role-DRIVER") && !keys.includes("role-WAREHOUSE"), keys);
  check("…без журналу", !keys.includes("journal"));
  check("…особиста розмова в списку", keys.includes(dm), keys);
  check("Галочки груп торговому не даються", listSales.body?.canPickGroups === false);
  const listManager = await conversations(T.manager);
  const mKeys = (listManager.body?.conversations ?? []).map((c: any) => c.key);
  check("Менеджер бачить усі групи", ["all", "role-SALES", "role-DRIVER", "role-WAREHOUSE"].every((k) => mKeys.includes(k)), mKeys);
  check("…і не бачить журналу", !mKeys.includes("journal"));
  check("Менеджеру даються галочки груп", listManager.body?.canPickGroups === true);
  const listAdmin = await conversations(T.admin);
  check("Адмін бачить журнал", (listAdmin.body?.conversations ?? []).some((c: any) => c.key === "journal"));
  check("Довідник людей приїхав зі списком", (listSales.body?.people ?? []).length >= 6);

  // --- 8. Пересилання відповіді помічника ---
  const thread = await p.assistantThread.create({ data: { userId: sales1.id, repId: sales1.id } });
  const answer = await p.assistantMessage.create({
    data: { threadId: thread.id, role: "ASSISTANT", content: `## Борг\nКунанець винен 1000 ₴\n\n> 💬 Питання? · Ще питання?` },
  });
  const fwd = await send(T.sales1, { toAll: true, sourceAssistantMessageId: answer.id, sourceSection: "sales", text: "гляньте" });
  check("Пересилання відповіді помічника → 201", fwd.status === 201, fwd);
  check("…текст узято з бази", fwd.body?.message?.quote?.includes("Кунанець винен 1000 ₴"), fwd.body?.message?.quote);
  check("…рядок-кнопки зрізано", !fwd.body?.message?.quote?.includes("💬"), fwd.body?.message?.quote);
  check("…вид ASSISTANT", fwd.body?.message?.kind === "ASSISTANT");
  check("…власний коментар лишився", fwd.body?.message?.text === "гляньте");
  const foreignFwd = await send(T.sales2, { toAll: true, sourceAssistantMessageId: answer.id, sourceSection: "sales" });
  check("Чужа відповідь помічника → 404", foreignFwd.status === 404, foreignFwd);
  const userMsg = await p.assistantMessage.create({ data: { threadId: thread.id, role: "USER", content: "питання" } });
  const notAnswer = await send(T.sales1, { toAll: true, sourceAssistantMessageId: userMsg.id });
  check("Власне питання (не відповідь) → 404", notAnswer.status === 404, notAnswer);

  // --- 7б. Статуси «переглянуто» ---
  /**
   * Галочки рахуються з міток прочитання розмови, а не з окремої таблиці на
   * кожне повідомлення. Перевіряємо саме те, від чого залежить показ: чи
   * приїхали мітки всіх учасників і чи правильно з них виводиться список
   * тих, хто ще не бачив.
   */
  const statusText = `${MARK} перевірка галочок`;
  await send(T.sales1, { text: statusText, toRoles: ["SALES"] });
  const salesThread = await messages(T.sales1, "role-SALES");
  const mine = salesThread.body.messages.find((m: any) => m.text === statusText);
  const readsOf = (res: Res) => (res.body?.reads ?? []) as Array<{ userId: string; readAt: string }>;
  check("Мітки прочитання їдуть разом із повідомленнями", Array.isArray(res0(salesThread)), {
    reads: readsOf(salesThread).length,
  });
  const seenBefore = readsOf(salesThread).filter(
    (r) => r.userId !== sales1.id && new Date(r.readAt).getTime() >= new Date(mine.createdAt).getTime()
  );
  check("Одразу після надсилання ніхто не переглянув", seenBefore.length === 0, seenBefore);

  await markRead(T.sales2, "role-SALES", mine.createdAt);
  const afterSeen = readsOf(await messages(T.sales1, "role-SALES")).filter(
    (r) => r.userId !== sales1.id && new Date(r.readAt).getTime() >= new Date(mine.createdAt).getTime()
  );
  check("Після відкриття колегою — переглянуто", afterSeen.some((r) => r.userId === sales2.id), afterSeen);

  // Учасники групи виводяться з довідника людей — тим самим кодом, що й у кабінеті.
  const people = (await conversations(T.sales1)).body.people as Array<{ id: string; role: string }>;
  const groupPeople = participantsOf(parseKey("role-SALES")!, people).map((p) => p.id);
  check("У групі торгових є обидва торгові", groupPeople.includes(sales1.id) && groupPeople.includes(sales2.id));
  check("…і офіс як учасник", groupPeople.includes(manager.id) && groupPeople.includes(admin.id));
  check("…але не водій", !groupPeople.includes(driver.id), groupPeople.length);
  const dmPeople = participantsOf(parseKey(dm)!, people).map((p) => p.id);
  check("В особистій рівно двоє", dmPeople.length === 2 && dmPeople.includes(sales1.id) && dmPeople.includes(sales2.id), dmPeople);
  check("У журналі учасників немає (це зріз, а не розмова)", participantsOf(parseKey("journal")!, people).length === 0);

  // --- 8б. Пуш: адреси, які застосунок справді вміє відкрити ---
  /**
   * Білий список тапів у mobile/src/track/notification-taps.ts. Якщо
   * розійдеться — пуш прийде, а тап відкриє порожній застосунок замість
   * розмови, і це помітить лише людина в полі.
   */
  const CABINET_TARGET = /^\/(sales|driver|warehouse)(\/[\w\-/]*)?$/;
  const dmPath = chatPathFor("SALES", dmKey(sales1.id, sales2.id));
  check("Пуш веде в кабінет ролі", chatPathFor("DRIVER", "all") === "/driver/chat/all", chatPathFor("DRIVER", "all"));
  check("Адреса групи проходить білий список", CABINET_TARGET.test(chatPathFor("WAREHOUSE", "role-WAREHOUSE")));
  check("Адреса особистої проходить білий список", CABINET_TARGET.test(dmPath), dmPath);
  check(
    "Офісна адреса свідомо НЕ проходить (тап лише відкриє застосунок)",
    !CABINET_TARGET.test(chatPathFor("ADMIN", "all")),
    chatPathFor("ADMIN", "all")
  );

  // Розсилка не має падати: у тестових акаунтів пристроїв немає, тож це
  // перевірка самої логіки адресатів, а не доставки.
  const groupMsg = await send(T.manager, { text: `${MARK} для пуша`, toRoles: ["SALES", "DRIVER"] });
  let pushOk = true;
  try {
    await notifyStaffMessage(groupMsg.body.message.id);
  } catch (e) {
    pushOk = false;
    console.log("   ", e);
  }
  check("Розсилка пушів відпрацювала без помилки", pushOk);

  // --- 9. Невідома розмова ---
  const nokey = await messages(T.sales1, "role-НЕМАЄ");
  check("Невідомий ключ розмови → 404", nokey.status === 404, nokey);
  const dmSelf = await messages(T.sales1, `dm-${sales1.id}-${sales1.id}`);
  check("Особиста сама з собою → 404", dmSelf.status === 404, dmSelf);

  // --- 10. Прибирання ---
  await cleanup();
  const left = await p.staffMessage.count({ where: { text: { contains: MARK } } });
  check("Сміття не лишилось", left === 0, { left });

  console.log(failed === 0 ? "\nУсе гаразд." : `\nПомилок: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => {});
    process.exit(1);
  })
  .finally(() => p.$disconnect());
