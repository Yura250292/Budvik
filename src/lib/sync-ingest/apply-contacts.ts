/**
 * Контакти клієнтів із регістру 1С «КонтактнаяИнформация» (канал
 * counterparty_contact) → CounterpartyContact і поля картки контрагента.
 *
 * Навіщо окремий канал. У довіднику контрагентів телефонів і адрес немає
 * взагалі — вони живуть у регістрі. Досі звідти був лише одноразовий імпорт
 * 25.08 (scripts/import-contacts-1c.mjs), тож новий клієнт приходив на сайт
 * без номера, а змінений у 1С телефон на сайт не доїжджав ніколи.
 *
 * Правила злиття:
 *
 *  - Рядки з source = 'ONE_C' — дзеркало 1С: зниклий у 1С рядок видаляється,
 *    новий створюється, змінений оновлюється. Рядки, внесені на сайті
 *    (source = 'SITE'), обмін не бачить і не чіпає.
 *
 *  - Спершу звірка, потім запис. Канал — повний зріз на 3 700 контрагентів, і
 *    переписувати його щоразу означало б десятки тисяч зайвих рядків на добу
 *    заради одиниць змін (так уже було з документами — див.
 *    document-unchanged.ts). Незмінений контрагент не отримує жодного запису.
 *
 *  - phone / email / address на картці: 1С пише в поле, коли воно порожнє
 *    або коли поточне значення саме прийшло з 1С (збігається з одним із
 *    ПОПЕРЕДНІХ 1С-рядків). Інакше це правка людини — її не затираємо, а
 *    пишемо CONTACT_CONFLICT у журнал. Порожнє з 1С поле не стирає: так само
 *    вирішено в apply-counterparties.ts.
 *
 *  - primaryPhoneE164 — номер для Viber/SMS: перший український мобільний у
 *    порядку PHONE_KIND_PRIORITY, а якщо в 1С мобільного немає — мобільний
 *    із поля телефону картки (його могла вписати людина).
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { primaryMobileE164 } from "@/lib/phone";
import {
  classifyContactKind,
  contactClassOf,
  contactCompareKey,
  contactExternalKey,
  normalizeContactValue,
  priorityFor,
  sortByPriority,
  type ContactClass,
} from "@/lib/contacts/kinds";
import type { CounterpartyContactsRecord } from "./types";
import { ApplyContext } from "./context";

const SOURCE_1C = "ONE_C";

/**
 * Як часто оновлювати contactsSyncedAt у контрагента, в якого нічого не
 * змінилось.
 *
 * Мітка каже «1С підтвердила контакти», а не «щойно переписали». Штампувати
 * її кожним прогоном — це 3 700 переписаних рядків Counterparty за кожне
 * вікно каналу без жодної зміни, тобто рівно те, від чого береже звірка.
 * Раз на добу досить, щоб відрізнити живий канал від мертвого.
 */
const STAMP_REFRESH_MS = 20 * 60 * 60_000;

/** Поле картки, у яке лягає головний контакт класу. */
const CARD_FIELDS: { cls: ContactClass; field: "phone" | "email" | "address"; label: string }[] = [
  { cls: "PHONE", field: "phone", label: "телефон" },
  { cls: "EMAIL", field: "email", label: "email" },
  { cls: "ADDRESS", field: "address", label: "адреса" },
];

type DesiredRow = {
  externalKey: string;
  kind: string;
  kind1C: string | null;
  type1C: string | null;
  value: string;
  valueNormalized: string | null;
  personExternalId: string | null;
  personName: string | null;
  ordinal: number;
  isPrimary: boolean;
};

const storedSelect = {
  id: true,
  counterpartyId: true,
  externalKey: true,
  kind: true,
  kind1C: true,
  type1C: true,
  value: true,
  valueNormalized: true,
  personExternalId: true,
  personName: true,
  ordinal: true,
  isPrimary: true,
} satisfies Prisma.CounterpartyContactSelect;

type StoredRow = Prisma.CounterpartyContactGetPayload<{ select: typeof storedSelect }>;

/** Рядки 1С → бажаний набір з видами, ключами й позначками головних. */
function buildDesired(rec: CounterpartyContactsRecord): DesiredRow[] {
  const byKey = new Map<string, DesiredRow>();

  rec.contacts.forEach((c, i) => {
    if (!c || typeof c.value !== "string") return;
    const value = c.value.trim();
    if (!value) return;
    const kind1C = typeof c.kind1C === "string" ? c.kind1C.trim() || null : null;
    const type1C = typeof c.type1C === "string" ? c.type1C.trim() || null : null;
    const personExternalId =
      typeof c.personExternalId === "string" ? c.personExternalId.trim() || null : null;
    const externalKey = contactExternalKey(rec.externalId, personExternalId, kind1C, value);

    // Той самий вид із тим самим значенням двічі (два записи довідника видів
    // з однаковою назвою) — для людини це один контакт, а унікальний індекс
    // другий рядок не пропустив би й завалив би весь запис.
    if (byKey.has(externalKey)) return;

    const kind = classifyContactKind(kind1C, type1C, value);
    byKey.set(externalKey, {
      externalKey,
      kind,
      kind1C,
      type1C,
      value,
      valueNormalized: normalizeContactValue(kind, value),
      personExternalId,
      personName: typeof c.personName === "string" ? c.personName.trim() || null : null,
      ordinal: Number.isFinite(c.ordinal) ? Math.trunc(c.ordinal) : i,
      isPrimary: false,
    });
  });

  const rows = [...byKey.values()];
  for (const { cls } of CARD_FIELDS) {
    const top = topOfClass(rows, cls);
    if (top) top.isPrimary = true;
  }
  return rows;
}

