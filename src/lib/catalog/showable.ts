import type { Prisma } from "@prisma/client";

/**
 * Prisma-фрагмент «товар, який можна показувати покупцеві».
 *
 * З 1С разом із товарами приїжджають службові рядки-групи («01.03.02. Бури
 * для бетону SDS-plus») — вони активні, але з ціною 0, без залишку і фото.
 * Рекомендаційні блоки, які фільтрували лише за isActive, показували саме їх.
 *
 * Функція, а не константа: `AND` має бути мутабельним масивом, інакше
 * Prisma не приймає where-об'єкт.
 */
export function showableProductWhere(): Prisma.ProductWhereInput {
  return {
    isActive: true,
    stock: { gt: 0 },
    price: { gt: 0 },
    AND: [{ image: { not: null } }, { NOT: { image: "" } }],
  };
}
