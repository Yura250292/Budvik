import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { rateLimit } from "@/lib/shop/rate-limit";
import { createRequest, listRequests, RequestError } from "@/lib/office-requests";

/** Власні заявки торгового в офіс: список і нова. */
export const dynamic = "force-dynamic";

const ROLES = ["SALES", "ADMIN"] as const;

export async function GET(req: Request) {
  const auth = await requireRoles(req, ROLES);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listRequests({ authorId: auth.me.userId }) });
}

export async function POST(req: Request) {
  const auth = await requireRoles(req, ROLES);
  if (!auth.ok) return auth.response;

  const limit = await rateLimit(`office-request:${auth.me.userId}`, 20, 3600);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Забагато заявок за годину — зачекайте" }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json({ item: await createRequest(auth.me.userId, body) }, { status: 201 });
  } catch (e) {
    if (e instanceof RequestError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
