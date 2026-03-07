import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const discounts = await prisma.wholesaleBrandDiscount.findMany({
    orderBy: { brand: "asc" },
  });

  return NextResponse.json(discounts);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { brand, discount } = await req.json();

  if (!brand || typeof discount !== "number" || discount < 0 || discount > 100) {
    return NextResponse.json({ error: "Невірні дані. Бренд та знижка (0-100%) обов'язкові" }, { status: 400 });
  }

  const trimmedBrand = brand.trim();

  const existing = await prisma.wholesaleBrandDiscount.findUnique({
    where: { brand: trimmedBrand },
  });

  if (existing) {
    const updated = await prisma.wholesaleBrandDiscount.update({
      where: { brand: trimmedBrand },
      data: { discount },
    });
    return NextResponse.json(updated);
  }

  const created = await prisma.wholesaleBrandDiscount.create({
    data: { brand: trimmedBrand, discount },
  });

  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await prisma.wholesaleBrandDiscount.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
