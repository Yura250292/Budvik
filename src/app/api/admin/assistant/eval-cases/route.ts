import { NextResponse } from "next/server";
import { OFFICE_ROLES, requireRoles } from "@/lib/app/identity";
import { caseFromFeedback, deleteEvalCase, listEvalCases, updateEvalCase } from "@/lib/assistant/eval-cases";

/**
 * Регресійний набір помічника.
 *
 * GET                                  — усі кейси, еталони згори.
 * POST   { feedbackId, golden }        — завести з розібраної відповіді.
 * PATCH  { id, ...поля }               — дописати очікування, увімкнути.
 * DELETE { id }                        — прибрати (кейс не архівуємо: на
 *                                        відміну від правила, він нічого
 *                                        не змінював у поведінці).
 */
export const dynamic = "force-dynamic";

const STATUSES = ["DRAFT", "ACTIVE", "OFF"] as const;
const VIA = ["MODEL", "CODE"];

const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

export async function GET(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const items = await listEvalCases();
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const feedbackId = typeof body?.feedbackId === "string" ? body.feedbackId : "";
  if (!feedbackId) return NextResponse.json({ error: "Потрібен feedbackId" }, { status: 400 });

  const created = await caseFromFeedback(feedbackId, body?.golden === true);
  if (!created) return NextResponse.json({ error: "Такої відповіді немає або в ній не збереглось питання" }, { status: 404 });
  return NextResponse.json({ case: created });
}

export async function PATCH(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Потрібен id" }, { status: 400 });

  const updated = await updateEvalCase(id, {
    ...(typeof body?.question === "string" ? { question: body.question } : {}),
    ...(strList(body?.expectTools) ? { expectTools: strList(body.expectTools) } : {}),
    ...(strList(body?.forbidTools) ? { forbidTools: strList(body.forbidTools) } : {}),
    ...(strList(body?.expectBlocks) ? { expectBlocks: strList(body.expectBlocks) } : {}),
    ...(strList(body?.mustContain) ? { mustContain: strList(body.mustContain) } : {}),
    ...(strList(body?.mustNotContain) ? { mustNotContain: strList(body.mustNotContain) } : {}),
    ...(body?.expectVia === null || VIA.includes(body?.expectVia) ? { expectVia: body.expectVia } : {}),
    ...(body?.maxUnverified === null || typeof body?.maxUnverified === "number"
      ? { maxUnverified: body.maxUnverified }
      : {}),
    ...(typeof body?.rubric === "string" ? { rubric: body.rubric } : {}),
    ...(STATUSES.includes(body?.status) ? { status: body.status } : {}),
    ...(typeof body?.golden === "boolean" ? { golden: body.golden } : {}),
  });
  return NextResponse.json({ case: updated });
}

export async function DELETE(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Потрібен id" }, { status: 400 });

  await deleteEvalCase(id);
  return NextResponse.json({ ok: true });
}
