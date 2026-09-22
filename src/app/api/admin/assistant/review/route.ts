import { NextResponse } from "next/server";
import { OFFICE_ROLES, requireRoles } from "@/lib/app/identity";
import { listReview, setReviewStatus } from "@/lib/assistant/feedback";

/**
 * Черга розбору помічника.
 *
 * GET ?status=NEW&verdict=BAD&source=AUTO&code=1 — без фільтрів усе.
 * PATCH { id, status, note? } — позначити розібраним.
 */
export const dynamic = "force-dynamic";

const STATUSES = ["NEW", "TRIAGED", "RULED", "TEST", "WONTFIX"] as const;
type Status = (typeof STATUSES)[number];

export async function GET(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const q = new URL(req.url).searchParams;
  const items = await listReview({
    status: q.get("status"),
    verdict: q.get("verdict"),
    source: q.get("source"),
    codeOnly: q.get("code") === "1",
    limit: Number(q.get("limit")) || 50,
  });

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const status = STATUSES.includes(body?.status) ? (body.status as Status) : null;
  if (!id || !status) return NextResponse.json({ error: "Потрібні id і status" }, { status: 400 });

  const note = typeof body?.note === "string" ? body.note.slice(0, 1000) : null;
  await setReviewStatus(id, status, note);
  return NextResponse.json({ ok: true });
}
