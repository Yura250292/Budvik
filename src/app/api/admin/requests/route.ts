import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { listRequests } from "@/lib/office-requests";

/** Заявки всіх торгових для офісу; ?status=OPEN|DONE|REJECTED, без нього — усі. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, ["ADMIN", "MANAGER"]);
  if (!auth.ok) return auth.response;
  const status = new URL(req.url).searchParams.get("status");
  return NextResponse.json({ items: await listRequests({ status }) });
}
