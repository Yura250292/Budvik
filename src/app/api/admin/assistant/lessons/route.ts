import { NextResponse } from "next/server";
import { OFFICE_ROLES, requireRoles } from "@/lib/app/identity";
import {
  archiveLesson,
  createLesson,
  lessonsSharingTriggers,
  listLessons,
  suggestTriggers,
  updateLesson,
} from "@/lib/assistant/lessons";

/**
 * Правила помічника — те, у що перетворюється 👎.
 *
 * GET                              — усі правила, крім архівних.
 * GET ?suggest=<питання>           — підказка тригерів для форми.
 * POST   { text, kind?, triggers?, feedbackId? } — завести (завжди чернеткою).
 * PATCH  { id, text?, status?, triggers?, priority?, kind? }
 * DELETE { id }                    — м'яке архівування.
 *
 * Правило міняє поведінку помічника для всієї фірми, тож права — офісні,
 * ті самі, що й у черги розбору.
 */
export const dynamic = "force-dynamic";

const STATUSES = ["DRAFT", "ACTIVE", "OFF"] as const;
type Status = (typeof STATUSES)[number];

const KINDS = ["ADMIN", "SALES", "DRIVER", "WAREHOUSE"];

export async function GET(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const q = new URL(req.url).searchParams;
  const suggest = q.get("suggest");
  if (suggest) {
    const triggers = suggestTriggers(suggest);
    // Одразу показуємо, з чим новий тригер перетнеться: суперечливу пару
    // краще побачити до збереження, ніж у ході.
    const conflicts = await lessonsSharingTriggers(triggers);
    return NextResponse.json({ triggers, conflicts }, { headers: { "Cache-Control": "no-store" } });
  }

  const items = await listLessons();
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < 10) {
    return NextResponse.json({ error: "Правило — це одне речення, а не кілька слів" }, { status: 400 });
  }

  const kind = typeof body?.kind === "string" && KINDS.includes(body.kind) ? body.kind : null;
  const triggers = Array.isArray(body?.triggers)
    ? body.triggers.filter((t: unknown): t is string => typeof t === "string")
    : [];

  const lesson = await createLesson({
    text,
    kind,
    triggers,
    authorId: auth.me.userId,
    feedbackId: typeof body?.feedbackId === "string" ? body.feedbackId : null,
  });
  return NextResponse.json({ lesson });
}

export async function PATCH(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Потрібен id" }, { status: 400 });

  const lesson = await updateLesson(id, {
    ...(typeof body?.text === "string" ? { text: body.text } : {}),
    ...(STATUSES.includes(body?.status) ? { status: body.status as Status } : {}),
    ...(Array.isArray(body?.triggers)
      ? { triggers: body.triggers.filter((t: unknown): t is string => typeof t === "string") }
      : {}),
    ...(typeof body?.priority === "number" ? { priority: body.priority } : {}),
    ...(body?.kind === null || (typeof body?.kind === "string" && KINDS.includes(body.kind))
      ? { kind: body.kind }
      : {}),
  });
  return NextResponse.json({ lesson });
}

export async function DELETE(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Потрібен id" }, { status: 400 });

  await archiveLesson(id);
  return NextResponse.json({ ok: true });
}
