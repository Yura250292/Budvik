import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { chatWithGemini, GeminiMessage } from "@/lib/ai/gemini";
import { getUserOrdersContext, getProductCatalogContext, getSystemPrompt } from "@/lib/ai/context";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { message, history = [] } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const [ordersContext, catalogContext] = await Promise.all([
      getUserOrdersContext(session.user.id),
      getProductCatalogContext(),
    ]);

    const systemPrompt =
      getSystemPrompt("support") +
      `\n\nІнформація про клієнта:\nІм'я: ${session.user.name}\nEmail: ${session.user.email}\n\n` +
      ordersContext +
      "\n\n" +
      catalogContext;

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
    console.error("AI Support error:", error);
    return NextResponse.json({ error: "Помилка AI підтримки" }, { status: 500 });
  }
}
