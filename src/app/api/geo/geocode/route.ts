import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geo/nominatim";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ error: "Параметр q обовʼязковий (мін. 2 символи)" }, { status: 400 });
  }

  try {
    const result = await geocodeAddress(q.trim());
    if (!result) {
      return NextResponse.json({ error: "Адресу не знайдено" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Помилка геокодування";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
