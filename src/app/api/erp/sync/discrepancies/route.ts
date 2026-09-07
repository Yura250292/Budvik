import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listDiscrepancies, type DiscrepancyFilter } from "@/lib/sync-ingest/health-facts";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const syncJobId = url.searchParams.get("syncJobId");
  const resolved = url.searchParams.get("resolved");
  const entityType = url.searchParams.get("entityType");

  const where: DiscrepancyFilter = {};
  if (syncJobId) where.syncJobId = syncJobId;
  if (resolved === "true") where.resolved = true;
  if (resolved === "false") where.resolved = false;
  if (entityType) where.entityType = entityType;

  return NextResponse.json(await listDiscrepancies(where));
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, resolved } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const updated = await prisma.syncDiscrepancy.update({
    where: { id },
    data: { resolved: resolved ?? true },
  });

  return NextResponse.json(updated);
}
