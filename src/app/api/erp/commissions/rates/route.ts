import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rates = await prisma.commissionRate.findMany({
    include: {
      salesRep: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ salesRepId: "asc" }, { brand: "asc" }],
  });

  return NextResponse.json(rates);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { salesRepId, brand, percentage } = body;

  if (!salesRepId || !brand || percentage === undefined) {
    return NextResponse.json({ error: "Заповніть всі поля" }, { status: 400 });
  }

  const rate = await prisma.commissionRate.upsert({
    where: { salesRepId_brand: { salesRepId, brand } },
    update: { percentage },
    create: { salesRepId, brand, percentage },
  });

  return NextResponse.json(rate);
}
