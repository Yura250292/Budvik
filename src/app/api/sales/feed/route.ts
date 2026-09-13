import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { feedPage } from "@/lib/rep-feed/feed-query";

/** Стрічка торгового: лише власні рядки, сторінками. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, ["SALES", "ADMIN"]);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  return NextResponse.json(
    await feedPage({
      userId: auth.me.userId,
      filter: url.searchParams.get("filter"),
      cursor: url.searchParams.get("cursor"),
    })
  );
}
