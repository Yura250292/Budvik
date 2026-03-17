import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSpecs } from "@/lib/simulation/specs";
import { getMaterialById } from "@/lib/simulation/materials";
import { simulate } from "@/lib/simulation/engine";

export async function POST(req: Request) {
  const body = await req.json();
  const { productId, materialId, type, params } = body;

  if (!productId || !materialId || !type) {
    return NextResponse.json({ error: "productId, materialId та type обов'язкові" }, { status: 400 });
  }

  if (!["cutting", "grinding", "drilling"].includes(type)) {
    return NextResponse.json({ error: "type має бути: cutting, grinding або drilling" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true },
  });

  if (!product) {
    return NextResponse.json({ error: "Продукт не знайдено" }, { status: 404 });
  }

  const material = getMaterialById(materialId);
  if (!material) {
    return NextResponse.json({ error: "Матеріал не знайдено" }, { status: 404 });
  }

  const specs = resolveSpecs(product);

  const result = simulate({
    tool: specs,
    material,
    type,
    thicknessMm: params?.thicknessMm,
    depthMm: params?.depthMm,
    holeDiameterMm: params?.holeDiameterMm,
    surfaceAreaCm2: params?.surfaceAreaCm2,
    logDiameterCm: params?.logDiameterCm,
  });

  result.toolName = product.name;
  result.productId = product.id;

  return NextResponse.json({
    result,
    specs: {
      ...specs,
      isEstimated: specs.isEstimated,
    },
    material: { id: material.id, nameUk: material.nameUk },
  });
}
