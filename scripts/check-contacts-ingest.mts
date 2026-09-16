/**
 * Наскрізна перевірка прийому контактів із 1С (канал counterparty_contact).
 *
 * Канал ще жодного разу не працював на живих даних, а помилка злиття тут
 * коштує чужої роботи: затертий телефон, який торговий уточнив руками, або
 * повідомлення на міський номер. Тому обробник проганяється по всіх станах
 * до того, як агент на сервері 1С отримає прапорець scope.contacts.
 *
 * ЛИШЕ на локальній базі: скрипт створює й видаляє контрагентів. Хост
 * DATABASE_URL перевіряється ДО підключення Prisma, і на будь-що, крім
 * 127.0.0.1/localhost (тобто й на прод-URL із .env), скрипт відмовляється
 * стартувати. Власні записи мають префікс tst_contacts_ і прибираються в кінці.
 *
 *   DATABASE_URL=postgresql://admin@127.0.0.1:5432/budvik_outreach_migcheck \
 *     npx tsx scripts/check-contacts-ingest.mts
 */
import type { ContactRowRecord, CounterpartyContactsRecord } from "../src/lib/sync-ingest/types";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
let dbHost = "";
try {
  dbHost = new URL(process.env.DATABASE_URL ?? "").hostname;
} catch {
  // Порожній або кривий URL — нижче відмова.
}
if (!LOCAL_HOSTS.has(dbHost)) {
  console.error(
    `Відмова: DATABASE_URL веде на «${dbHost || "не задано"}», а не на локальну базу.\n` +
      "Скрипт пише й видаляє контрагентів — запускати лише так:\n" +
      "  DATABASE_URL=postgresql://admin@127.0.0.1:5432/budvik_outreach_migcheck npx tsx scripts/check-contacts-ingest.mts"
  );
  process.exit(2);
}

// Динамічно й лише після перевірки хоста: статичний імпорт підняв би клієнт
// Prisma раніше, ніж відмова встигла б спрацювати.
const { prisma } = await import("../src/lib/prisma");
const { ApplyContext } = await import("../src/lib/sync-ingest/context");
const { applyCounterpartyContacts } = await import("../src/lib/sync-ingest/apply-contacts");
const { dispatchBatch } = await import("../src/lib/sync-ingest/dispatch");
const kinds = await import("../src/lib/contacts/kinds");

const PREFIX = `tst_contacts_${Date.now()}`;
let failed = 0;

const ok = (name: string, cond: boolean, extra: unknown = "") => {
  if (!cond) {
    failed++;
    console.log(`  ✗ ${name}`, extra ?? "");
  } else {
    console.log(`  ✓ ${name}`);
  }
};

const LANDLINE = "(032) 245-12-34";
const MOBILE = "067-123-45-67";
const MOBILE_E164 = "+380671234567";
const FAX = "0322451235";
const DELIVERY = "м. Львів, вул. Городоцька, 1";
const LEGAL = "м. Київ, вул. Хрещатик, 1";

const row = (kind1C: string, type1C: string, value: string, ordinal: number): ContactRowRecord => ({
  kind1C,
  type1C,
  value,
  ordinal,
});

/** Контакти, як їх шле агент: уже відсортовані за видом і значенням. */
const base = (landline = LANDLINE): ContactRowRecord[] => [
  row("Адрес доставки", "Адрес", DELIVERY, 0),
  row("Мобильный телефон контактного лица контрагента", "Телефон", MOBILE, 1),
  row("Телефон контрагента", "Телефон", landline, 2),
  row("Факс контрагента", "Телефон", FAX, 3),
  row("Юридический адрес контрагента", "Адрес", LEGAL, 4),
];

