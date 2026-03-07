import { NextResponse } from "next/server";
import { chatWithGemini, GeminiMessage } from "@/lib/ai/gemini";
import { getProductCatalogContext, getSystemPrompt } from "@/lib/ai/context";

export async function POST(req: Request) {
  try {
    const { message, history = [] } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const catalog = await getProductCatalogContext();
    const systemPrompt = getSystemPrompt("consultant") + "\n\n" + catalog;

    const messages: GeminiMessage[] = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role === "user" ? "user" as const : "model" as const,
        parts: [{ text: h.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const response = await chatWithGemini(messages, systemPrompt);

    return NextResponse.json({ response });
  } catch (error: unknown) {
    console.error("AI Chat error:", error);
    return NextResponse.json(
      { error: "Помилка AI сервісу" },
      { status: 500 }
    );
  }
}
