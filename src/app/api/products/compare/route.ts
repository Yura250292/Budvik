import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = searchParams.get("ids")?.split(",").filter(Boolean);

  if (!ids || ids.length === 0) {
    return NextResponse.json([]);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { category: true },
  });

  // Return in the same order as requested
  const ordered = ids.map((id) => products.find((p) => p.id === id)).filter(Boolean);

  return NextResponse.json(ordered);
}
