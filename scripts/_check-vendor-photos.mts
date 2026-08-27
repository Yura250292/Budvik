import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const ps = await prisma.product.findMany({ where: { image: { contains: "/site-2026-" } }, select: { sku: true, name: true, image: true }, take: 8, orderBy: { stock: "desc" } });
for (const p of ps) {
  const r = await fetch(p.image!, { method: "HEAD" });
  console.log(`${r.status} ${r.headers.get("content-type")} ${String(r.headers.get("content-length")).padStart(8)}  ${p.sku}  ${p.name.slice(0, 55)}`);
}
await prisma.$disconnect();
