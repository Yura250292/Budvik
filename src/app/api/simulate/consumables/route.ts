import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSpecs } from "@/lib/simulation/specs";
import { getMaterialById } from "@/lib/simulation/materials";
import { simulate, compareSimulations } from "@/lib/simulation/engine";
import { productToConsumable, type ConsumableMode } from "@/lib/simulation/consumables";
import { aiEnrichConsumables, blendFactors } from "@/lib/simulation/ai-enrichment";

export async function POST(req: Request) {
  const body = await req.json();
  const { productId, materialId, consumableMode, consumableIds, params } = body;

  if (!materialId || !consumableMode || !consumableIds?.length) {
    return NextResponse.json({ error: "materialId, consumableMode та consumableIds обов'язкові" }, { status: 400 });
  }

  if (consumableIds.length > 4) {
    return NextResponse.json({ error: "Максимум 4 витратних матеріали" }, { status: 400 });
  }

  const material = getMaterialById(materialId);
  if (!material) {
    return NextResponse.json({ error: "Матеріал не знайдено" }, { status: 404 });
  }

  // Fetch consumable products from DB
  const consumableProducts = await prisma.product.findMany({
    where: { id: { in: consumableIds } },
    include: { category: true },
  });

  if (consumableProducts.length === 0) {
    return NextResponse.json({ error: "Витратні матеріали не знайдено" }, { status: 404 });
  }

  // Convert products to consumables using parser
  const selected = consumableProducts.map(p =>
    productToConsumable(
      { id: p.id, name: p.name, price: p.price, image: p.image, category: p.category ? { slug: p.category.slug, name: p.category.name } : null },
      consumableMode as ConsumableMode
    )
  );

  // AI enrichment — get real-world quality factors from Gemini + Google Search (max 18s)
  let aiFactors = new Map<string, any>();
  try {
    aiFactors = await Promise.race([
      aiEnrichConsumables(
        consumableProducts.map(p => ({ name: p.name, price: p.price })),
        consumableMode
      ),
      new Promise<Map<string, any>>(resolve =>
        setTimeout(() => resolve(new Map()), 18000)
      ),
    ]);
  } catch (err) {
    console.error("AI enrichment skipped:", err);
  }

  // Blend AI factors with heuristic factors
  const aiReasonings: Record<string, string> = {};
  for (const consumable of selected) {
    const ai = aiFactors.get(consumable.nameUk);
    if (ai) {
      const blended = blendFactors(consumable, ai);
      consumable.speedFactor = blended.speedFactor;
      consumable.durabilityFactor = blended.durabilityFactor;
      consumable.precisionFactor = blended.precisionFactor;
      consumable.heatFactor = blended.heatFactor;
      if (blended.aiReasoning) {
        aiReasonings[consumable.id] = blended.aiReasoning;
      }
    }
  }

  // Determine simulation type from consumable mode
  const simTypeMap: Record<string, string> = {
    drill_bits: "drilling",
    cutting_discs: "cutting",
    grinding_discs: "grinding",
    chainsaw: "cutting",
  };
  const simType = simTypeMap[consumableMode] || "cutting";

  // If productId is provided, use that tool; otherwise use defaults
  let toolSpecs;
  let toolName = "Стандартний інструмент";

  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (product) {
      toolSpecs = resolveSpecs(product);
      toolName = product.name;
    }
  }

  if (!toolSpecs) {
    const defaults: Record<string, { powerWatts: number; rpm: number; toolType: string }> = {
      drill_bits: { powerWatts: 850, rpm: 2800, toolType: "drill" },
      cutting_discs: { powerWatts: 1000, rpm: 11000, toolType: "grinder" },
      grinding_discs: { powerWatts: 1000, rpm: 11000, toolType: "grinder" },
      chainsaw: { powerWatts: 2000, rpm: 9000, toolType: "circular_saw" },
    };
    const d = defaults[consumableMode] || defaults.cutting_discs;
    toolSpecs = {
      ...d,
      discDiameterMm: 125,
      chuckMm: 13,
      weightKg: 2.5,
      isEstimated: true,
    } as any;
  }

  const results = selected.map((consumable) => {
    const result = simulate({
      tool: toolSpecs,
      material,
      type: simType as any,
      consumable,
      thicknessMm: params?.thicknessMm,
      depthMm: params?.depthMm,
      holeDiameterMm: consumable.diameterMm || params?.holeDiameterMm,
      surfaceAreaCm2: params?.surfaceAreaCm2,
      logDiameterCm: params?.logDiameterCm,
    });
    result.toolName = toolName;
    result.consumableName = consumable.nameUk;
    result.consumableId = consumable.id;
    return result;
  });

  const comparison = compareSimulations(results);

  return NextResponse.json({
    ...comparison,
    material: { id: material.id, nameUk: material.nameUk },
    toolName,
    simType,
    aiReasonings: Object.keys(aiReasonings).length > 0 ? aiReasonings : undefined,
  });
}
