import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateProductEmbeddings } from "@/lib/ai/embeddings";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !["ADMIN", "MANAGER"].includes((session.user as any).role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch {
      // No body or invalid JSON — use defaults
    }

    const count = await generateProductEmbeddings(force);

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
