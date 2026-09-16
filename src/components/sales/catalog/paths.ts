/**
 * Де живе каталог персоналу: у кабінеті торгового чи в шеллі адмінки.
 *
 * Екран один на обидва місця, а адреси різні. Кабінет торгового має свій
 * layout — нижню панель і шапку під планшет, — тож адмін, що йшов у каталог
 * із сайдбару на /sales/catalog, випадав із панелі управління на екран
 * планшета. Усі посилання всередині каталогу беруться звідси, щоб жодне не
 * виводило з секції, в якій людина вже працює.
 */
export type CatalogSection = "sales" | "admin";

export function catalogPaths(section: CatalogSection) {
  const toc = section === "admin" ? "/admin/catalog" : "/sales/catalog";
  return { toc, list: `${toc}/list` };
}

/**
 * Посилання на каталог, записане адресою кабінету, — у секцію, де його
 * показують.
 *
 * Помічник пише в текст відповіді /sales/catalog/list?search=… і не знає, де
 * цю відповідь читатимуть: та сама розмова відкривається і в кабінеті, і в
 * адмінці, а текст лежить у базі. Тому адреса підміняється при показі, а не
 * при генерації — так виправляються й відповіді, збережені раніше.
 */
export function catalogHrefIn(url: string, section: string): string {
  if (section !== "admin") return url;
  return url.replace(/^\/sales\/catalog(?=[/?#]|$)/, catalogPaths("admin").toc);
}
