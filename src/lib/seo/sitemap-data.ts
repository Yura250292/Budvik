import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/seo/site";
import { indexableProductWhere } from "@/lib/seo/indexable";
import { getBrandTree } from "@/lib/catalog/brand-tree";
import { getCatalogToc } from "@/lib/catalog/sections";

/**
 * Дані карт сайту: «core» — сторінки-хаби (головна, каталог, бренди, типи),
 * «products-N» — товари шматками по 20 тис. Google приймає до 50 тис. URL
 * на файл, але менші файли швидше перегенеровуються і зручніше
 * діагностуються в Search Console.
 *
 * Роздаються власними роутами /sitemap.xml (індекс) і /sitemaps/<id>.xml,
 * а не через metadata-конвенцію app/sitemap.ts: та не збирає індексний
 * файл для generateSitemaps, а сусідній роут з іменем sitemap.xml валить
 * її збірку.
 */
export const SITEMAP_CHUNK = 20000;

export interface SitemapEntry {
  url: string;
  lastModified?: Date;
}

export async function listSitemapIds(): Promise<string[]> {
  const total = await prisma.product.count({ where: indexableProductWhere() });
  const chunks = Math.max(1, Math.ceil(total / SITEMAP_CHUNK));
  return ["core", ...Array.from({ length: chunks }, (_, i) => `products-${i}`)];
}

export async function sitemapEntries(id: string): Promise<SitemapEntry[] | null> {
  if (id === "core") return coreEntries();

  const match = id.match(/^products-(\d+)$/);
  if (!match) return null;
  const chunk = Number(match[1]);

  // Стабільний порядок по id: між перегенераціями товар не має стрибати
  // з файла у файл, інакше Google бачить «зниклі» URL.
  const products = await prisma.product.findMany({
    where: indexableProductWhere(),
    select: { slug: true, updatedAt: true },
    orderBy: { id: "asc" },
    skip: chunk * SITEMAP_CHUNK,
    take: SITEMAP_CHUNK,
  });

  // Номер за межами наявних чанків — 404, а не порожній валідний файл.
  if (products.length === 0 && chunk > 0) return null;

  return products.map((p) => ({
    url: absoluteUrl(`/catalog/${p.slug}`),
    lastModified: p.updatedAt,
  }));
}

async function coreEntries(): Promise<SitemapEntry[]> {
  const [tree, toc] = await Promise.all([getBrandTree(), getCatalogToc()]);

  // Сторінки брендів — лише «головні» (від 20 товарів): дрібний бренд на
  // 2 позиції — така сама тонка сторінка, як порожній товар.
  // Сторінки типів — рядки змісту каталогу: «валик», «перфоратор» тощо.
  const typeLines = [...toc.sections.flatMap((s) => s.lines), ...toc.other];

  return [
    { url: absoluteUrl("/") },
    { url: absoluteUrl("/catalog") },
    { url: absoluteUrl("/catalog/zmist") },
    ...tree.main.map((b) => ({ url: absoluteUrl(`/brand/${b.slug}`) })),
    ...typeLines.map((line) => ({
      url: absoluteUrl(`/catalog/typ/${encodeURIComponent(line.key)}`),
    })),
  ];
}

export function renderUrlset(entries: SitemapEntry[]): string {
  const items = entries
    .map(
      (e) =>
        `  <url><loc>${escapeXml(e.url)}</loc>${
          e.lastModified ? `<lastmod>${e.lastModified.toISOString()}</lastmod>` : ""
        }</url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>`;
}

export function renderIndex(ids: string[]): string {
  const items = ids
    .map((id) => `  <sitemap><loc>${absoluteUrl(`/sitemaps/${id}.xml`)}</loc></sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</sitemapindex>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");
}
