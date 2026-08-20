// Свіжість дає обмін з 1С (скидає ці сторінки в sync-ingest), тож часове
// вікно — лише страховка, а не джерело оновлень.
export const revalidate = 3600;

import type { Metadata } from "next";
import BrandLanding, { buildBrandMetadata } from "./_landing";

/**
 * Сторінка бренда — комерційний лендінг під запити «інструменти YATO»,
 * «Grösser ціни» тощо. Рендер — у `_landing`, спільний із пагінацією.
 *
 * Порожній generateStaticParams обов'язковий: без нього Next 16 не кладе
 * динамічний сегмент в ISR узагалі й рендерить наживо на кожен запит (та сама
 * пастка, що спіймала нас на картках товарів).
 */

type Params = Promise<{ slug: string }>;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return buildBrandMetadata(slug, 1);
}

export default async function BrandPage({ params }: { params: Params }) {
  const { slug } = await params;
  return <BrandLanding slug={slug} page={1} />;
}
