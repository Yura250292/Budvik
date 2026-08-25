import { NextRequest, NextResponse } from "next/server";
import { agingByCounterparty } from "@/lib/analytics/money-facts";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Скільки контрагентів віддаємо, якщо клієнт не попросив інакше.
 *
 * 1000 покриває наявні 3.7 тис. записів лише частково — і це свідомо: селекти
 * в UI шукають по вже завантаженому списку, тож повний дамп бази туди не
 * потрібен, а 2.6 МБ на кожне відкриття форми — потрібні ще менше.
 */
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type"); // SUPPLIER, CUSTOMER, BOTH
  const search = searchParams.get("search");
  const active = searchParams.get("active");

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (active !== null) where.isActive = active !== "false";

  // Умови збираємо в AND, а не пишемо два where.OR поспіль: другий
  // перетер би перший. Саме так тут і був витік — пошук знімав би скоуп
  // ролі, і торговий бачив би всю базу контрагентів за будь-яким запитом.
  const and: Record<string, unknown>[] = [];

  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { contactPerson: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  /**
   * Портфель торгового — тепер фільтр на вимогу (`mine=1`), а не тиха стеля.
   *
   * Обидва джерела портфеля дірчасті: `SalesRepClient` заповнюється
   * керівником вручну (504 записи на 3.6 тис. контрагентів), а прив'язка
   * документів іде зіставленням імені з 1С (див. sync-ingest/apply-documents)
   * і теж не стовідсоткова. Поки фільтр стояв завжди, торговий на новій
   * території не бачив у базі нікого — включно з клієнтом, до якого його
   * щойно відправили. Тепер вибірку звужує той, кому це потрібно.
   */
  if (session.user.role === "SALES" && searchParams.get("mine") === "1") {
    and.push({
      OR: [
        { assignedSalesReps: { some: { salesRepId: session.user.id } } },
        { salesDocuments: { some: { salesRepId: session.user.id } } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;

  // Обмеження вибірки. Відповідь лишається МАСИВОМ — її читають десяток
  // селектів контрагентів (erp/sales, erp/invoices, purchase-orders, sales/new
  // тощо), і обгортка в { items, total } зламала б їх усі.
  //
  // За замовчуванням стеля висока: без limit цей маршрут віддавав 3 689
  // контрагентів і 2.6 МБ. Клієнти, яким треба підказка пошуку, вже шлють
  // limit (client-folders шле limit=15 — його досі просто ігнорували).
  const limitParam = Number(searchParams.get("limit"));
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const counterparties = await prisma.counterparty.findMany({
    where,
    orderBy: { name: "asc" },
    take,
    include: {
      _count: {
        select: {
          purchaseOrders: true,
          salesDocuments: true,
          invoices: true,
        },
      },
    },
  });

  // Прострочка рахується тут, а не в браузері з полів debtOverdue*: 1С
  // розбивку за строками не надсилає, і ті поля порожні у ВСІХ контрагентів,
  // тож список клієнтів показував прострочку нулем — тоді як аналітика
  // рахувала її з дат відвантажень і давала зовсім інше число.
  const aging = await agingByCounterparty(counterparties.map((c) => c.id));

  return NextResponse.json(
    counterparties.map((c) => ({ ...c, overdue: aging.get(c.id)?.overdue ?? 0 }))
  );
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, code, type, phone, email, address, deliveryAddress, deliveryLat, deliveryLng, contactPerson, notes } = body;

  if (!name) {
    return NextResponse.json({ error: "Назва обов'язкова" }, { status: 400 });
  }

  if (code) {
    const existing = await prisma.counterparty.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json({ error: "Контрагент з таким кодом вже існує" }, { status: 400 });
    }
  }

  const counterparty = await prisma.counterparty.create({
    data: {
      name,
      code: code || null,
      type: type || "BOTH",
      phone: phone || null,
      email: email || null,
      address: address || null,
      deliveryAddress: deliveryAddress || null,
      deliveryLat: deliveryLat || null,
      deliveryLng: deliveryLng || null,
      contactPerson: contactPerson || null,
      notes: notes || null,
    },
  });

  return NextResponse.json(counterparty, { status: 201 });
}
