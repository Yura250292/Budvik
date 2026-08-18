import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/site";

/**
 * Каталожні query-параметри (sort, ціна, наявність) закриті від обходу:
 * кожна комбінація фільтрів — «нова» сторінка, і без заборони робот палить
 * краулінговий бюджет на них замість товарів. Самі ж brand/type/category
 * лишаються відкритими — ними робот доходить до товарів, а від індексації
 * дублів їх тримає noindex у метатегах каталогу.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/dashboard/",
          "/api/",
          "/cart",
          "/checkout",
          "/compare",
          "/wishlist",
          "/login",
          "/register",
          "/order/",
          "/sales/",
          "/driver/",
          "/manager/",
          "/warehouse/",
          "/simulation",
          "/ai/",
          "/r/",
          "/catalog?*sort=",
          "/catalog?*priceMin=",
          "/catalog?*priceMax=",
          "/catalog?*inStock=",
          "/catalog?*withImage=",
          "/catalog?*search=",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