function topOfClass<T extends { kind: string; kind1C: string | null; ordinal: number | null; value: string }>(
  rows: readonly T[],
  cls: ContactClass
): T | null {
  const ofClass = rows.filter((r) => contactClassOf(r.kind) === cls);
  return sortByPriority(ofClass, priorityFor(cls))[0] ?? null;
}

/** Перший український мобільний у порядку пріоритету телефонних видів. */
function firstMobile(rows: readonly DesiredRow[]): string | null {
  const phones = sortByPriority(
    rows.filter((r) => contactClassOf(r.kind) === "PHONE"),
    priorityFor("PHONE")
  );
  for (const r of phones) {
    const m = primaryMobileE164(r.value);
    if (m) return m;
  }
  return null;
}

function rowChanged(s: StoredRow, d: DesiredRow): boolean {
  return (
    s.kind !== d.kind ||
    (s.kind1C ?? null) !== d.kind1C ||
    (s.type1C ?? null) !== d.type1C ||
    s.value !== d.value ||
    (s.valueNormalized ?? null) !== d.valueNormalized ||
    (s.personExternalId ?? null) !== d.personExternalId ||
    (s.personName ?? null) !== d.personName ||
    (s.ordinal ?? null) !== d.ordinal ||
    s.isPrimary !== d.isPrimary
  );
}

function rowData(d: DesiredRow) {
  return {
    kind: d.kind,
    kind1C: d.kind1C,
    type1C: d.type1C,
    value: d.value,
    valueNormalized: d.valueNormalized,
    personExternalId: d.personExternalId,
    personName: d.personName,
    ordinal: d.ordinal,
    isPrimary: d.isPrimary,
  };
}

