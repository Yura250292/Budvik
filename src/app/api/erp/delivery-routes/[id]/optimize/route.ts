import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatWithGemini } from "@/lib/ai/gemini";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { startAddress } = body; // start point (warehouse/office)

  const route = await prisma.deliveryRoute.findUnique({
    where: { id },
    include: {
      stops: {
        include: {
          counterparty: { select: { id: true, name: true, address: true } },
          salesDocument: { select: { number: true, totalAmount: true } },
        },
        orderBy: { sequence: "asc" },
      },
    },
  });

  if (!route) {
    return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });
  }

  if (route.stops.length < 2) {
    return NextResponse.json({ error: "Потрібно мінімум 2 зупинки для оптимізації" }, { status: 400 });
  }

  // Build prompt for Gemini
  const stopsInfo = route.stops.map((s, i) => ({
    id: s.id,
    index: i + 1,
    client: s.counterparty?.name || "Невідомий",
    address: s.address || s.counterparty?.address || "Адреса невідома",
    orderNumber: s.salesDocument?.number,
    amount: s.salesDocument?.totalAmount,
  }));

  const prompt = `Ти — AI-логіст. Оптимізуй маршрут доставки для мінімальної відстані та часу.

Початкова точка (склад): ${startAddress || "Вінниця, центр"}

Зупинки для доставки:
${stopsInfo.map((s) => `${s.index}. ${s.client} — ${s.address} (замовлення ${s.orderNumber}, сума ${s.amount} грн)`).join("\n")}

Поверни відповідь СТРОГО у форматі JSON (без markdown, без коментарів):
{
  "optimizedOrder": [${stopsInfo.map((s) => s.index).join(", ")}],
  "estimatedDistanceKm": число,
  "estimatedTimeMinutes": число,
  "reasoning": "коротке пояснення логіки маршруту",
  "stopDistances": [{"index": число, "distanceFromPrevKm": число}]
}

ВАЖЛИВО: optimizedOrder — масив НОМЕРІВ зупинок (${stopsInfo.map((s) => s.index).join(", ")}) в оптимальному порядку.
Впорядкуй зупинки для мінімальної відстані, враховуючи географію. Оціни загальну відстань.`;

  try {
    const response = await chatWithGemini(
      [{ role: "user", parts: [{ text: prompt }] }],
      "Ти AI-логіст для оптимізації маршрутів доставки в Україні. Відповідай тільки у JSON форматі.",
    );

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AI не зміг оптимізувати", rawResponse: response }, { status: 500 });
    }

    const result = JSON.parse(jsonMatch[0]);

    // Apply optimized order — map indices back to real stop IDs
    if (result.optimizedOrder && Array.isArray(result.optimizedOrder)) {
      // Build index-to-stop mapping (1-based index → stop)
      const indexToStop = new Map(stopsInfo.map((s) => [s.index, s]));

      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < result.optimizedOrder.length; i++) {
          const idx = Number(result.optimizedOrder[i]);
          const stop = indexToStop.get(idx);
          if (!stop) continue; // skip invalid indices from AI

          const distance = result.stopDistances?.find((sd: any) => Number(sd.index) === idx);
          await tx.deliveryStop.update({
            where: { id: stop.id },
            data: {
              sequence: i + 1,
              distanceKm: distance?.distanceFromPrevKm || null,
            },
          });
        }

        // Update route totals
        const totalDist = result.estimatedDistanceKm || null;
        let fuelCost = null;
        if (totalDist && route.fuelConsumption && route.fuelPricePer) {
          fuelCost = (totalDist / 100) * route.fuelConsumption * route.fuelPricePer;
        }

        await tx.deliveryRoute.update({
          where: { id },
          data: {
            totalDistanceKm: totalDist,
            totalFuelCost: fuelCost ? Math.round(fuelCost * 100) / 100 : null,
          },
        });
      });
    }

    return NextResponse.json({
      ok: true,
      optimization: result,
    });
  } catch (e: any) {
    return NextResponse.json({ error: `AI помилка: ${e.message}` }, { status: 500 });
  }
}
