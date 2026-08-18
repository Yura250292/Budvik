import { sitemapEntries, renderUrlset } from "@/lib/seo/sitemap-data";

export const revalidate = 3600;

/** Окремий файл карти сайту: /sitemaps/core.xml, /sitemaps/products-0.xml… */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id.endsWith(".xml")) return new Response("Not found", { status: 404 });

  const entries = await sitemapEntries(id.slice(0, -4));
  if (!entries) return new Response("Not found", { status: 404 });

  return new Response(renderUrlset(entries), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
