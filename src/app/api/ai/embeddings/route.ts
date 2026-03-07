import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateProductEmbeddings } from "@/lib/ai/embeddings";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const count = await generateProductEmbeddings();

    return NextResponse.json({
      message: `Згенеровано embeddings для ${count} товарів`,
      count,
    });
  } catch (error: unknown) {
    console.error("Embeddings generation error:", error);
    return NextResponse.json(
      { error: "Помилка генерації embeddings" },
      { status: 500 }
    );
  }
}
