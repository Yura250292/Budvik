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

/** Preview counterparty sync changes — load all existing at once for speed */
export async function previewCounterpartySync(
  parsed: ParsedCounterparty[]
): Promise<CounterpartySyncPreviewResult> {
  // Load all existing counterparties at once
  const allExisting = await prisma.counterparty.findMany({
    select: { id: true, code: true, name: true, phone: true, email: true, address: true },
  });

  const byCode = new Map(allExisting.filter((c) => c.code).map((c) => [c.code!, c]));
  const byName = new Map(allExisting.map((c) => [c.name.toLowerCase(), c]));

  const items: CounterpartySyncPreviewItem[] = [];
  let toCreate = 0;
  let toUpdate = 0;
  let unchanged = 0;

  for (const c of parsed) {
    const existing = byCode.get(c.code) || byName.get(c.name.toLowerCase());

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

/** Apply counterparty sync — batch operations for speed */
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

  // Load all existing counterparties at once
  const allExisting = await prisma.counterparty.findMany({
    select: { id: true, code: true, name: true, phone: true, email: true, address: true },
  });

  const byCode = new Map(allExisting.filter((c) => c.code).map((c) => [c.code!, c]));
  const byName = new Map(allExisting.map((c) => [c.name.toLowerCase(), c]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const discrepancyBatch: any[] = [];

  // Collect creates and updates
  const toCreate: any[] = [];
  const toUpdate: { id: string; data: any; discrepancies: any[] }[] = [];

  for (const c of parsed) {
    const existing = byCode.get(c.code) || byName.get(c.name.toLowerCase());

    if (!existing) {
      toCreate.push({
        name: c.name,
        code: c.code,
        type: c.type || "BOTH",
        phone: c.phone || null,
        email: c.email || null,
        address: c.address || null,
        contactPerson: c.contactPerson || null,
      });
      discrepancyBatch.push({
        syncJobId: syncJob.id,
        entityType: "counterparty",
        entityRef: c.code,
        entityName: c.name,
        field: "NEW",
        value1C: c.name,
        valueBudvik: "не існує",
      });
      continue;
    }

    const updates: Record<string, any> = {};
    const discs: any[] = [];

    if (c.phone && c.phone !== existing.phone) {
      updates.phone = c.phone;
      discs.push({ syncJobId: syncJob.id, entityType: "counterparty", entityRef: existing.code || c.code, entityName: c.name, field: "phone", value1C: c.phone, valueBudvik: existing.phone || "" });
    }
    if (c.address && c.address !== existing.address) {
      updates.address = c.address;
      discs.push({ syncJobId: syncJob.id, entityType: "counterparty", entityRef: existing.code || c.code, entityName: c.name, field: "address", value1C: c.address, valueBudvik: existing.address || "" });
    }
    if (c.email && c.email !== existing.email) {
      updates.email = c.email;
      discs.push({ syncJobId: syncJob.id, entityType: "counterparty", entityRef: existing.code || c.code, entityName: c.name, field: "email", value1C: c.email, valueBudvik: existing.email || "" });
    }

    if (Object.keys(updates).length > 0) {
      toUpdate.push({ id: existing.id, data: updates, discrepancies: discs });
    } else {
      skipped++;
    }
  }

  // Batch create counterparties (in chunks of 100)
  const CHUNK = 100;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const chunk = toCreate.slice(i, i + CHUNK);
    try {
      // Use createMany — skip duplicates
      const result = await prisma.counterparty.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      created += result.count;
    } catch (e: any) {
      // Fallback to individual creates
      for (const item of chunk) {
        try {
          await prisma.counterparty.create({ data: item });
          created++;
        } catch (e2: any) {
          errors.push(`"${item.name.slice(0, 40)}": ${e2.message}`);
          failed++;
        }
      }
    }
  }

  // Batch updates (individual but faster since there are few)
  for (const u of toUpdate) {
    try {
      await prisma.counterparty.update({ where: { id: u.id }, data: u.data });
      discrepancyBatch.push(...u.discrepancies);
      updated++;
    } catch (e: any) {
      errors.push(`Update: ${e.message}`);
      failed++;
    }
  }

  // Batch create discrepancies
  if (discrepancyBatch.length > 0) {
    for (let i = 0; i < discrepancyBatch.length; i += CHUNK) {
      try {
        await prisma.syncDiscrepancy.createMany({
          data: discrepancyBatch.slice(i, i + CHUNK),
        });
      } catch {}
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
    discrepancies: discrepancyBatch.length,
  };
}
