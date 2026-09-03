/**
 * Контрагенти з 1С і сальдо взаєморозрахунків.
 *
 * Драбина зіставлення: externalId → code (код 1С) → назва. Як і з товарами,
 * перший збіг дозаписує externalId і надалі контрагент прив'язаний до GUID.
 *
 * Поля доставки (deliveryAddress, координати, contactPerson) — власність сайту:
 * їх заповнює логістика, і 1С про них нічого не знає. Синхронізація їх не чіпає.
 */

import { prisma } from "@/lib/prisma";
import type { CounterpartyType } from "@prisma/client";
import type { CounterpartyRecord, DebtRecord } from "./types";
import { ApplyContext } from "./context";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";

/**
 * Тип контрагента з прапорців «Поставщик» / «Покупатель» довідника 1С.
 *
 * null означає «нема чого сказати»: або агент старий і прапорців не шле,
 * або в 1С не позначено жодного — і тоді тип на сайті чіпати не можна.
 */
function deriveType(rec: CounterpartyRecord): CounterpartyType | null {
  if (rec.isSupplier === undefined && rec.isCustomer === undefined) return null;
  if (rec.isSupplier && rec.isCustomer) return "BOTH";
  if (rec.isSupplier) return "SUPPLIER";
  if (rec.isCustomer) return "CUSTOMER";
  return null;
}

export async function applyCounterparties(
  records: CounterpartyRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  const codes = records.map((r) => r.code).filter((c): c is string => !!c);
  const names = records.map((r) => r.name.toLowerCase());

  const candidates = await prisma.counterparty.findMany({
    where: {
      OR: [
        { externalId: { in: records.map((r) => r.externalId) } },
        ...(codes.length > 0 ? [{ code: { in: codes } }] : []),
        { name: { in: names, mode: "insensitive" as const } },
      ],
    },
    select: {
      id: true,
      externalId: true,
      code: true,
      name: true,
      type: true,
      phone: true,
      email: true,
      address: true,
    },
  });

  const byExternalId = new Map(
    candidates.filter((c) => c.externalId).map((c) => [c.externalId!, c])
  );
  const byCode = new Map(candidates.filter((c) => c.code).map((c) => [c.code!, c]));
  const byName = new Map(candidates.map((c) => [c.name.toLowerCase(), c]));

  const takenCodes = new Set(candidates.filter((c) => c.code).map((c) => c.code!));

  for (const rec of records) {
    if (!rec.name?.trim()) {
      ctx.skipped++;
      continue;
    }

    const existing =
      byExternalId.get(rec.externalId) ||
      (rec.code ? byCode.get(rec.code) : undefined) ||
      byName.get(rec.name.toLowerCase());

    // Контрагента, поміченого на видалення, не чіпаємо: за ним можуть висіти
    // борг і документи, і рішення тут за адміністратором. Повтор тієї самої
    // позначки відсіється при записі журналу.
    if (rec.deleted) {
      if (existing) {
        ctx.discrepancy({
          entityType: "counterparty",
          entityRef: existing.code || rec.externalId,
          entityName: rec.name,
          field: "DELETED_IN_1C",
          value1C: "помічено на видалення",
          valueBudvik: "активний на сайті",
        });
      }
      ctx.skipped++;
      continue;
    }

    // --- Новий контрагент ---
    if (!existing) {
      if (ctx.isPreview) {
        ctx.created++;
        ctx.discrepancy({
          entityType: "counterparty",
          entityRef: rec.code || rec.externalId,
          entityName: rec.name,
          field: "NEW",
          value1C: rec.name,
          valueBudvik: "не існує",
        });
        continue;
      }

      // Код 1С унікальний у схемі: якщо він уже зайнятий іншим контрагентом,
      // краще створити без коду, ніж завалити весь батч.
      const code = rec.code && !takenCodes.has(rec.code) ? rec.code : null;
      if (code) takenCodes.add(code);

      try {
        const created = await prisma.counterparty.create({
          data: {
            externalId: rec.externalId,
            name: rec.name,
            code,
            type: deriveType(rec) ?? (rec.type as CounterpartyType) ?? "BOTH",
            phone: rec.phone || null,
            email: rec.email || null,
            address: rec.address || null,
          },
          select: {
            id: true,
            externalId: true,
            code: true,
            name: true,
            type: true,
            phone: true,
            email: true,
            address: true,
          },
        });
        byExternalId.set(rec.externalId, created);
        ctx.created++;
      } catch (e) {
        ctx.fail(rec.name, e);
      }
      continue;
    }

    // --- Наявний контрагент ---
    const updates: Record<string, unknown> = {};

    if (!existing.externalId) updates.externalId = rec.externalId;
    if (!existing.code && rec.code && !takenCodes.has(rec.code)) {
      updates.code = rec.code;
      takenCodes.add(rec.code);
    }
    if (rec.name !== existing.name) updates.name = rec.name;

    // Тип оновлюємо ЛИШЕ за явними прапорцями нового агента.
    //
    // Колись тип брався з поля `type`, яке агент виводив сам, і поки в його
    // запиті не було колонки «Поставщик», на її місці читалась позначка
    // видалення: шість помічених на видалення карток встигли стати
    // постачальниками, перш ніж це спіймали. Тому тепер рішення ухвалює
    // сервер, і тільки коли обидва прапорці справді приїхали — їхня
    // ВІДСУТНІСТЬ означає старого агента, і тоді тип лишається як був.
    const derived = deriveType(rec);
    if (derived && derived !== existing.type) updates.type = derived;

    // Контакти лише доповнюємо: порожнє значення з 1С не має стирати те,
    // що менеджер вніс вручну.
    if (rec.phone?.trim() && !existing.phone) updates.phone = rec.phone.trim();
    if (rec.email?.trim() && !existing.email) updates.email = rec.email.trim();
    if (rec.address?.trim() && !existing.address) updates.address = rec.address.trim();

    if (Object.keys(updates).length === 0) {
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      ctx.updated++;
      continue;
    }

    try {
      await prisma.counterparty.update({ where: { id: existing.id }, data: updates });
      ctx.updated++;
    } catch (e) {
      ctx.fail(rec.name, e);
    }
  }
}

