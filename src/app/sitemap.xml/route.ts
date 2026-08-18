import { listSitemapIds, renderIndex } from "@/lib/seo/sitemap-data";

export const revalidate = 3600;

/** Індекс карт сайту — його здаємо в Search Console і вписуємо в robots.txt. */
export async function GET() {
  const ids = await listSitemapIds();
  return new Response(renderIndex(ids), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
