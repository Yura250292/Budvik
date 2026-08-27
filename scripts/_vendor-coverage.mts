/** Скільки карток закрили фото з сайтів виробників. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows: any[] = await prisma.$queryRawUnsafe(`
  SELECT b.slug, b.name,
    COUNT(*) FILTER (WHERE p."isActive")::int AS active,
    COUNT(*) FILTER (WHERE p."isActive" AND (p.image IS NULL OR p.image=''))::int AS no_photo,
    COUNT(*) FILTER (WHERE p."isActive" AND p.stock>0 AND (p.image IS NULL OR p.image=''))::int AS no_photo_instock,
    COUNT(*) FILTER (WHERE p.image LIKE '%/site-2026-%')::int AS from_site
  FROM "Brand" b JOIN "Product" p ON p."brandId"=b.id
  WHERE b.slug IN ('apro','syla','makita','polax','ultra','gradient','rhino')
  GROUP BY b.slug, b.name ORDER BY from_site DESC`);
console.log("бренд".padEnd(12), "активних".padStart(9), "без фото".padStart(9), "з них у наявн.".padStart(15), "нових з сайту".padStart(14));
for (const r of rows) console.log(r.name.padEnd(12), String(r.active).padStart(9), String(r.no_photo).padStart(9), String(r.no_photo_instock).padStart(15), String(r.from_site).padStart(14));
const t: any[] = await prisma.$queryRawUnsafe(`
  SELECT COUNT(*) FILTER (WHERE p."isActive" AND (p.image IS NULL OR p.image=''))::int AS no_photo,
         COUNT(*) FILTER (WHERE p."isActive" AND p.stock>0 AND (p.image IS NULL OR p.image=''))::int AS instock,
         COUNT(*) FILTER (WHERE p.image LIKE '%/site-2026-%')::int AS from_site
  FROM "Product" p WHERE p."isActive"`);
console.log(`\nПо всьому каталогу: без фото ${t[0].no_photo} (у наявності ${t[0].instock}); поставлено з сайтів виробників ${t[0].from_site}`);
await prisma.$disconnect();