/** Сальдо дебіторки по контрагентах. Пише лише довідкові поля. */
export async function applyDebts(records: DebtRecord[], ctx: ApplyContext): Promise<void> {
  if (records.length === 0) return;

  const externalIds = records.map((r) => r.externalId);

  const counterparties = await prisma.counterparty.findMany({
    where: { externalId: { in: externalIds } },
    select: { id: true, externalId: true, code: true, name: true, receivableBalance: true },
  });
  const byExternalId = new Map(counterparties.map((c) => [c.externalId!, c]));

  // Позначка «сальдо підтверджене 1С у цьому прогоні» — ДО циклу й одним
  // запитом на всіх, кого приніс батч. На ній тримається звірка зниклих
  // боргів (reconcile-debts.ts): регістр 1С віддає лише ненульові сальдо,
  // тож розрахований клієнт просто зникає з каналу, і відрізнити його від
  // живого боржника можна лише за свіжістю цієї мітки.
  //
  // Чому до циклу: виняток на середині лишив би частину підтверджених без
  // мітки, і звірка обнулила б їм живий борг.
  //
  // Чому now() бази, а не new Date(): відсічка звірки береться з
  // SyncBatch.createdAt, тобто теж із годинника Postgres. Обробник живе у
  // двох середовищах (воркер Railway і функції Vercel), і відставання
  // їхнього годинника зробило б щойно проставлену мітку «застарілою».
  if (!ctx.isPreview) {
    await prisma.$executeRaw`
      UPDATE "Counterparty" SET "balanceSyncedAt" = now()
      WHERE "externalId" = ANY(${externalIds}::text[])
    `;
  }

  for (const rec of records) {
    const cp = byExternalId.get(rec.externalId);
    if (!cp) {
      ctx.skipped++;
      continue;
    }

    const balance = Number.isFinite(rec.balance) ? rec.balance : 0;
    const aging = normalizeAging(rec, balance, cp.name, ctx);

    // Розбивка приходить не завжди, тож пропускати запис лише через
    // незмінне сальдо не можна: борг той самий, а строки могли поїхати.
    if (!aging && Math.abs((cp.receivableBalance ?? 0) - balance) < 0.01) {
      ctx.skipped++;
      continue;
    }

    ctx.discrepancy({
      entityType: "counterparty",
      entityRef: cp.code || rec.externalId,
      entityName: cp.name,
      field: "receivableBalance",
      value1C: balance.toFixed(2),
      valueBudvik: (cp.receivableBalance ?? 0).toFixed(2),
    });

    if (ctx.isPreview) {
      ctx.updated++;
      continue;
    }

    try {
      await prisma.counterparty.update({
        where: { id: cp.id },
        data: {
          receivableBalance: balance,
          // balanceSyncedAt тут не чіпаємо: мітку вже поставив запит на
          // початку батча, і саме годинником бази — див. коментар вище.
          ...(aging
            ? {
                debtCurrent: aging.current,
                debtOverdue30: aging.overdue30,
                debtOverdue60: aging.overdue60,
                debtOverdue90: aging.overdue90,
                debtOverdue90Plus: aging.overdue90plus,
                debtAgingSyncedAt: new Date(),
              }
            : {}),
        },
      });

      // Знімок на добу: без історії сальдо не порахувати приріст боргу за
      // місяць, а на ньому будується зарплата. Обмін іде раз на день, тож
      // повторний прогін просто перезаписує сьогоднішній рядок.
      const day = kyivDayStart(kyivDate(new Date()));
      await prisma.debtSnapshot.upsert({
        where: { counterpartyId_day: { counterpartyId: cp.id, day } },
        create: {
          counterpartyId: cp.id,
          day,
          balance,
          current: aging?.current ?? null,
          overdue30: aging?.overdue30 ?? null,
          overdue60: aging?.overdue60 ?? null,
          overdue90: aging?.overdue90 ?? null,
          overdue90Plus: aging?.overdue90plus ?? null,
        },
        update: {
          balance,
          ...(aging
            ? {
                current: aging.current,
                overdue30: aging.overdue30,
                overdue60: aging.overdue60,
                overdue90: aging.overdue90,
                overdue90Plus: aging.overdue90plus,
              }
            : {}),
        },
      });

      ctx.updated++;
    } catch (e) {
      ctx.fail(cp.name, e);
    }
  }
}

