import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const regions = await prisma.salesRepRegion.findMany({ where: { salesRepId: id }, orderBy: { region: "asc" } });
  return NextResponse.json(regions);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const { region } = await req.json();
  if (!region?.trim()) return NextResponse.json({ error: "Вкажіть регіон" }, { status: 400 });

  const created = await prisma.salesRepRegion.create({
    data: { salesRepId: id, region: region.trim() },
  });
  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const { regionId } = await req.json();
  await prisma.salesRepRegion.delete({ where: { id: regionId, salesRepId: id } });
  return NextResponse.json({ ok: true });
}
