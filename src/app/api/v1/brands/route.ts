/**
 * Дерево брендів — навігація каталогу в застосунку.
 *
 * Бренд, а не категорія: 84% товарів лежать у звалищі «Імпорт з 1С», решта
 * службових груп називається числами, тож категорійне дерево з 1С покупцю
 * нічого не пояснює. Бренд заповнений майже скрізь.
 *
 * Логіка та сама, що в /api/catalog/brands; окремий роут потрібен тому, що
 * застосунок ходить лише під префіксом /api/v1/ — саме він внесений у
 * правило bypass фаєрвола, і кожен виняток поза ним довелося б заводити руками.
 */

import { NextResponse } from "next/server";
import { getShoppableBrandTree, getBrandTypes, getBrandSummaries } from "@/lib/catalog/brand-tree";
import { getBrandShowcase, getBrandPhotos } from "@/lib/catalog/brand-showcase";

/** Структура каталогу змінюється не частіше, ніж приїжджає обмін із 1С. */
export const revalidate = 3600;

export async function GET(req: Request) {
  const brand = new URL(req.url).searchParams.get("brand");

  if (brand) {
    // shoppable — той самий сенс, що в getShoppableBrandTree нижче: список
    // груп у застосунку є обіцянкою видачі, а не описом бази.
    return NextResponse.json({ types: await getBrandTypes(brand, { shoppable: true }) });
  }

  const [tree, showcase, photos, summaries] = await Promise.all([
    /*
     * Лише те, що можна купити.
     *
     * Список брендів у застосунку — це обіцянка видачі: людина натискає бренд
     * і одразу бачить товар. Із загальним підрахунком вона натискала
     * «DNIPRO-M, 1 468 позицій» і бачила десять, а 197 брендів із 281 узагалі
     * відкривали порожній екран. Зміст каталогу на сайті і далі рахує все
     * активне — там це відповідь на інше питання.
     */
    getShoppableBrandTree(),
    getBrandShowcase(),
    getBrandPhotos(),
    getBrandSummaries(),
  ]);

  /*
   * Дерево, плюс три поля для вигляду.
   *
   * showcase — ті самі вісім банерів, що на головній сайту й застосунку: у
   * списку брендів вони йдуть першими, бо це фірми, за якими ми стоїмо, а не
   * просто найдовші рядки в таблиці.
   *
   * photos і summaries — знімок і рядок «що всередині» для решти списку. Назва
   * бренда сама по собі не відповідає на питання, з яким на цей список
   * дивляться: «METEC» чи «REVOLT» не кажуть нічого, доки не відкриєш.
   *
   * Усі три поля додані, а не підмінили щось: установлену збірку не оновити
   * примусово, і старий застосунок мусить і далі малювати свій список.
   */
  return NextResponse.json({ ...tree, showcase, photos, summaries });
}
