import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const applications = await prisma.wholesaleApplication.findMany({
    where: { userId: session.user.id },
    include: { company: true },
    orderBy: { createdAt: "desc" },
  });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, companyId: true, company: true },
  });

  return NextResponse.json({ applications, user });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { legalName, contactName, phone, email, address, businessType } = await req.json();

  if (!legalName || !contactName || !phone || !email || !address || !businessType) {
    return NextResponse.json({ error: "Всі поля обов'язкові" }, { status: 400 });
  }

  const validTypes = ["PRODUCTION", "SHOP", "SUBDISTRIBUTOR", "MARKET_POINT", "OTHER"];
  if (!validTypes.includes(businessType)) {
    return NextResponse.json({ error: "Невірний тип діяльності" }, { status: 400 });
  }

  // Check for pending application
  const existing = await prisma.wholesaleApplication.findFirst({
    where: { userId: session.user.id, status: "PENDING" },
  });

  if (existing) {
    return NextResponse.json({ error: "У вас вже є активна заявка на розгляді" }, { status: 400 });
  }

  const application = await prisma.wholesaleApplication.create({
    data: {
      userId: session.user.id,
      legalName,
      contactName,
      phone,
      email,
      address,
      businessType,
    },
  });

  return NextResponse.json(application);
}
