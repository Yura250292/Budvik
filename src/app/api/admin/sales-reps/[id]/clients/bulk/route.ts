import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Стеля одного виклику: більше за раз ніхто не відмічає, а IN на тисячі id — зайве навантаження. */
const MAX_IDS = 500;

/**
 * Закріпити кількох клієнтів за торговим.
 *
 * Два види тіла:
 *   { folderId }          — усі клієнти з папки (картка торгового);
 *   { counterpartyIds }   — конкретні клієнти («Нічийні сплячі» на
 *                           /admin/marketing).
 * Уже закріплені пропускаються, відповідь однакова: { ok, total, added, skipped }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: salesRepId } = await params;
  const body = (await req.json().catch(() => ({}))) as { folderId?: unknown; counterpartyIds?: unknown };

  let counterpartyIds: string[];

  if (Array.isArray(body.counterpartyIds)) {
    const ids = [
      ...new Set(body.counterpartyIds.filter((x): x is string => typeof x === "string" && x.length > 0)),
    ];
    if (ids.length === 0) return NextResponse.json({ error: "Оберіть клієнтів" }, { status: 400 });
    if (ids.length > MAX_IDS) {
      return NextResponse.json({ error: `Не більше ${MAX_IDS} клієнтів за раз` }, { status: 400 });
    }
    // Лише ті, що існують: зайвий id з вкладки, відкритої вчора, не має
    // валити весь запис помилкою зовнішнього ключа.
    const found = await prisma.counterparty.findMany({ where: { id: { in: ids } }, select: { id: true } });
    counterpartyIds = found.map((c) => c.id);
    if (counterpartyIds.length === 0) return NextResponse.json({ error: "Клієнтів не знайдено" }, { status: 404 });
  } else if (typeof body.folderId === "string" && body.folderId) {
    const folderItems = await prisma.clientFolderItem.findMany({
      where: { folderId: body.folderId },
      select: { counterpartyId: true },
    });
    if (folderItems.length === 0) {
      return NextResponse.json({ error: "Папка порожня" }, { status: 400 });
    }
    counterpartyIds = folderItems.map((i) => i.counterpartyId);
  } else {
    return NextResponse.json({ error: "Вкажіть папку" }, { status: 400 });
  }

  const rep = await prisma.user.findUnique({ where: { id: salesRepId }, select: { id: true } });
  if (!rep) return NextResponse.json({ error: "Торгового не знайдено" }, { status: 404 });

  // Check which are already assigned
  const existing = await prisma.salesRepClient.findMany({
    where: { salesRepId, counterpartyId: { in: counterpartyIds } },
    select: { counterpartyId: true },
  });
  const existingIds = new Set(existing.map((e) => e.counterpartyId));
  const newIds = counterpartyIds.filter((cid) => !existingIds.has(cid));

  if (newIds.length > 0) {
    await prisma.salesRepClient.createMany({
      data: newIds.map((counterpartyId) => ({ salesRepId, counterpartyId })),
      // Два офісні вікна закріплюють того самого клієнта одночасно — не 500.
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    ok: true,
    total: counterpartyIds.length,
    added: newIds.length,
    skipped: counterpartyIds.length - newIds.length,
  });
}
