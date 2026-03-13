import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await req.json();
  const slug = data.name
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50);

  const product = await prisma.product.create({
    data: {
      name: data.name,
      slug: slug + "-" + Date.now(),
      description: data.description,
      price: parseFloat(data.price),
      wholesalePrice: data.wholesalePrice ? parseFloat(data.wholesalePrice) : null,
      stock: parseInt(data.stock),
      categoryId: data.categoryId,
      isActive: true,
      isPromo: data.isPromo || false,
      promoPrice: data.promoPrice ? parseFloat(data.promoPrice) : null,
      promoLabel: data.promoLabel || null,
      priority: data.priority ? parseInt(data.priority) : 0,
    },
  });

  return NextResponse.json(product);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await req.json();
  const product = await prisma.product.update({
    where: { id: data.id },
    data: {
      name: data.name,
      description: data.description,
      price: parseFloat(data.price),
      wholesalePrice: data.wholesalePrice ? parseFloat(data.wholesalePrice) : null,
      stock: parseInt(data.stock),
      categoryId: data.categoryId,
      isActive: data.isActive,
      isPromo: data.isPromo ?? false,
      promoPrice: data.promoPrice ? parseFloat(data.promoPrice) : null,
      promoLabel: data.promoLabel || null,
      priority: data.priority != null ? parseInt(data.priority) : 0,
    },
  });

  return NextResponse.json(product);
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await req.json();
  await prisma.product.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
