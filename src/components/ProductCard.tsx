"use client";

import Link from "next/link";
import Image from "next/image";
import NoPhoto from "@/components/ui/NoPhoto";
import { useState, useEffect } from "react";
import { formatPrice } from "@/lib/utils";
import { addToCart } from "@/lib/cart";
import { flyToCart } from "@/lib/fly-to-cart";
import { tiltMove, tiltReset } from "@/lib/tilt";
import { toggleWishlist, isInWishlist } from "@/lib/wishlist";
import { toggleCompare, isInCompare } from "@/lib/compare";
import { useSession } from "next-auth/react";
import { useWholesaleDiscounts } from "@/lib/useWholesaleDiscounts";
import { getWholesalePrice } from "@/lib/wholesale-price-calc";
import { productLabel } from "@/lib/catalog/category-display";

type ViewMode = "grid" | "list" | "gallery";

interface ProductCardProps {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  wholesalePrice?: number | null;
  isPromo?: boolean;
  promoPrice?: number | null;
  promoLabel?: string | null;
  stock: number;
  image?: string | null;
  category?: { name: string };
  brand?: { name: string } | null;
  viewMode?: ViewMode;
}

export default function ProductCard({ id, name, slug, description, price, wholesalePrice, isPromo, promoPrice, promoLabel, stock, image, category, brand, viewMode = "grid" }: ProductCardProps) {
  const label = productLabel(category, brand);
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const isWholesale = role === "WHOLESALE";
  // Оптова ціна: або прийшла вже порахованою (кабінети зі своїм API), або
  // рахуємо на клієнті зі знижок по бренду — кешований каталог сесії не
  // бачить і передати її з сервера не може.
  const discounts = useWholesaleDiscounts();
  const effectiveWholesale =
    wholesalePrice ?? (isWholesale && discounts ? getWholesalePrice(price, name, discounts) : null);
  const basePrice = isWholesale && effectiveWholesale ? effectiveWholesale : price;
  const displayPrice = isPromo && promoPrice ? promoPrice : basePrice;
  const hasDiscount = displayPrice < price;
  /**
   * Розмір знижки у відсотках — саме те число, яке шукає око на вітрині.
   * Округлення вниз: «−26%» на 26,8% чесніше за «−27%», якого покупець при
   * перевірці не побачить.
   */
  const discountPercent = hasDiscount ? Math.floor(((price - displayPrice) / price) * 100) : 0;
  // Нуль означає «1С не дала ціни», а не «безкоштовно»: обмін бере роздріб
  // лише з типу цін «6.МАГАЗИНИ», і там, де його не ведуть (Polax із 2022-го,
  // TOTAL узагалі), товар приїжджає з нулем. Раніше такий лежав на вітрині як
  // «0 ₴» з живою кнопкою «У кошик» — 1182 позиції на складі можна було
  // замовити задарма. Серверна перевірка в createOrder тепер їх ловить, але
  // показувати покупцеві ціну, якої немає, все одно не можна.
  const priceKnown = displayPrice > 0;
  const canBuy = stock > 0 && priceKnown;

  /**
   * Знімок не завантажився.
   *
   * Поле image — довільний https-адрес, і частина посилань веде на сайти
   * постачальників: sigma.ua закриває гарячі посилання, тож оптимізатор Next
   * отримує 400, а картка показує піктограму битого зображення з альтернативним
   * написом, який розпирає верстку. Заглушка «немає фото» виглядає як свідоме
   * рішення, а не як зламаний сайт.
   */
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(image) && !imgFailed;

  const [inWishlist, setInWishlist] = useState(false);
  const [inCompare, setInCompare] = useState(false);
  const [compareFull, setCompareFull] = useState(false);
  // Короткі one-shot анімації: галочка на кнопці кошика і «вибух» серця
  const [added, setAdded] = useState(false);
  const [heartBurst, setHeartBurst] = useState(false);

  useEffect(() => {
    setInWishlist(isInWishlist(id));
    setInCompare(isInCompare(id));
    const onW = () => setInWishlist(isInWishlist(id));
    const onC = () => setInCompare(isInCompare(id));
    window.addEventListener("wishlist-updated", onW);
    window.addEventListener("compare-updated", onC);
    return () => {
      window.removeEventListener("wishlist-updated", onW);
      window.removeEventListener("compare-updated", onC);
    };
  }, [id]);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    flyToCart(e.currentTarget as HTMLElement);
    addToCart({ productId: id, name, price: displayPrice, slug, image });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1200);
  };

  const handleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    // «Вибух» лише при додаванні — зняття з обраного не святкуємо
    if (!inWishlist) {
      setHeartBurst(true);
      window.setTimeout(() => setHeartBurst(false), 500);
    }
    toggleWishlist({ productId: id, name, slug, price: displayPrice, image });
  };

  // Вміст кнопки «У кошик» спільний для всіх трьох виглядів картки
  const cartBtnContent = added ? (
    <span className="btn-added-pop inline-flex items-center justify-center gap-1">
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      Додано
    </span>
  ) : (
    "У кошик"
  );

  const handleCompare = (e: React.MouseEvent) => {
    e.preventDefault();
    const result = toggleCompare({ productId: id, name, slug, price: displayPrice, image, category: category?.name, description: description.replace(/<[^>]*>/g, '').slice(0, 200) });
    if (result.full) {
      setCompareFull(true);
      setTimeout(() => setCompareFull(false), 2000);
    }
  };

  const plainDesc = description.replace(/<[^>]*>/g, '');

  // ── LIST VIEW ──
  if (viewMode === "list") {
    return (
      <Link href={`/catalog/${slug}`} className="group block reveal">
        <div className={`flex rounded-xl overflow-hidden border transition-[box-shadow,border-color] duration-150 ${
          stock > 0
            ? "border-[#EFEFEF] bg-white hover:shadow-md"
            : "border-[#EFEFEF] bg-[#FAFAFA] opacity-60"
        }`}>
          {/* Thumbnail */}
          <div className={`w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 flex items-center justify-center relative ${stock > 0 ? "bg-[#FAFAFA]" : "bg-[#EFEFEF]"}`}>
            {showImage ? (
              <Image src={image!} alt={name} onError={() => setImgFailed(true)} className="h-full w-full object-contain p-1.5" width={96} height={96} loading="lazy" sizes="96px" />
            ) : (
              <NoPhoto label={label} size="sm" />
            )}
            {isPromo && stock > 0 && (
              <span className="absolute top-1 left-1 bg-[#0A0A0A] text-[#FFD600] text-[7px] font-bold px-1 py-0.5 rounded">
                {promoLabel || "Акція"}
              </span>
            )}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0 p-2 sm:p-3 flex flex-col justify-between">
            <div>
              <h3 className={`text-xs sm:text-sm font-semibold line-clamp-1 transition ${stock > 0 ? "text-[#0A0A0A] group-hover:text-[#FFB800]" : "text-[#9E9E9E]"}`}>
                {name}
              </h3>
              <p className="text-[10px] sm:text-xs text-[#777] line-clamp-1 mt-0.5">{plainDesc}</p>
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-baseline gap-1 flex-wrap">
                {priceKnown ? (
                  <>
                    <span className={`text-sm sm:text-base font-bold ${stock === 0 ? "text-[#9E9E9E]" : "text-[#0A0A0A]"}`}>
                      {formatPrice(displayPrice)}
                    </span>
                    {hasDiscount && (
                      <span className="text-[9px] sm:text-xs text-[#9E9E9E] line-through">{formatPrice(price)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-[#BDBDBD]">Ціна не вказана</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {stock > 0 && (
                  <>
                    <button onClick={handleWishlist} className={`w-6 h-6 rounded-full flex items-center justify-center transition ${inWishlist ? "text-red-500" : "text-[#BDBDBD] hover:text-red-400"}${heartBurst ? " heart-burst" : ""}`}>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={inWishlist ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    </button>
                    {priceKnown && (
                      <button onClick={handleAddToCart} className="btn-primary px-2.5 py-1 text-[10px] sm:text-xs">
                        {cartBtnContent}
                      </button>
                    )}
                  </>
                )}
                {stock === 0 && <span className="text-[10px] text-[#9E9E9E]">Немає</span>}
              </div>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // ── GALLERY VIEW ──
  if (viewMode === "gallery") {
    return (
      <Link href={`/catalog/${slug}`} className="group block reveal">
        <div className={`rounded-xl overflow-hidden border transition-[box-shadow,border-color,transform] duration-300 ease-out-expo ${
          stock > 0
            ? "border-[#EFEFEF] bg-white shadow-card hover:shadow-card-glow hover:border-[#FFD600]/60 hover:-translate-y-0.5"
            : "border-[#EFEFEF] bg-[#FAFAFA] opacity-60"
        }`}>
          {/* Large image */}
          <div className={`h-52 sm:h-72 flex items-center justify-center relative ${stock > 0 ? "bg-[#FAFAFA]" : "bg-[#EFEFEF]"}`} onMouseMove={tiltMove} onMouseLeave={tiltReset}>
            {showImage ? (
              <Image src={image!} alt={name} onError={() => setImgFailed(true)} className="h-full w-full object-contain p-4 transition-transform duration-500 ease-out-expo group-hover:scale-105" width={288} height={288} loading="lazy" sizes="288px" />
            ) : (
              <NoPhoto label={label} size="md" />
            )}
            {isPromo && stock > 0 && (
              <span className="absolute top-2 left-2 bg-[#0A0A0A] text-[#FFD600] text-xs font-bold px-2.5 py-1 rounded-lg">
                {promoLabel || "Акція"}
              </span>
            )}
            {/* Action buttons */}
            {stock > 0 && (
              <div className="absolute top-2 right-2 flex flex-col gap-1.5">
                <button onClick={handleWishlist} className={`w-8 h-8 rounded-full flex items-center justify-center transition-[background-color,color,box-shadow] duration-150 ${inWishlist ? "bg-red-500 text-white shadow-md" : "bg-white/90 text-[#9E9E9E] hover:text-red-500 shadow-sm"}${heartBurst ? " heart-burst" : ""}`}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill={inWishlist ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
                <button onClick={handleCompare} className={`w-8 h-8 rounded-full flex items-center justify-center transition-[background-color,color,box-shadow] duration-150 relative ${inCompare ? "bg-[#FFD600] text-[#0A0A0A] shadow-md" : "bg-white/90 text-[#9E9E9E] hover:text-[#FFD600] shadow-sm"}`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {/* Info */}
          <div className="p-3 sm:p-5">
            {label && (
              <span className="inline-block text-[10px] sm:text-xs text-[#9E9E9E] bg-[#F0F0F0] px-2 py-0.5 rounded-md mb-2 font-medium">{label}</span>
            )}
            <h3 className={`text-sm sm:text-lg font-semibold mb-1 transition ${stock > 0 ? "text-[#0A0A0A] group-hover:text-[#FFB800]" : "text-[#9E9E9E]"}`}>
              {name}
            </h3>
            <p className="text-xs sm:text-sm text-[#555] mb-3 line-clamp-2">{plainDesc}</p>
            <div className="flex items-center justify-between">
              <div>
                {priceKnown ? (
                  <>
                    <span className={`text-base sm:text-xl font-bold ${stock === 0 ? "text-[#9E9E9E]" : "text-[#0A0A0A]"}`}>
                      {formatPrice(displayPrice)}
                    </span>
                    {hasDiscount && (
                      <span className="text-[10px] sm:text-xs text-[#9E9E9E] line-through ml-1">{formatPrice(price)}</span>
                    )}
                    {isWholesale && effectiveWholesale != null && effectiveWholesale < price && !isPromo && (
                      <span className="block text-[10px] sm:text-xs text-[#FFB800] font-medium">Оптова ціна</span>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-[#BDBDBD]">Ціна не вказана</span>
                )}
              </div>
              {canBuy ? (
                <button onClick={handleAddToCart} className="btn-primary px-3 py-1.5 text-xs flex-shrink-0">
                  {cartBtnContent}
                </button>
              ) : stock > 0 ? (
                <span className="text-sm text-[#9E9E9E] font-medium">Ціну уточнюйте</span>
              ) : (
                <span className="text-sm text-[#9E9E9E] font-medium">Немає в наявності</span>
              )}
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // ── GRID VIEW (default) ──
  return (
    <Link href={`/catalog/${slug}`} className="group reveal block h-full">
      {/* Колонка на всю висоту комірки: інакше в ряді з різними назвами кнопки
          «У кошик» стоять на різній висоті й ряд виглядає розваленим. */}
      <div className={`flex h-full flex-col overflow-hidden rounded-xl border transition-[box-shadow,border-color,transform] duration-300 ease-out-expo ${
        stock > 0
          ? "border-[#EFEFEF] bg-white shadow-card hover:shadow-card-glow hover:border-[#FFD600]/60 hover:-translate-y-1"
          : "border-[#EFEFEF] bg-[#FAFAFA] opacity-60"
      }`}
      >
        {/* Фото */}
        <div className={`relative flex h-36 items-center justify-center sm:h-48 ${stock > 0 ? "bg-[#FAFAFA]" : "bg-[#EFEFEF]"}`} onMouseMove={tiltMove} onMouseLeave={tiltReset}>
          {showImage ? (
            <Image
              src={image!}
              alt={name}
              onError={() => setImgFailed(true)}
              className="h-full w-full object-contain p-2 transition-transform duration-500 ease-out-expo group-hover:scale-105"
              width={192}
              height={192}
              loading="lazy"
              sizes="192px"
            />
          ) : (
            <NoPhoto label={label} size="md" />
          )}

          {/* Мітки зліва: спершу розмір знижки, далі назва акції.
              Відсоток читається швидше за слово «Акція» — він одразу
              відповідає на питання «наскільки дешевше». */}
          <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1 sm:left-2 sm:top-2">
            {discountPercent > 0 && stock > 0 && (
              <span className="rounded-md bg-[#E53935] px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white sm:px-2 sm:py-1 sm:text-xs">
                −{discountPercent}%
              </span>
            )}
            {isPromo && stock > 0 && (
              <span className="rounded-md bg-[#0A0A0A] px-1.5 py-0.5 text-[9px] font-bold leading-none text-[#FFD600] sm:px-2 sm:py-1 sm:text-[11px]">
                {promoLabel || "Акція"}
              </span>
            )}
          </div>

          {/* Обране й порівняння — в рядок, а не стовпчиком: два кружечки
              один під одним читались як вертикальне меню й тягли око вниз,
              повз товар. */}
          {stock > 0 && (
            <div className="absolute right-1.5 top-1.5 flex gap-1 sm:right-2 sm:top-2">
              <button
                onClick={handleWishlist}
                aria-label={inWishlist ? "Видалити з обраного" : "Додати в обране"}
                aria-pressed={inWishlist}
                className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 sm:h-8 sm:w-8 ${
                  inWishlist
                    ? "bg-red-500 text-white shadow-md"
                    : "bg-white/95 text-[#9E9E9E] shadow-sm hover:text-red-500"
                }${heartBurst ? " heart-burst" : ""}`}
                title={inWishlist ? "Видалити з обраного" : "Додати в обране"}
              >
                <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" viewBox="0 0 24 24" fill={inWishlist ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
              <button
                onClick={handleCompare}
                aria-label={inCompare ? "Видалити з порівняння" : "Додати до порівняння"}
                aria-pressed={inCompare}
                className={`relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 sm:h-8 sm:w-8 ${
                  inCompare
                    ? "bg-[#FFD600] text-[#0A0A0A] shadow-md"
                    : "bg-white/95 text-[#9E9E9E] shadow-sm hover:text-[#FFB800]"
                }`}
                title={inCompare ? "Видалити з порівняння" : "Додати до порівняння"}
              >
                <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                </svg>
                {compareFull && (
                  <span className="absolute -bottom-8 right-0 whitespace-nowrap rounded bg-[#0A0A0A] px-2 py-1 text-[10px] text-white">
                    Макс. 4
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

        {/*
          Опису тут більше немає. Два рядки обрізаного тексту з 1С («Акумуляторний
          тример призначений для косіння трави та догляду за…») не допомагають
          обрати між двома тримерами — вони лише відсувають ціну й кнопку вниз.
          У великих магазинах техніки картка показує назву, ціну і дію; опис
          читають уже на сторінці товару, коли вибір звузився.
        */}
        <div className="flex flex-1 flex-col p-2.5 sm:p-3.5">
          {label && (
            <span className="mb-1 inline-block max-w-full truncate rounded bg-[#F0F0F0] px-1 py-0.5 text-[8px] font-medium text-[#9E9E9E] sm:px-2 sm:text-[11px]">
              {label}
            </span>
          )}

          <h3 className={`mb-2 line-clamp-2 min-h-[32px] text-xs font-semibold leading-tight transition-colors duration-200 sm:min-h-[38px] sm:text-[15px] sm:leading-snug ${
            stock > 0 ? "text-[#0A0A0A] group-hover:text-[#FFB800]" : "text-[#9E9E9E]"
          }`}>
            {name}
          </h3>

          {/* Наявність: покупець вирішує, чи взагалі варто читати ціну.
              Раніше «немає в наявності» стояло на місці кнопки — тобто про
              це дізнавались останнім, уже прицілившись купити. */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${stock > 0 ? "bg-[#16A34A]" : "bg-[#C9C9C9]"}`} />
            <span className={`text-[10px] font-medium sm:text-[11px] ${stock > 0 ? "text-[#16A34A]" : "text-[#9E9E9E]"}`}>
              {stock > 0 ? (stock <= 5 ? `Залишилось ${stock} шт.` : "В наявності") : "Немає в наявності"}
            </span>
          </div>

          {/* Ціна — головне число картки, тож найбільший кегль у ній.
              Стара ціна над новою, а не поруч: поруч вона зливалась із новою
              в один довгий рядок дрібних цифр. */}
          <div className="mt-auto">
            {priceKnown ? (
              <>
                {hasDiscount && (
                  <span className="block text-[10px] leading-none text-[#9E9E9E] line-through sm:text-xs">
                    {formatPrice(price)}
                  </span>
                )}
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-[17px] font-extrabold leading-tight tracking-tight sm:text-xl ${
                    stock === 0 ? "text-[#9E9E9E]" : hasDiscount ? "text-[#E53935]" : "text-[#0A0A0A]"
                  }`}>
                    {formatPrice(displayPrice)}
                  </span>
                  {isWholesale && effectiveWholesale != null && effectiveWholesale < price && !isPromo && (
                    <span className="text-[9px] font-semibold text-[#FFB800] sm:text-[10px]">опт</span>
                  )}
                </div>
              </>
            ) : (
              <span className="text-[11px] text-[#BDBDBD] sm:text-sm">Ціна не вказана</span>
            )}

            {canBuy ? (
              <button
                onClick={handleAddToCart}
                className="btn-primary mt-2 w-full cursor-pointer py-2 text-[11px] sm:text-xs"
              >
                {cartBtnContent}
              </button>
            ) : (
              <span className="mt-2 flex min-h-9 w-full items-center justify-center rounded-[10px] border border-[#E5E5E5] bg-[#FAFAFA] text-[10px] font-medium text-[#9E9E9E] sm:text-xs">
                {stock > 0 ? "Ціну уточнюйте" : "Немає в наявності"}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
