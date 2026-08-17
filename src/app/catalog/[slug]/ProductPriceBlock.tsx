"use client";

import { useSession } from "next-auth/react";
import { formatPrice } from "@/lib/utils";
import { useWholesaleDiscounts } from "@/lib/useWholesaleDiscounts";
import { getWholesalePrice } from "@/lib/wholesale-price-calc";
import AddToCartButton from "./AddToCartButton";

interface Props {
  id: string;
  name: string;
  slug: string;
  price: number;
  isPromo: boolean;
  promoPrice: number | null;
  promoLabel: string | null;
  stock: number;
  image: string | null;
  packQty: number | null;
}

/**
 * Ціна, наявність і кошик — клієнтська частина картки товару.
 *
 * Виділено з серверної сторінки, щоб та могла кешуватись: getServerSession
 * читає cookies і мовчки вимикає ISR. Сервер рендерить роздрібну ціну для
 * всіх, а оптовик бачить свою знижку після гідрації — це ті самі дані, що
 * раніше рахував сервер, лише взяті з /api/wholesale/discounts.
 */
export default function ProductPriceBlock({
  id,
  name,
  slug,
  price,
  isPromo,
  promoPrice,
  promoLabel,
  stock,
  image,
  packQty,
}: Props) {
  const { data: session } = useSession();
  const isWholesale = (session?.user as { role?: string } | undefined)?.role === "WHOLESALE";
  const discounts = useWholesaleDiscounts();

  const basePrice =
    isWholesale && discounts ? getWholesalePrice(price, name, discounts) : price;
  const displayPrice = isPromo && promoPrice ? promoPrice : basePrice;

  return (
    <div className="bg-g50 rounded-xl p-4 sm:p-5 mb-5 border border-g100">
      <div className="flex items-baseline gap-2 sm:gap-3 mb-3 flex-wrap">
        <span className="text-2xl sm:text-4xl font-bold text-[#0A0A0A]">
          {formatPrice(displayPrice)}
        </span>
        {isPromo && promoPrice && promoPrice < price && (
          <>
            <span className="text-lg text-g400 line-through">{formatPrice(price)}</span>
            <span className="text-sm bg-primary/15 text-primary-dark px-2 py-0.5 rounded-full font-medium">
              {promoLabel || `- ${Math.round((1 - promoPrice / price) * 100)}%`}
            </span>
          </>
        )}
        {isWholesale && basePrice < price && !isPromo && (
          <>
            <span className="text-lg text-g400 line-through">{formatPrice(price)}</span>
            <span className="text-sm bg-primary/15 text-primary-dark px-2 py-0.5 rounded-full font-medium">Оптова ціна</span>
          </>
        )}
      </div>

      <div className="mb-3">
        {stock > 0 ? (
          <span className="inline-flex items-center gap-1 text-green-600 text-sm font-medium">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {isWholesale ? `В наявності (${stock} шт.)` : "В наявності"}
          </span>
        ) : (
          <span className="text-red-500 text-sm font-medium">Немає в наявності</span>
        )}
      </div>

      {stock > 0 && (
        <AddToCartButton
          productId={id}
          name={name}
          price={displayPrice}
          slug={slug}
          image={image}
          packQty={packQty}
        />
      )}

      {/* Рядок кешбеку в Болтах прихований разом із програмою лояльності. */}
    </div>
  );
}
