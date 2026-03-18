import { prisma } from "@/lib/prisma";
import { parseCounterpartiesCSV, parseCounterpartiesXML, type ParsedCounterparty } from "@/lib/import-1c";

export interface CounterpartySyncPreviewItem {
  code: string;
  name: string;
  action: "create" | "update" | "unchanged";
  changes?: { field: string; from: string; to: string }[];
}

export interface CounterpartySyncPreviewResult {
  total: number;
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  items: CounterpartySyncPreviewItem[];
}

/** Parse file content into ParsedCounterparty[] */
export function parseFileToCounterparties(content: string, fileName: string): ParsedCounterparty[] {
  const ext = fileName.toLowerCase();
  if (ext.endsWith(".xml")) {
    return parseCounterpartiesXML(content);
  }
  return parseCounterpartiesCSV(content);
}

/** Preview counterparty sync changes */
export async function previewCounterpartySync(
  parsed: ParsedCounterparty[]
): Promise<CounterpartySyncPreviewResult> {
  const items: CounterpartySyncPreviewItem[] = [];
  let toCreate = 0;
  let toUpdate = 0;
  let unchanged = 0;

  for (const c of parsed) {
    const existing = await prisma.counterparty.findFirst({
      where: { OR: [{ code: c.code }, { name: c.name }] },
    });

    if (!existing) {
      toCreate++;
      items.push({ code: c.code, name: c.name, action: "create" });
      continue;
    }

    const changes: { field: string; from: string; to: string }[] = [];
    if (c.phone && c.phone !== existing.phone) {
      changes.push({ field: "phone", from: existing.phone || "", to: c.phone });
    }
    if (c.address && c.address !== existing.address) {
      changes.push({ field: "address", from: existing.address || "", to: c.address });
    }
    if (c.email && c.email !== existing.email) {
      changes.push({ field: "email", from: existing.email || "", to: c.email });
    }

    if (changes.length > 0) {
      toUpdate++;
      items.push({ code: c.code, name: c.name, action: "update", changes });
    } else {
      unchanged++;
      items.push({ code: c.code, name: c.name, action: "unchanged" });
    }
  }

  return { total: parsed.length, toCreate, toUpdate, unchanged, items };
}

/** Apply counterparty sync */
export async function applyCounterpartySync(
  parsed: ParsedCounterparty[],
  fileName: string
) {
  const syncJob = await prisma.syncJob.create({
    data: {
      type: "counterparties",
      status: "running",
      fileName,
      recordsTotal: parsed.length,
    },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  let discrepancyCount = 0;

  for (const c of parsed) {
    try {
      const existing = await prisma.counterparty.findFirst({
        where: { OR: [{ code: c.code }, { name: c.name }] },
      });

      if (!existing) {
        await prisma.counterparty.create({
          data: {
            name: c.name,
            code: c.code,
            type: c.type || "BOTH",
            phone: c.phone,
            email: c.email,
            address: c.address,
            contactPerson: c.contactPerson,
          },
        });

        await prisma.syncDiscrepancy.create({
          data: {
            syncJobId: syncJob.id,
            entityType: "counterparty",
            entityRef: c.code,
            entityName: c.name,
            field: "NEW",
            value1C: c.name,
            valueBudvik: "не існує",
          },
        });
        discrepancyCount++;
        created++;
        continue;
      }

      // Compare and update
      const updates: Record<string, any> = {};
      const discrepancies: { field: string; v1c: string; vBud: string }[] = [];

      if (c.phone && c.phone !== existing.phone) {
        updates.phone = c.phone;
        discrepancies.push({ field: "phone", v1c: c.phone, vBud: existing.phone || "" });
      }
      if (c.address && c.address !== existing.address) {
        updates.address = c.address;
        discrepancies.push({ field: "address", v1c: c.address, vBud: existing.address || "" });
      }
      if (c.email && c.email !== existing.email) {
        updates.email = c.email;
        discrepancies.push({ field: "email", v1c: c.email, vBud: existing.email || "" });
      }

      if (Object.keys(updates).length > 0) {
        await prisma.counterparty.update({ where: { id: existing.id }, data: updates });

        for (const d of discrepancies) {
          await prisma.syncDiscrepancy.create({
            data: {
              syncJobId: syncJob.id,
              entityType: "counterparty",
              entityRef: existing.code || c.code,
              entityName: c.name,
              field: d.field,
              value1C: d.v1c,
              valueBudvik: d.vBud,
            },
          });
          discrepancyCount++;
        }
        updated++;
      } else {
        skipped++;
      }
    } catch (e: any) {
      errors.push(`"${c.name.slice(0, 40)}": ${e.message}`);
      failed++;
    }
  }

  await prisma.syncJob.update({
    where: { id: syncJob.id },
    data: {
      status: failed > 0 && created === 0 && updated === 0 ? "failed" : "completed",
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      recordsFailed: failed,
      errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      completedAt: new Date(),
    },
  });

  return {
    syncJobId: syncJob.id,
    total: parsed.length,
    created,
    updated,
    skipped,
    failed,
    errors: errors.slice(0, 30),
    discrepancies: discrepancyCount,
  };
}
