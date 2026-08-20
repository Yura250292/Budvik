export const revalidate = 3600;

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import TypeLanding, { buildTypeMetadata, parseType, typeBasePath } from "../../_landing";

/**
 * Друга й наступні сторінки типу товару. Сегмент шляху замість `?page=N` —
 * щоб маршрут лишався кешованим.
 */

type Params = Promise<{ type: string; page: string }>;

/** Без цього Next 16 не покладе сегмент в ISR. Див. коментар у ../../page.tsx. */
export async function generateStaticParams(): Promise<{ type: string; page: string }[]> {
  return [];
}

/** Лише ціле число до 999: глибші сторінки — сміття в індексі, а не навігація. */
function parsePage(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 1 ? page : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { type, page: rawPage } = await params;
  const page = parsePage(rawPage);
  if (!page) notFound();
  return buildTypeMetadata(type, page);
}

export default async function TypePagedPage({ params }: { params: Params }) {
  const { type: raw, page: rawPage } = await params;
  const page = parsePage(rawPage);
  if (!page) notFound();

  // /storinka/1 — та сама перша сторінка; сюди ж потрапляє старе ?page=1.
  if (page === 1) {
    const type = parseType(raw);
    if (!type) notFound();
    redirect(typeBasePath(type));
  }

  return <TypeLanding raw={raw} page={page} />;
}
