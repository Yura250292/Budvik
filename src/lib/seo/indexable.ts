import type { Prisma } from "@prisma/client";

/**
 * «Товар, вартий індексу Google»: ціна, фото і опис.
 *
 * З 49 тис. активних позицій таких ~27 тис. Решта — службові рядки-групи з
 * 1С (ціна 0) і позиції без фото чи опису: тисячі порожніх сторінок у
 * індексі тягнуть вниз оцінку всього сайту, тож вони не потрапляють у
 * sitemap і отримують noindex на сторінці.
 *
 * Це навмисно м'якший фільтр за showableProductWhere(): товар без залишку
 * лишається в індексі — сторінка «немає в наявності» з цінами і схожими
 * товарами все ще корисна людині, що шукає конкретну модель.
 */
export function indexableProductWhere(): Prisma.ProductWhereInput {
  return {
    isActive: true,
    price: { gt: 0 },
    AND: [{ image: { not: null } }, { NOT: { image: "" } }, { NOT: { description: "" } }],
  };
}

export function isIndexableProduct(p: {
  isActive: boolean;
  price: number;
  image: string | null;
  description: string;
}): boolean {
  return p.isActive && p.price > 0 && !!p.image && p.description.trim() !== "";
}
