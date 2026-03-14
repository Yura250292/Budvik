import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const items: { code: string; name: string; type?: string; phone?: string; email?: string; address?: string; contactPerson?: string }[] = body.items;

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Немає контрагентів" }, { status: 400 });
  }

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const cp of items) {
    try {
      const existing = await prisma.counterparty.findUnique({ where: { code: cp.code } });
      if (existing) {
        await prisma.counterparty.update({
          where: { code: cp.code },
          data: {
            name: cp.name,
            type: (cp.type as any) || existing.type,
            phone: cp.phone || existing.phone,
            email: cp.email || existing.email,
            address: cp.address || existing.address,
            contactPerson: cp.contactPerson || existing.contactPerson,
          },
        });
        updated++;
      } else {
        await prisma.counterparty.create({
          data: {
            code: cp.code,
            name: cp.name,
            type: (cp.type as any) || "BOTH",
            phone: cp.phone || null,
            email: cp.email || null,
            address: cp.address || null,
            contactPerson: cp.contactPerson || null,
          },
        });
        created++;
      }
    } catch (e: any) {
      errors.push(`${cp.code}: ${e.message}`);
    }
  }

  return NextResponse.json({ created, updated, errors: errors.slice(0, 10), total: items.length });
}
