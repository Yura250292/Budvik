// Свіжість дає обмін з 1С (скидає ці сторінки в sync-ingest), тож часове
// вікно — лише страховка, а не джерело оновлень.
export const revalidate = 3600;

import type { Metadata } from "next";
import TypeLanding, { buildTypeMetadata } from "./_landing";

/**
 * Сторінка типу товару — лендінг під запити «валик купити», «перфоратори
 * ціна» тощо. Тип — це той самий токен, що в змісті каталогу (productType):
 * рядки /catalog/zmist ведуть сюди, на чисті індексовані URL, а не в
 * query-фільтр.
 *
 * Тип приходить кирилицею прямо в URL — Google нормально індексує і показує
 * кириличні адреси, а людині /catalog/typ/валик каже більше за трансліт.
 *
 * Порожній generateStaticParams обов'язковий: без нього Next 16 не кладе
 * динамічний сегмент в ISR і рендерить наживо на кожен запит.
 */

type Params = Promise<{ type: string }>;

export async function generateStaticParams(): Promise<{ type: string }[]> {
  return [];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { type } = await params;
  return buildTypeMetadata(type, 1);
}

export default async function TypePage({ params }: { params: Params }) {
  const { type } = await params;
  return <TypeLanding raw={type} page={1} />;
}
