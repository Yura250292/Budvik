import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [total, noImage, withBudvikImage, withOtherImage] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.count({
      where: { isActive: true, OR: [{ image: null }, { image: "" }] },
    }),
    prisma.product.count({
      where: { isActive: true, image: { contains: "budvik.com" } },
    }),
    prisma.product.count({
      where: {
        isActive: true,
        image: { not: null },
        NOT: [{ image: "" }, { image: { contains: "budvik.com" } }],
      },
    }),
  ]);

  // Get sample products without images (prioritize by stock)
  const sampleNoImage = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [{ image: null }, { image: "" }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      stock: true,
      category: { select: { name: true } },
    },
    orderBy: { stock: "desc" },
    take: 50,
  });

  return NextResponse.json({
    total,
    withImage: total - noImage,
    noImage,
    withBudvikImage,
    withOtherImage,
    coverage: total > 0 ? Math.round(((total - noImage) / total) * 100) : 0,
    sampleNoImage,
  });
}
