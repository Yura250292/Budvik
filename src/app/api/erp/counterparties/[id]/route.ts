import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CONSENT_SOURCES, MARKETING_CONSENTS, PREFERRED_CHANNELS } from "@/lib/outreach/types";

const CONSENT_KEYS: readonly string[] = MARKETING_CONSENTS.map((c) => c.key);
const CHANNEL_KEYS: readonly string[] = PREFERRED_CHANNELS.map((c) => c.key);
const SOURCE_KEYS: readonly string[] = CONSENT_SOURCES;

/** "" і null з форми — «не вказано»; решта рядків обрізається. */
function optionalText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const counterparty = await prisma.counterparty.findUnique({
    where: { id },
    include: {
      supplierProducts: {
        include: { product: { select: { id: true, name: true, sku: true, price: true } } },
      },
      _count: {
        select: {
          purchaseOrders: true,
          salesDocuments: true,
          invoices: true,
        },
      },
    },
  });

  if (!counterparty) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  return NextResponse.json(counterparty);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, code, type, phone, email, address, deliveryAddress, deliveryLat, deliveryLng, contactPerson, notes, isActive } = body;
  const { isInternal, internalReason, marketingConsent, marketingConsentSource, preferredChannel } = body;

  if (isInternal !== undefined && typeof isInternal !== "boolean") {
    return NextResponse.json({ error: "isInternal має бути так/ні" }, { status: 400 });
  }
  if (marketingConsent !== undefined && !CONSENT_KEYS.includes(marketingConsent)) {
    return NextResponse.json({ error: "Невідомий стан згоди" }, { status: 400 });
  }
  const consentSource = optionalText(marketingConsentSource);
  if (consentSource !== null && !SOURCE_KEYS.includes(consentSource)) {
    return NextResponse.json({ error: "Невідоме джерело згоди" }, { status: 400 });
  }
  const channel = optionalText(preferredChannel);
  if (channel !== null && !CHANNEL_KEYS.includes(channel)) {
    return NextResponse.json({ error: "Невідомий канал зв'язку" }, { status: 400 });
  }

  const extra = await internalAndConsentData(id, session.user.id, {
    isInternal,
    internalReason,
    marketingConsent,
    marketingConsentSource,
    consentSource,
  });
  if (extra === null) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  if (code) {
    const existing = await prisma.counterparty.findUnique({ where: { code } });
    if (existing && existing.id !== id) {
      return NextResponse.json({ error: "Контрагент з таким кодом вже існує" }, { status: 400 });
    }
  }

  const counterparty = await prisma.counterparty.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code: code || null }),
      ...(type !== undefined && { type }),
      ...(phone !== undefined && { phone: phone || null }),
      ...(email !== undefined && { email: email || null }),
      ...(address !== undefined && { address: address || null }),
      ...(deliveryAddress !== undefined && { deliveryAddress: deliveryAddress || null }),
      ...(deliveryLat !== undefined && { deliveryLat: deliveryLat || null }),
      ...(deliveryLng !== undefined && { deliveryLng: deliveryLng || null }),
      ...(contactPerson !== undefined && { contactPerson: contactPerson || null }),
      ...(notes !== undefined && { notes: notes || null }),
      ...(isActive !== undefined && { isActive }),
      ...(preferredChannel !== undefined && { preferredChannel: channel }),
      ...extra,
    },
  });

  return NextResponse.json(counterparty);
}

/**
 * Ознака «свій» і згода на повідомлення — з побічними полями, які ставить
 * сервер, а не форма.
 *
 * Мітки (хто й коли) пишуться лише при СПРАВЖНІЙ зміні стану. Форма шле
 * весь стан картки на кожне збереження, і без порівняння з базою правка
 * телефону переставляла б «коли дано згоду» на сьогодні — а саме ця дата
 * і є доказом згоди.
 *
 * null — картки немає (відповідь 404).
 */