type NormalizedAging = {
  current: number;
  overdue30: number;
  overdue60: number;
  overdue90: number;
  overdue90plus: number;
};

/**
 * Розбивка боргу за строками, якщо 1С її прислала.
 *
 * Сума розбивки має сходитися із сальдо. Коли не сходиться — довіряємо
 * сальдо (це головне число, воно приходить з іншого регістру) і пишемо
 * розбіжність у журнал: мовчки підганяти цифри не можна, бо на них
 * рахується зарплата.
 */
function normalizeAging(
  rec: DebtRecord,
  balance: number,
  cpName: string,
  ctx: ApplyContext
): NormalizedAging | null {
  if (!rec.aging) return null;

  const n = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);
  const aging: NormalizedAging = {
    current: n(rec.aging.current),
    overdue30: n(rec.aging.overdue30),
    overdue60: n(rec.aging.overdue60),
    overdue90: n(rec.aging.overdue90),
    overdue90plus: n(rec.aging.overdue90plus),
  };

  const sum = Object.values(aging).reduce((s, v) => s + v, 0);
  if (Math.abs(sum - balance) > 1) {
    ctx.discrepancy({
      entityType: "counterparty",
      entityRef: rec.externalId,
      entityName: cpName,
      field: "debtAging",
      value1C: `розбивка ${sum.toFixed(2)}`,
      valueBudvik: `сальдо ${balance.toFixed(2)}`,
    });
  }

  return aging;
}
