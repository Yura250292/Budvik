import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { status, reviewNote } = await req.json();

  if (!["APPROVED", "REJECTED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const application = await prisma.wholesaleApplication.findUnique({
    where: { id },
  });

  if (!application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (application.status !== "PENDING") {
    return NextResponse.json({ error: "Заявка вже оброблена" }, { status: 400 });
  }

  if (status === "APPROVED") {
    // Find or create the company
    let company = await prisma.wholesaleCompany.findFirst({
      where: { legalName: application.legalName },
    });

    if (!company) {
      company = await prisma.wholesaleCompany.create({
        data: {
          legalName: application.legalName,
          phone: application.phone,
          email: application.email,
          address: application.address,
          businessType: application.businessType,
        },
      });
    }

    // Update application
    await prisma.wholesaleApplication.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedBy: session.user.id,
        reviewNote,
        companyId: company.id,
      },
    });

    // Update user: set role to WHOLESALE and link to company
    await prisma.user.update({
      where: { id: application.userId },
      data: {
        role: "WHOLESALE",
        companyId: company.id,
      },
    });
  } else {
    await prisma.wholesaleApplication.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedBy: session.user.id,
        reviewNote,
      },
    });
  }

  const updated = await prisma.wholesaleApplication.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      company: true,
    },
  });

  return NextResponse.json(updated);
}