async function internalAndConsentData(
  id: string,
  userId: string,
  input: {
    isInternal: unknown;
    internalReason: unknown;
    marketingConsent: unknown;
    marketingConsentSource: unknown;
    consentSource: string | null;
  }
): Promise<Prisma.CounterpartyUpdateInput | null> {
  const touches =
    input.isInternal !== undefined ||
    input.internalReason !== undefined ||
    input.marketingConsent !== undefined ||
    input.marketingConsentSource !== undefined;
  if (!touches) return {};

  const current = await prisma.counterparty.findUnique({
    where: { id },
    select: { isInternal: true, internalReason: true, marketingConsent: true },
  });
  if (!current) return null;

  const now = new Date();
  const data: Prisma.CounterpartyUpdateInput = {};

  // ── Свій, а не клієнт ──
  //
  // Причина з форми приходить завжди, зокрема стара («name-marker»,
  // «staff:<id>»). При перемиканні вона йде в базу, лише якщо людина її
  // змінила: інакше зняття ознаки лишало б «staff:…» як причину картці, яка
  // вже НЕ свій. Мітки internalSetAt/ById ставимо і при знятті — «людина
  // вирішила, що це клієнт» теж рішення, яке треба вміти знайти.
  const reason = input.internalReason === undefined ? undefined : optionalText(input.internalReason);
  if (typeof input.isInternal === "boolean" && input.isInternal !== current.isInternal) {
    const changedReason = reason !== undefined && reason !== current.internalReason ? reason : null;
    data.isInternal = input.isInternal;
    data.internalReason = changedReason ?? (input.isInternal ? "manual" : null);
    data.internalSetAt = now;
    data.internalSetById = userId;
  } else if (reason !== undefined && reason !== current.internalReason && current.isInternal) {
    data.internalReason = reason;
  }

  // ── Згода на рекламні повідомлення ──
  //
  // Джерело згоди НЕ вгадуємо. PATCH доступний лише ADMIN, тобто картку
  // правлять в офісі, а жодне з наявних джерел офісу не описує:
  //   REP    приписав би згоду торговому, який її не збирав (і збрехав би в
  //          будь-якій статистиці «скільки згод зібрав торговий»);
  //   SITE / BOT  стверджували б, що клієнт дав згоду САМ — найсильніший
  //          доказ, і саме тому найгірша неправда в записі про згоду;
  //   IMPORT означав би масове завантаження без людини, яка ручається.
  // Тому джерело — те, що людина явно обрала у формі («торговий переказав»,
  // «клієнт написав у бот»), а якщо не обрала — OFFICE: «внесли в офісі,
  // канал не названо». Хто саме вніс, зберігає marketingConsentById.
  if (typeof input.marketingConsent === "string" && input.marketingConsent !== current.marketingConsent) {
    data.marketingConsent = input.marketingConsent;
    if (input.marketingConsent === "UNKNOWN") {
      // Повернення до «не питали» — виправлення помилки введення, а не нова
      // згода: мітки згоди стираємо. Відписку (marketingOptOutAt) НЕ
      // стираємо: слід «просив не писати» знімає лише явна нова згода.
      data.marketingConsentAt = null;
      data.marketingConsentSource = null;
      data.marketingConsentById = null;
    } else {
      data.marketingConsentAt = now;
      data.marketingConsentById = userId;
      data.marketingConsentSource = input.consentSource ?? "OFFICE";
      // Відмова — це й відписка: автоматика дивиться на marketingOptOutAt.
      // Нова згода після відписки її знімає — клієнт передумав.
      data.marketingOptOutAt = input.marketingConsent === "REFUSED" ? now : null;
    }
  } else if (input.marketingConsentSource !== undefined && current.marketingConsent !== "UNKNOWN") {
    // Уточнили лише канал уже записаної згоди: дата й автор лишаються.
    data.marketingConsentSource = input.consentSource ?? "OFFICE";
  }

  return data;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Check if counterparty has any documents
  const counts = await prisma.counterparty.findUnique({
    where: { id },
    include: {
      _count: {
        select: { purchaseOrders: true, salesDocuments: true, invoices: true },
      },
    },
  });

  if (!counts) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  const total = counts._count.purchaseOrders + counts._count.salesDocuments + counts._count.invoices;
  if (total > 0) {
    return NextResponse.json(
      { error: "Неможливо видалити контрагента з документами. Деактивуйте замість цього." },
      { status: 400 }
    );
  }

  await prisma.counterparty.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
