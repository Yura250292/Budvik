import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { chatWithGemini } from "@/lib/ai/gemini";
import { getSalesAnalyticsContext, getSystemPrompt } from "@/lib/ai/context";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !["ADMIN", "MANAGER"].includes((session.user as any).role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const analyticsData = await getSalesAnalyticsContext();
    const systemPrompt = getSystemPrompt("analytics");

    const response = await chatWithGemini(
      [
        {
          role: "user",
          parts: [
            {
              text: `Проаналізуй наступні дані продажів та надай повний звіт з рекомендаціями:\n\n${analyticsData}`,
            },
          ],
        },
      ],
      systemPrompt
    );

    return NextResponse.json({ report: response, rawData: analyticsData });
  } catch (error: unknown) {
    console.error("AI Analytics error:", error);
    return NextResponse.json({ error: "Помилка AI аналітики" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !["ADMIN", "MANAGER"].includes((session.user as any).role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { question } = await req.json();
    const analyticsData = await getSalesAnalyticsContext();
    const systemPrompt = getSystemPrompt("analytics") + "\n\n" + analyticsData;

    const response = await chatWithGemini(
      [{ role: "user", parts: [{ text: question }] }],
      systemPrompt
    );

    return NextResponse.json({ response });
  } catch (error: unknown) {
    console.error("AI Analytics error:", error);
    return NextResponse.json({ error: "Помилка AI аналітики" }, { status: 500 });
  }
}
