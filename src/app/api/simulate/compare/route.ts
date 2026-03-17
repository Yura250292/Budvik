import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSpecs } from "@/lib/simulation/specs";
import { getMaterialById } from "@/lib/simulation/materials";
import { simulate, compareSimulations } from "@/lib/simulation/engine";

export async function POST(req: Request) {
  const body = await req.json();
  const { productIds, materialId, type, params } = body;

  if (!productIds?.length || !materialId || !type) {
    return NextResponse.json({ error: "productIds, materialId та type обов'язкові" }, { status: 400 });
  }

  if (productIds.length > 4) {
    return NextResponse.json({ error: "Максимум 4 інструменти для порівняння" }, { status: 400 });
  }

  if (!["cutting", "grinding", "drilling"].includes(type)) {
    return NextResponse.json({ error: "type має бути: cutting, grinding або drilling" }, { status: 400 });
  }

  const material = getMaterialById(materialId);
  if (!material) {
    return NextResponse.json({ error: "Матеріал не знайдено" }, { status: 404 });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { category: true },
  });

  if (products.length === 0) {
    return NextResponse.json({ error: "Продукти не знайдено" }, { status: 404 });
  }

  // Keep order matching productIds
  const ordered = productIds
    .map((id: string) => products.find((p) => p.id === id))
    .filter(Boolean);

  const results = ordered.map((product: typeof products[0]) => {
    const specs = resolveSpecs(product);
    const result = simulate({
      tool: specs,
      material,
      type,
      thicknessMm: params?.thicknessMm,
      depthMm: params?.depthMm,
      holeDiameterMm: params?.holeDiameterMm,
      surfaceAreaCm2: params?.surfaceAreaCm2,
    });
    result.toolName = product.name;
    result.productId = product.id;
    return result;
  });

  const comparison = compareSimulations(results);

  return NextResponse.json({
    ...comparison,
    material: { id: material.id, nameUk: material.nameUk },
  });
}
