import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseCounterpartiesXML, parseCounterpartiesCSV } from "@/lib/import-1c";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Файл не завантажено" }, { status: 400 });
  }

  const text = await file.text();
  const fileName = file.name.toLowerCase();

  let parsed;
  try {
    if (fileName.endsWith(".xml")) {
      parsed = parseCounterpartiesXML(text);
    } else if (fileName.endsWith(".csv") || fileName.endsWith(".txt")) {
      parsed = parseCounterpartiesCSV(text);
    } else {
      return NextResponse.json({ error: "Підтримуються формати: XML, CSV, TXT" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Помилка парсингу файлу" }, { status: 400 });
  }

  if (parsed.length === 0) {
    return NextResponse.json({ error: "Не знайдено контрагентів у файлі" }, { status: 400 });
  }

  // Preview mode — just return parsed data
  const mode = formData.get("mode") as string;
  if (mode === "preview") {
    return NextResponse.json({ count: parsed.length, items: parsed.slice(0, 50) });
  }

  // Import mode — upsert by code
  let created = 0;
  let updated = 0;
  let errors: string[] = [];

  for (const cp of parsed) {
    try {
      const existing = await prisma.counterparty.findUnique({ where: { code: cp.code } });
      if (existing) {
        await prisma.counterparty.update({
          where: { code: cp.code },
          data: {
            name: cp.name,
            type: cp.type || existing.type,
            phone: cp.phone || existing.phone,
            email: cp.email || existing.email,
            address: cp.address || existing.address,
            contactPerson: cp.contactPerson || existing.contactPerson,
          },
        });
        updated++;
      } else {
        await prisma.counterparty.create({
          data: {
            code: cp.code,
            name: cp.name,
            type: cp.type || "BOTH",
            phone: cp.phone || null,
            email: cp.email || null,
            address: cp.address || null,
            contactPerson: cp.contactPerson || null,
          },
        });
        created++;
      }
    } catch (e: any) {
      errors.push(`${cp.code}: ${e.message}`);
    }
  }

  return NextResponse.json({ created, updated, errors: errors.slice(0, 20), total: parsed.length });
}