export async function applyCounterpartyContacts(
  records: CounterpartyContactsRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  const externalIds = records.map((r) => r.externalId).filter((id): id is string => !!id);
  const counterparties = await prisma.counterparty.findMany({
    where: { externalId: { in: externalIds } },
    select: {
      id: true,
      externalId: true,
      code: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      primaryPhoneE164: true,
      contactsSyncedAt: true,
    },
  });
  const byExternalId = new Map(counterparties.map((c) => [c.externalId!, c]));

  const stored = await prisma.counterpartyContact.findMany({
    where: { counterpartyId: { in: counterparties.map((c) => c.id) }, source: SOURCE_1C },
    select: storedSelect,
  });
  const storedByCp = new Map<string, StoredRow[]>();
  for (const s of stored) {
    const list = storedByCp.get(s.counterpartyId) ?? [];
    list.push(s);
    storedByCp.set(s.counterpartyId, list);
  }

  const staleStamp: string[] = [];
  const now = new Date();

  for (const rec of records) {
    const cp = rec.externalId ? byExternalId.get(rec.externalId) : undefined;
    // Невідомий контрагент: канал counterparty іде раніше в тому самому
    // прогоні, тож це або безіменна картка, яку той пропустив, або щойно
    // створена в 1С — наступний прогін її вже знатиме.
    if (!cp) {
      ctx.skipped++;
      continue;
    }

    // Запис без масиву — зіпсований, а не «контактів немає». Прочитати його
    // як порожній набір означало б стерти всі 1С-рядки клієнта.
    if (!Array.isArray(rec.contacts)) {
      ctx.fail(cp.name, new Error("contacts не масив — запис пропущено"));
      continue;
    }

    try {
      const desired = buildDesired(rec);
      const previous = storedByCp.get(cp.id) ?? [];

      // --- рядки ---
      const previousByKey = new Map(
        previous.filter((s) => s.externalKey).map((s) => [s.externalKey!, s])
      );
      const desiredKeys = new Set(desired.map((d) => d.externalKey));
      const toDelete = previous.filter((s) => !s.externalKey || !desiredKeys.has(s.externalKey));
      const toCreate = desired.filter((d) => !previousByKey.has(d.externalKey));
      const toUpdate = desired
        .map((d) => ({ d, s: previousByKey.get(d.externalKey) }))
        .filter((x): x is { d: DesiredRow; s: StoredRow } => !!x.s && rowChanged(x.s, x.d));

      // --- поля картки ---
      const cardData: Prisma.CounterpartyUpdateInput = {};
      const next = { phone: cp.phone, email: cp.email, address: cp.address };

      for (const { cls, field, label } of CARD_FIELDS) {
        const top = topOfClass(desired, cls);
        // 1С прибрала контакт — поле не чистимо: порожнє з 1С не стирає.
        if (!top) continue;

        const current = cp[field]?.trim() ?? "";
        const candidateKey = contactCompareKey(cls, top.value);
        const currentKey = contactCompareKey(cls, current);
        if (current && currentKey === candidateKey) continue;

        const from1C = previous.some(
          (s) => contactClassOf(s.kind) === cls && contactCompareKey(cls, s.value) === currentKey
        );
        if (!current || from1C) {
          cardData[field] = top.value;
          next[field] = top.value;
        } else {
          ctx.discrepancy({
            entityType: "counterparty",
            entityRef: cp.code || cp.externalId!,
            entityName: cp.name,
            field: "CONTACT_CONFLICT",
            value1C: `${label}: ${top.value}`,
            valueBudvik: `${label}: ${current}`,
          });
        }
      }

      // Мобільний, що колись уже був виведений обміном (з 1С-рядка чи з поля
      // телефону). Лише такий ми маємо право замінити або прибрати: інше
      // значення поставила людина чи окремий скрипт, і воно лишається.
      const derivedBefore = new Set<string>();
      for (const s of previous) {
        if (contactClassOf(s.kind) !== "PHONE") continue;
        const m = primaryMobileE164(s.value);
        if (m) derivedBefore.add(m);
      }
      const phoneBefore = primaryMobileE164(cp.phone);
      if (phoneBefore) derivedBefore.add(phoneBefore);

      const mobile = firstMobile(desired) ?? primaryMobileE164(next.phone);
      const currentMobile = cp.primaryPhoneE164 ?? null;
      if (mobile !== currentMobile) {
        if (!currentMobile || derivedBefore.has(currentMobile)) {
          cardData.primaryPhoneE164 = mobile;
        } else if (mobile) {
          ctx.discrepancy({
            entityType: "counterparty",
            entityRef: cp.code || cp.externalId!,
            entityName: cp.name,
            field: "CONTACT_CONFLICT",
            value1C: `мобільний: ${mobile}`,
            valueBudvik: `мобільний: ${currentMobile}`,
          });
        }
      }

      const rowsChanged = toDelete.length + toCreate.length + toUpdate.length > 0;
      const cardChanged = Object.keys(cardData).length > 0;

      if (!rowsChanged && !cardChanged) {
        ctx.skipped++;
        const last = cp.contactsSyncedAt?.getTime() ?? 0;
        if (!ctx.isPreview && now.getTime() - last >= STAMP_REFRESH_MS) staleStamp.push(cp.id);
        continue;
      }

      // «Створено» — коли в клієнта з'явились перші 1С-рядки; усе інше (зміна
      // рядків чи лише картки) — оновлення. Лічильник на контрагента, як і в
      // решті каналів, а не на рядок.
      const isCreate = previous.length === 0 && toCreate.length > 0;
      if (ctx.isPreview) {
        if (isCreate) ctx.created++;
        else ctx.updated++;
        continue;
      }

      const ops: Prisma.PrismaPromise<unknown>[] = [];
      if (toDelete.length) {
        ops.push(
          prisma.counterpartyContact.deleteMany({
            where: { id: { in: toDelete.map((s) => s.id) }, source: SOURCE_1C },
          })
        );
      }
      if (toCreate.length) {
        ops.push(
          prisma.counterpartyContact.createMany({
            data: toCreate.map((d) => ({
              ...rowData(d),
              counterpartyId: cp.id,
              externalKey: d.externalKey,
              source: SOURCE_1C,
              syncedAt: now,
            })),
          })
        );
      }
      for (const { d, s } of toUpdate) {
        ops.push(
          prisma.counterpartyContact.update({
            where: { id: s.id },
            data: { ...rowData(d), syncedAt: now },
          })
        );
      }
      if (cardChanged) {
        ops.push(
          prisma.counterparty.update({
            where: { id: cp.id },
            data: { ...cardData, contactsSyncedAt: now },
          })
        );
      } else {
        // Змінились лише рядки: мітку ставимо без update(), щоб не посунути
        // Counterparty.updatedAt — картку ніхто не редагував.
        ops.push(
          prisma.$executeRaw`UPDATE "Counterparty" SET "contactsSyncedAt" = ${now} WHERE "id" = ${cp.id}`
        );
      }

      // Рядки й поля картки — одним рухом: інакше збій посередині лишив би
      // новий номер у контактах і старий на картці, і наступна звірка
      // прийняла б старий за правку людини.
      await prisma.$transaction(ops);

      if (isCreate) ctx.created++;
      else ctx.updated++;
    } catch (e) {
      ctx.fail(cp.name, e);
    }
  }

  // Підтвердження для незмінених — одним запитом на батч і не частіше разу
  // на добу (див. STAMP_REFRESH_MS). Сирий SQL, щоб не посунути updatedAt.
  if (staleStamp.length > 0) {
    await prisma.$executeRaw`
      UPDATE "Counterparty" SET "contactsSyncedAt" = now()
      WHERE "id" = ANY(${staleStamp}::text[])
    `;
  }
}