function pureChecks() {
  console.log("Вид контакту (без бази)");
  const c = kinds.classifyContactKind;
  ok("мобільний у телефонному рядку → MOBILE", c("Телефон контрагента", "Телефон", MOBILE) === "MOBILE");
  ok("міський → PHONE", c("Телефон контрагента", "Телефон", LANDLINE) === "PHONE");
  ok("факс із типом «Телефон» → OTHER", c("Факс контрагента", "Телефон", FAX) === "OTHER");
  ok(
    "E-Mail → EMAIL, хоч у назві виду є «адрес»",
    c("Адрес электронной почты контрагента для обмена электронными документами", "E-Mail", "a@b.ua") ===
      "EMAIL"
  );
  ok("адреса доставки → ADDRESS", c("Адрес доставки", "Адрес", DELIVERY) === "ADDRESS");
  ok("широта → OTHER", c("Географическая широта", "Другое", "49.84") === "OTHER");
  ok("без типу — за назвою виду", c("Телефон физ. лица домашний", undefined, MOBILE) === "MOBILE");
  ok(
    "«физ. лица» і «физ.лица» — один вид у пріоритеті",
    kinds.kindRank("Телефон физ. лица служебный", kinds.PHONE_KIND_PRIORITY) === 2
  );
  const longKey = kinds.contactExternalKey("7c41f9f0-d591-11eb-8021-f079596e5c94", null, "Адрес доставки", "x".repeat(2000));
  ok("ключ не росте разом з адресою", longKey.length < 120, longKey.length);
}

