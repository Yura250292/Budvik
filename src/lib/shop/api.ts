/**
 * Спільна обв'язка роутів застосунку покупця.
 *
 * Тримається окремо від src/app/api/v1/, бо все під app/api Next вважає
 * роутом — допоміжний модуль там перетворився б на ендпоінт.
 */

import { NextResponse } from "next/server";
import { verifyShopToken, type ShopIdentity } from "@/lib/shop/app-token";
import { productLabel } from "@/lib/catalog/category-display";

/**
 * Картка товару в тому вигляді, в якому її бачить застосунок.
 *
 * Форма зафіксована тут і тільки тут: установлений застосунок не можна
 * оновити примусово, тож будь-яка зміна цієї структури мусить лишатися
 * сумісною зі старими збірками — або їхати під /api/v2/.
 */
export type CardDto = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  /** Ціна, яку показувати. Уже з урахуванням акції. */
  price: number;
  /** Базова ціна, якщо вона вища за price — для закресленої. */
  basePrice: number | null;
  promoLabel: string | null;
  stock: number;
  image: string | null;
  packQty: number | null;
  brand: string | null;
  /**
   * Ярлик над назвою: категорія, якщо вона осмислена, інакше бренд.
   *
   * Сирої категорії тут немає навмисно — 84% товарів лежать у звалищі
   * «Імпорт з 1С», а решта службових груп називається числами («1964»).
   * Показати таке покупцеві означало б підписати дриль номером вузла дерева 1С.
   */
  label: string | null;
};

type CardRow = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  isPromo: boolean;
  promoPrice: number | null;
  promoLabel: string | null;
  stock: number;
  image: string | null;
  packQty: number | null;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string } | null;
};

/**
 * Рядок бази → картка застосунку.
 *
 * Порядок цін той самий, що й у createOrder: акція б'є базову. Оптова знижка
 * тут не рахується свідомо — вона залежить від ролі й береться окремим
 * запитом, а ця функція має лишатися чистою і придатною для кешованої видачі.
 */
export function serializeCard(p: CardRow): CardDto {
  const promo = p.isPromo && p.promoPrice ? p.promoPrice : null;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    price: promo ?? p.price,
    basePrice: promo ? p.price : null,
    promoLabel: promo ? p.promoLabel : null,
    stock: p.stock,
    image: p.image,
    packQty: p.packQty,
    brand: p.brand?.name ?? null,
    label: productLabel(p.category, p.brand),
  };
}

/** 401 однаковою відповіддю на будь-яку причину — щоб не підказувати, що саме не так. */
export function unauthorized() {
  return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });
}

/**
 * Хто робить запит. null — гість, і це нормальний випадок:
 * каталог, пошук і навіть оформлення замовлення працюють без входу.
 */
export async function shopIdentity(req: Request): Promise<ShopIdentity | null> {
  return verifyShopToken(req.headers.get("authorization"));
}
