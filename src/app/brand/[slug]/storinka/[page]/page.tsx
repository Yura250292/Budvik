export const revalidate = 3600;

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import BrandLanding, { brandBasePath, buildBrandMetadata } from "../../_landing";

/**
 * Друга й наступні сторінки бренда.
 *
 * Окремий сегмент шляху замість `?page=N` — щоб сторінка кешувалась: читання
 * `searchParams` робить динамічним увесь маршрут, включно з першою сторінкою.
 */

type Params = Promise<{ slug: string; page: string }>;

/** Без цього Next 16 не покладе сегмент в ISR. Див. коментар у ../../page.tsx. */
export async function generateStaticParams(): Promise<{ slug: string; page: string }[]> {
  return [];
}

/** Лише ціле число до 999: глибші сторінки — сміття в індексі, а не навігація. */
function parsePage(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 1 ? page : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, page: rawPage } = await params;
  const page = parsePage(rawPage);
  if (!page) notFound();
  return buildBrandMetadata(slug, page);
}

export default async function BrandPagedPage({ params }: { params: Params }) {
  const { slug, page: rawPage } = await params;
  const page = parsePage(rawPage);
  if (!page) notFound();
  // /storinka/1 — це та сама перша сторінка; тримати дві адреси з однаковим
  // вмістом немає за що. Сюди потрапляє старе посилання ?page=1.
  if (page === 1) redirect(brandBasePath(slug));

  return <BrandLanding slug={slug} page={page} />;
}