async function main() {
  pureChecks();

  const ids = { a: `${PREFIX}_a`, b: `${PREFIX}_b`, c: `${PREFIX}_c` };
  const ext = { a: `${PREFIX}-a`, b: `${PREFIX}-b`, c: `${PREFIX}-c` };

  const job = await prisma.syncJob.create({
    data: { type: "contacts-check", status: "running", fileName: `${PREFIX}.check` },
    select: { id: true },
  });
  await prisma.counterparty.createMany({
    data: [
      { id: ids.a, externalId: ext.a, name: `Перевірка контактів A ${PREFIX}`, type: "CUSTOMER" },
      // Мобільний вписаний людиною в поле картки, у 1С рядків немає.
      { id: ids.b, externalId: ext.b, name: `Перевірка контактів B ${PREFIX}`, type: "CUSTOMER", phone: "0931234567 Оксана" },
      { id: ids.c, externalId: ext.c, name: `Перевірка контактів C ${PREFIX}`, type: "CUSTOMER" },
    ],
  });

  const ctxOf = (kind: "incremental" | "full" | "preview" = "incremental") =>
    new ApplyContext(job.id, `${PREFIX}-run`, kind);
  const rec = (externalId: string, contacts: ContactRowRecord[]): CounterpartyContactsRecord => ({
    externalId,
    contacts,
  });
  const rowsOf = (counterpartyId: string, source = "ONE_C") =>
    prisma.counterpartyContact.findMany({ where: { counterpartyId, source }, orderBy: { ordinal: "asc" } });
  const card = (id: string) =>
    prisma.counterparty.findUniqueOrThrow({
      where: { id },
      select: {
        phone: true,
        email: true,
        address: true,
        primaryPhoneE164: true,
        contactsSyncedAt: true,
        updatedAt: true,
      },
    });
  const counts = (ctx: InstanceType<typeof ApplyContext>) => ({
    c: ctx.created,
    u: ctx.updated,
    s: ctx.skipped,
    f: ctx.failed,
    e: ctx.errors,
  });

  try {
    console.log("\nПерший прогін: картка без контактів");
    {
      const ctx = ctxOf();
      await applyCounterpartyContacts([rec(ext.a, base())], ctx);
      const rows = await rowsOf(ids.a);
      const c = await card(ids.a);
      const byKind1C = new Map(rows.map((r) => [r.kind1C, r]));
      ok("контрагента пораховано як створеного", ctx.created === 1 && ctx.failed === 0, counts(ctx));
      ok("п'ять рядків із ключем і source ONE_C", rows.length === 5 && rows.every((r) => !!r.externalKey), rows.length);
      ok("міський — PHONE", byKind1C.get("Телефон контрагента")?.kind === "PHONE");
      ok("мобільний — MOBILE", byKind1C.get("Мобильный телефон контактного лица контрагента")?.kind === "MOBILE");
      ok("факс — OTHER", byKind1C.get("Факс контрагента")?.kind === "OTHER");
      ok(
        "valueNormalized у форматі E.164",
        byKind1C.get("Телефон контрагента")?.valueNormalized === "+380322451234" &&
          byKind1C.get("Мобильный телефон контактного лица контрагента")?.valueNormalized === MOBILE_E164
      );
      ok(
        "головні — «Телефон контрагента» і «Адрес доставки»",
        rows.filter((r) => r.isPrimary).map((r) => r.kind1C).sort().join(" | ") ===
          "Адрес доставки | Телефон контрагента",
        rows.filter((r) => r.isPrimary).map((r) => r.kind1C)
      );
      ok("порожній телефон картки заповнено з 1С", c.phone === LANDLINE, c.phone);
      ok("адреса — доставки, а не юридична", c.address === DELIVERY, c.address);
      ok("primaryPhoneE164 — мобільний, а не міський", c.primaryPhoneE164 === MOBILE_E164, c.primaryPhoneE164);
      ok("contactsSyncedAt проставлено", !!c.contactsSyncedAt);
    }

    console.log("\nПовторний ідентичний прогін (через диспетчер, у зворотному порядку) — жодного запису");
    {
      const beforeRows = await rowsOf(ids.a);
      const beforeCard = await card(ids.a);
      const ctx = ctxOf("full");
      await dispatchBatch(
        {
          runId: `${PREFIX}-run`,
          batchId: `${PREFIX}-batch`,
          seq: 1,
          entityType: "counterparty_contact",
          records: [rec(ext.a, base().reverse())],
        },
        ctx
      );
      const afterRows = await rowsOf(ids.a);
      const afterCard = await card(ids.a);
      const stamp = (rs: typeof beforeRows) => rs.map((r) => `${r.id}:${r.updatedAt.getTime()}`).sort().join(",");
      ok("пропущено", ctx.skipped === 1 && ctx.created + ctx.updated + ctx.failed === 0, counts(ctx));
      ok("рядки не переписані (updatedAt ті самі)", stamp(beforeRows) === stamp(afterRows));
      ok(
        "картка не переписана (updatedAt і contactsSyncedAt ті самі)",
        beforeCard.updatedAt.getTime() === afterCard.updatedAt.getTime() &&
          beforeCard.contactsSyncedAt?.getTime() === afterCard.contactsSyncedAt?.getTime()
      );
    }

    // Контакт, внесений на сайті: обмін його не бачить і не видаляє.
    await prisma.counterpartyContact.create({
      data: { counterpartyId: ids.a, kind: "MOBILE", value: "0991112233", valueNormalized: "+380991112233", source: "SITE" },
    });

    console.log("\nРядок зник у 1С (факс прибрали)");
    {
      const ctx = ctxOf();
      await applyCounterpartyContacts([rec(ext.a, base().filter((r) => r.kind1C !== "Факс контрагента"))], ctx);
      const rows = await rowsOf(ids.a);
      ok("оновлено", ctx.updated === 1 && ctx.failed === 0, counts(ctx));
      ok("факс видалено, решта лишилась", rows.length === 4 && !rows.some((r) => r.kind1C === "Факс контрагента"), rows.map((r) => r.kind1C));
      ok("SITE-рядок на місці", (await rowsOf(ids.a, "SITE")).length === 1);
    }

    console.log("\n1С змінила телефон, який на картці прийшов із 1С");
    {
      const ctx = ctxOf();
      const next = "(032) 299-00-00";
      await applyCounterpartyContacts(
        [rec(ext.a, base(next).filter((r) => r.kind1C !== "Факс контрагента"))],
        ctx
      );
      const c = await card(ids.a);
      const rows = await rowsOf(ids.a);
      ok("телефон картки замінено", c.phone === next, c.phone);
      ok("старий рядок замінено новим", rows.length === 4 && rows.some((r) => r.value === next) && !rows.some((r) => r.value === LANDLINE));
      ok("primaryPhoneE164 лишився мобільним", c.primaryPhoneE164 === MOBILE_E164, c.primaryPhoneE164);
    }

    console.log("\nЛюдина поправила телефон на сайті, а 1С змінила свій");
    {
      await prisma.counterparty.update({ where: { id: ids.a }, data: { phone: "0951234567" } });
      const onlyNext = "(032) 277-00-00";
      const contacts = base(onlyNext).filter((r) => r.kind1C !== "Факс контрагента");
      const ctx = ctxOf();
      await applyCounterpartyContacts([rec(ext.a, contacts)], ctx);
      const c = await card(ids.a);
      const conflict = ctx.discrepancies.find((d) => d.field === "CONTACT_CONFLICT");
      ok("правку людини не затерто", c.phone === "0951234567", c.phone);
      ok(
        "CONTACT_CONFLICT у журналі з обома значеннями",
        conflict?.value1C === `телефон: ${onlyNext}` && conflict?.valueBudvik === "телефон: 0951234567",
        ctx.discrepancies
      );
      ok("рядки 1С оновлено попри конфлікт", ctx.updated === 1, counts(ctx));

      const again = ctxOf();
      await applyCounterpartyContacts([rec(ext.a, contacts)], again);
      ok(
        "той самий конфлікт наступним прогоном — лише пропуск, без записів",
        again.skipped === 1 && again.updated === 0 && again.discrepancies.length === 1,
        counts(again)
      );
    }

    console.log("\nМобільний лише в полі телефону картки, у 1С рядків немає");
    {
      const ctx = ctxOf();
      await applyCounterpartyContacts([rec(ext.b, [])], ctx);
      const c = await card(ids.b);
      ok("primaryPhoneE164 узято з картки", c.primaryPhoneE164 === "+380931234567", c.primaryPhoneE164);
      ok("телефон картки не чіпали", c.phone === "0931234567 Оксана", c.phone);
      ok("рядків не з'явилось", (await rowsOf(ids.b)).length === 0);
    }

    console.log("\n1С прибрала всі контакти клієнта");
    {
      const ctx = ctxOf();
      await applyCounterpartyContacts([rec(ext.a, [])], ctx);
      const c = await card(ids.a);
      ok("усі ONE_C-рядки видалено", (await rowsOf(ids.a)).length === 0);
      ok("SITE-рядок лишився", (await rowsOf(ids.a, "SITE")).length === 1);
      ok("порожнє з 1С не стерло поля картки", c.phone === "0951234567" && c.address === DELIVERY, c);
      ok(
        "primaryPhoneE164 перейшов на мобільний із картки",
        c.primaryPhoneE164 === "+380951234567",
        c.primaryPhoneE164
      );
    }

    console.log("\nНевідомий контрагент");
    {
      const ctx = ctxOf();
      await applyCounterpartyContacts([rec(`${PREFIX}-nobody`, base())], ctx);
      ok("пропущено без записів", ctx.skipped === 1 && ctx.created + ctx.updated === 0, counts(ctx));
    }

    console.log("\nЗіпсований запис: contacts не масив");
    {
      await applyCounterpartyContacts([rec(ext.a, base())], ctxOf());
      const before = (await rowsOf(ids.a)).length;
      const ctx = ctxOf();
      await applyCounterpartyContacts([{ externalId: ext.a } as unknown as CounterpartyContactsRecord], ctx);
      ok("рахується як помилка", ctx.failed === 1, counts(ctx));
      ok("рядки не стерто", (await rowsOf(ids.a)).length === before && before === 5, { before });
    }

    console.log("\nPreview нічого не пише");
    {
      const ctx = ctxOf("preview");
      await applyCounterpartyContacts([rec(ext.c, base())], ctx);
      const c = await card(ids.c);
      ok("порахував як створення", ctx.created === 1, counts(ctx));
      ok("рядків немає", (await rowsOf(ids.c)).length === 0);
      ok("картка порожня", !c.phone && !c.address && !c.primaryPhoneE164 && !c.contactsSyncedAt, c);
    }
  } finally {
    const all = Object.values(ids);
    await prisma.counterpartyContact.deleteMany({ where: { counterpartyId: { in: all } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: all } } });
    await prisma.syncDiscrepancy.deleteMany({ where: { syncJobId: job.id } });
    await prisma.syncJob.delete({ where: { id: job.id } });
    console.log("\nТимчасові дані прибрано.");
  }

  console.log(failed ? `\n${failed} перевірок не зійшлося.` : "\nУсе зійшлося.");
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

await main();
