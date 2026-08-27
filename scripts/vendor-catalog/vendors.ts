/**
 * Реєстр офіційних сайтів виробників, з яких беремо фото й характеристики.
 *
 * Чому один рушій із реєстром, а не копія скрипта на кожен бренд (як було з
 * apro/aurora/syla/metec): різниця між сайтами — це три функції (де взяти
 * артикул, де фото, де характеристики), а решта — обхід, ввічливість до
 * чужого сервера, відновлюваність, вивантаження в R2 — однакова. Копії
 * розповзались би і кожну довелось би лагодити окремо.
 *
 * Головне правило зіставлення: сторінка мусить САМА назвати артикул, і він
 * мусить збігтися з нашим із 1С. Жодних здогадок за назвою чи за позицією на
 * сторінці — на цьому вже сипався розбір каталогу APRO з PDF.
 */

export type Specs = Record<string, string>;

export type Vendor = {
  /** Ключ у R2 (catalogs/<slug>/site-<дата>/) і в аргументах скриптів. */
  slug: string;
  title: string;
  site: string;
  /** Slug брендів у нашій базі, які покриває це джерело. */
  brands: string[];
  /**
   * Чи шукати ще й серед карток БЕЗ бренду.
   *
   * Потрібне для MASTERTOOL: у нього своя наскрізна нумерація, і під нею в
   * нас лежить не тільки GRANITE чи PROFI, а й тисячі позицій, яким бренд
   * узагалі не проставлений (рукавиці, котушки до бензокос, перехідники).
   */
  unbranded?: boolean;
  /** Як знайти сторінки товарів. */
  discover:
    | { kind: "sitemap"; urls: string[]; pageMatch?: RegExp; /** Переписати адресу з карти (напр. додати мовний префікс). */ rewrite?: (url: string) => string }
    | { kind: "direct"; url: (sku: string) => string }
    | {
        kind: "crawl";
        roots: string[];
        pageMatch: RegExp;
        follow: RegExp;
        pages?: number;
        /** Переписати адресу категорії перед заходом (напр. «?limit=100»). */
        expand?: (url: string) => string;
      };
  /** Артикул, який сторінка декларує сама. null — сторінка не про товар. */
  article: (html: string, url: string) => string | null;
  /** Повнорозмірне фото товару. */
  photo: (html: string, url: string) => string | null;
  /** Характеристики виробника — з них збираємо опис картки. */
  specs?: (html: string) => Specs;
  /** Готовий текст опису, якщо сайт його друкує. */
  text?: (html: string) => string | null;
  /** Сайт закривається JS-перевіркою, яка ставить сталу куку. */
  challenge?: boolean;
  /**
   * Чи це справді товар цього бренду з нашого боку. Захист від «під MAKITA»,
   * «аналог», «кит.» — китайських замінників, яким фото оригіналу ставити не
   * можна.
   */
  ourProduct?: (name: string) => boolean;
};

/* ────────────────────────── спільні дрібниці ────────────────────────── */

export const strip = (h: string) =>
  h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|tr|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&mdash;/g, "—")
    .replace(/&deg;/g, "°")
    .replace(/&times;/g, "×")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

/**
 * Артикул у порівнюваному вигляді.
 *
 * У номенклатурі 1С латинські літери місцями набрані кирилицею: «А-83951»
 * (U+0410) виглядає точно як «A-83951», але це різні рядки — і артикул, який
 * у виробника є, у нас «не знаходився». Та сама історія, що з «ö» у Grösser.
 */
const HOMOGLYPHS: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", І: "I", Ї: "I",
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i",
};
export const normArticle = (s: string) =>
  s
    .normalize("NFC")
    .trim()
    .replace(/[А-Яа-яІіЇї]/g, (c) => HOMOGLYPHS[c] ?? c)
    .replace(/\s+/g, " ")
    .toUpperCase();

const meta = (html: string, prop: string) =>
  html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i"))?.[1] ??
  null;

export const ogImage = (html: string, base: string) => {
  const v = meta(html, "og:image");
  return v ? new URL(v, base).toString() : null;
};

/** Усі блоки Schema.org Product зі сторінки, включно з @graph. */
export function jsonLdProducts(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const walk = (o: unknown): void => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(walk);
        const rec = o as Record<string, unknown>;
        const t = rec["@type"];
        if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) out.push(rec);
        if (rec["@graph"]) walk(rec["@graph"]);
      };
      walk(JSON.parse(m[1].trim().replace(/^﻿/, "")));
    } catch {
      /* невалідний JSON-LD трапляється — не привід падати на всій сторінці */
    }
  }
  return out;
}

/** Пари «назва → значення» з таблиці <tr><td>к</td><td>з</td></tr>. */
function tableSpecs(block: string): Specs {
  const specs: Specs = {};
  for (const row of block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]));
    if (cells.length >= 2 && cells[0] && cells[1]) specs[cells[0].replace(/:$/, "")] = cells[1];
  }
  return specs;
}

/* ────────────────────────────── джерела ────────────────────────────── */

/**
 * apro.ua — Bitrix. Артикул друкується у вкладці «Характеристики» окремим
 * рядком таблиці. Беремо саме перший такий блок: далі на сторінці йдуть
 * картки «Схожі товари», у яких теж є свої артикули, і сплутати їх легко.
 */
const apro: Vendor = {
  slug: "apro",
  title: "APRO",
  site: "https://apro.ua",
  brands: ["apro"],
  discover: { kind: "sitemap", urls: ["https://apro.ua/sitemap.xml"], pageMatch: /\/catalog\/[^/]+\/?$/ },
  article(html) {
    const block = html.match(/tabs-content__item-specifications["'][\s\S]*?<table[\s\S]*?<\/table>/i)?.[0];
    if (!block) return null;
    const specs = tableSpecs(block);
    return specs["Артикул"]?.trim() || null;
  },
  photo: (html, url) => ogImage(html, url),
  specs(html) {
    const block = html.match(/tabs-content__item-specifications["'][\s\S]*?<table[\s\S]*?<\/table>/i)?.[0];
    return block ? tableSpecs(block) : {};
  },
  ourProduct: (n) => /\bapro\b/i.test(n) && !/\bkapro\b/i.test(n),
};

/**
 * sila.com.ua — сайт виробника ТМ СИЛА, теж Bitrix, але верстка інша:
 * артикул стоїть просто під заголовком (`<p>Артикул: 201072</p>`), а
 * характеристики — парами div.property-name / div.property-value.
 *
 * Фото беремо з <img> у галереї, а не з og:image: там лежить зменшена копія
 * з resize_cache (220×220), а нам потрібен оригінал із /upload/iblock/.
 */
const sila: Vendor = {
  slug: "sila",
  title: "СИЛА",
  site: "https://sila.com.ua",
  brands: ["syla"],
  discover: { kind: "sitemap", urls: ["https://sila.com.ua/sitemap.xml"], pageMatch: /\/catalog\/.+\/[^/]+\/$/ },
  article(html) {
    const m = strip(html.match(/<div class="detail">([\s\S]{0,600})/i)?.[1] ?? "").match(/Артикул:\s*([A-Za-z0-9][\w\-./]{2,20})/i);
    return m?.[1] ?? null;
  },
  photo(html, url) {
    const raw = [...html.matchAll(/<img[^>]+src="(\/upload\/iblock\/[^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => m[1]);
    const full = raw.find((s) => !s.includes("resize_cache"));
    return full ? new URL(full, url).toString() : ogImage(html, url);
  },
  specs(html) {
    const specs: Specs = {};
    const list = html.match(/property-list[\s\S]*?(?=<\/section>|<footer|$)/i)?.[0] ?? "";
    const names = [...list.matchAll(/property-name["'][^>]*>([\s\S]*?)<\/div>/gi)].map((m) => strip(m[1]));
    const values = [...list.matchAll(/property-value["'][^>]*>([\s\S]*?)<\/div>/gi)].map((m) => strip(m[1]));
    names.forEach((n, i) => { if (n && values[i]) specs[n.replace(/:$/, "")] = values[i]; });
    return specs;
  },
  // \b у JS рахує лише латиницю, тому /\bсила\b/ на кириличній назві не
  // спрацьовувало жодного разу — і список «шукаємо» виходив порожнім.
  ourProduct: (n) => /(^|[^а-яіїєґ'ʼ])сила([^а-яіїєґ'ʼ]|$)/i.test(n),
};

/**
 * makita.ua — єдиний випадок, коли обхід сайту взагалі не потрібен: адреса
 * картки будується прямо з артикулу (`/product/D-18770.html`), а фото лежить
 * на медіасервері Makita під тим самим ім'ям. Тому замість тисяч сторінок
 * ходимо рівно по тих артикулах, яким бракує фото.
 *
 * Пастка, заради якої тут `ourProduct`: у нас багато позицій «під MAKITA» —
 * це китайські замінники, і ставити їм фото оригіналу не можна.
 */
const makita: Vendor = {
  slug: "makita",
  title: "Makita",
  site: "https://www.makita.ua",
  brands: ["makita"],
  discover: { kind: "direct", url: (sku) => `https://www.makita.ua/product/${encodeURIComponent(sku)}.html` },
  // Сторінка друкує артикул сама (span.product-number) — беремо його, а не
  // хвіст адреси: інакше редирект на іншу картку лишився б непоміченим.
  article: (html, url) =>
    html.match(/class="product-number"[^>]*>\s*([^<]+?)\s*</i)?.[1]?.trim() ||
    decodeURIComponent(url.match(/\/product\/([^/]+)\.html/)?.[1] ?? "") ||
    null,
  photo(html, url) {
    // У галереї два розміри: PNG «для веба» і повний JPG у fancybox. Беремо JPG.
    const big = html.match(/href="(https:\/\/si\.makitamedia\.com\/[^"]+\.jpe?g)"[^>]*class="fancybox"/i)?.[1];
    return big ?? ogImage(html, url) ?? html.match(/<img[^>]+src="(https:\/\/si\.makitamedia\.com\/[^"]+)"/i)?.[1] ?? null;
  },
  specs(html) {
    const specs: Specs = {};
    for (const row of html.matchAll(/techspecs--row"[\s\S]*?techspecs--row-specification"[^>]*>([\s\S]*?)<\/div>[\s\S]*?techspecs--row-value"[^>]*>([\s\S]*?)<\/div>/gi)) {
      const k = strip(row[1]);
      const v = strip(row[2]);
      if (k && v) specs[k] = v;
    }
    return specs;
  },
  text: (html) => {
    const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    return h ? strip(h[1]) : null;
  },
  ourProduct: (n) => !/(під|пiд|под|аналог|кит\.|китай)/i.test(n),
};

/**
 * polax.ua — OpenCart без XML-карти, зате артикул стоїть у хвості адреси
 * (`...-49-005`), а на сторінці є Schema.org з тим самим значенням. Тому
 * обходимо категорії з пагінацією і звіряємо хвіст адреси з JSON-LD.
 */
const polax: Vendor = {
  slug: "polax",
  title: "POLAX",
  site: "https://polax.ua",
  brands: ["polax"],
  discover: {
    kind: "crawl",
    // /manufacturer — сторінка виробника, де перелічені геть усі підрозділи.
    // Перша версія стартувала з дюжини кореневих розділів і ходила лише по
    // односегментних адресах, тому в підрозділи (abrazyvni-materialy/dysky-
    // almazni) не заходила зовсім — і з ~1600 карток бачила 204.
    roots: ["https://polax.ua/manufacturer"],
    expand: (u) => (u.includes("?") ? u : `${u}?limit=100`),
    // (?!en|ru|pl) — сайт багатомовний, і перемикач мов веде на /en, /ru, /pl.
    // Без цього обхід ішов і туди, і описи приїжджали англійською.
    follow: /^https:\/\/polax\.ua\/(?!(?:en|ru|pl)(?:\/|$))[a-z0-9-]+(\/[a-z0-9-]+)?(\?limit=100)?(&page=\d+)?$/,
    // Артикул POLAX має вигляд «49-005», «54-060», «1-07» — цифри в хвості
    // адреси. Перша, вужча версія (\d{2}-\d{3}) губила короткі артикули.
    pageMatch: /^https:\/\/polax\.ua\/(?!(?:en|ru|pl)\/)[a-z0-9-]+-\d{1,3}-\d{2,4}$/,
    pages: 400,
  },
  article(html, url) {
    const ld = jsonLdProducts(html)[0];
    const declared = ld?.sku ? String(ld.sku).trim() : null;
    const tail = url.match(/-(\d{2}-\d{3})$/)?.[1] ?? null;
    // Довіряємо адресі лише тоді, коли сторінка не заперечує.
    if (declared && tail && declared !== tail) return null;
    return declared ?? tail;
  },
  photo: (html, url) => ogImage(html, url),
  specs(html) {
    const block = html.match(/<table[^>]*class="[^"]*attribute[^"]*"[\s\S]*?<\/table>/i)?.[0];
    return block ? tableSpecs(block) : {};
  },
  // Єдине з наших джерел, де виробник пише живий текст, а не самі
  // характеристики, — беремо його як основу опису.
  text(html) {
    const d = jsonLdProducts(html).map((o) => (o.description ? String(o.description) : "")).find((x) => x.length > 60);
    return d ? strip(d).slice(0, 900) : null;
  },
  ourProduct: (n) => /\bpolax\b/i.test(n),
};

/**
 * gradient.ua — сюди ж потрапляє RHINO: обидві марки належать одному
 * постачальнику і лежать в одному каталозі.
 *
 * Сайт закривається JS-перевіркою, яка нічого не рахує — просто ставить куку
 * зі сталим значенням із самої сторінки й перезавантажується. Тому `challenge`:
 * рушій витягує це значення і ходить з кукою далі.
 */
const gradient: Vendor = {
  slug: "gradient",
  title: "GRADIENT / RHINO",
  site: "https://gradient.ua",
  brands: ["gradient", "rhino"],
  challenge: true,
  discover: {
    kind: "sitemap",
    urls: [
      "https://gradient.ua/content/export/gradient.ua/catalog-sitemap-01.xml",
      "https://gradient.ua/content/export/gradient.ua/catalog-sitemap-02.xml",
    ],
    pageMatch: /^https:\/\/gradient\.ua\/(?!ru\/)[a-z0-9-]+\/$/,
  },
  article(html) {
    const ld = jsonLdProducts(html)[0];
    if (ld?.sku) return String(ld.sku).trim();
    const m = strip(html).match(/(?:Артикул|Код товару)[:\s]*([A-Za-z0-9][\w\-./ ]{2,20}?)(?:\s{2,}|$)/i);
    return m?.[1]?.trim() ?? null;
  },
  photo: (html, url) => ogImage(html, url),
  specs(html) {
    const block = html.match(/<table[^>]*>[\s\S]*?<\/table>/i)?.[0];
    return block ? tableSpecs(block) : {};
  },
  ourProduct: (n) => /\b(gradient|rhino)\b/i.test(n),
};

/**
 * sigma.ua — сайт виробника, під яким живе і марка ULTRA: у 1С це окремий
 * бренд, але артикули в неї з тієї самої семизначної нумерації Sigma, і
 * картки лежать у тому самому каталозі.
 *
 * Окреме джерело (не «sigma»), щоб не перетинатися з обміном по самій Sigma:
 * у R2 це catalogs/ultra/, а не catalogs/sigma/.
 *
 * Пастка, задокументована ще в першому скрипті по Sigma: у полі sku частина
 * карток тримає внутрішній префікс («TR1010421»), тоді канонічний артикул
 * друкується в назві в дужках.
 */
const ultra: Vendor = {
  slug: "ultra",
  title: "ULTRA (sigma.ua)",
  site: "https://sigma.ua",
  brands: ["ultra"],
  discover: { kind: "sitemap", urls: ["https://sigma.ua/products-sitemap.xml"], pageMatch: /\/buy\/[^/]+-\d{4,10}\/?$/ },
  article(html, url) {
    const ld = jsonLdProducts(html)[0];
    const tail = url.replace(/\/$/, "").match(/-(\d{4,10})$/)?.[1] ?? null;
    const declared = ld?.sku ? String(ld.sku).trim() : null;
    if (!declared) return tail;
    if (tail && (declared === tail || declared.replace(/^[A-Za-z]+/, "") === tail)) return tail;
    if (tail && String(ld?.name ?? "").includes(`(${tail})`)) return tail;
    return declared;
  },
  photo: (html, url) => ogImage(html, url),
  specs(html) {
    const specs: Specs = {};
    for (const row of html.matchAll(
      /detail-table__property"[^>]*>\s*<span>([\s\S]*?)<\/span>[\s\S]*?detail-table__value"[^>]*>\s*<span>([\s\S]*?)<\/span>/gi
    )) {
      const k = strip(row[1]);
      const v = strip(row[2]);
      if (k && v) specs[k] = v;
    }
    return specs;
  },
  ourProduct: (n) => /\bultra\b/i.test(n),
};

/**
 * revolt-tools.com.ua — офіційний магазин марки REVOLT. Платформа та сама, що
 * в gradient.ua, тож і JS-перевірка та сама (стала кука challenge_passed).
 *
 * Чи збігається нумерація — питання відкрите: у нашій базі майже вся REVOLT
 * сидить на сурогатних «1C-…», тому реально шукати є лише сотню артикулів.
 */
const revolt: Vendor = {
  slug: "revolt",
  title: "REVOLT",
  site: "https://revolt-tools.com.ua",
  brands: ["revolt"],
  challenge: true,
  discover: {
    kind: "sitemap",
    urls: ["https://revolt-tools.com.ua/content/export/revolt-tools.com.ua/catalog-sitemap.xml"],
    pageMatch: /^https:\/\/revolt-tools\.com\.ua\/(?!ru\/)[a-z0-9-]+\/$/,
  },
  article(html) {
    const ld = jsonLdProducts(html)[0];
    if (ld?.sku) return String(ld.sku).trim();
    const m = strip(html).match(/(?:Артикул|Код товару)[:\s]*([A-Za-z0-9][\w\-./ ]{2,20}?)(?:\s{2,}|$)/i);
    return m?.[1]?.trim() ?? null;
  },
  photo: (html, url) => ogImage(html, url),
  specs(html) {
    const block = html.match(/<table[^>]*>[\s\S]*?<\/table>/i)?.[0];
    return block ? tableSpecs(block) : {};
  },
  ourProduct: (n) => /\brevolt\b/i.test(n),
};

/**
 * somafix.com.ua — офіційний сайт марки в Україні.
 *
 * Артикула на сторінці немає ніде в тексті: ні в розмітці, ні в JSON-LD (його
 * взагалі немає), а og:image — це логотип. Але фото товару лежать під власним
 * кодом виробника: /img/product/S801_01.png. Саме цей код у 41 з 89 наших
 * карток стоїть як артикул із 1С, тож ім'я файлу і є ключем зіставлення.
 *
 * Адреси в карті сайту без мовного префікса і тому віддають 404 — треба
 * ходити на /ua/…
 */
const somafix: Vendor = {
  slug: "somafix",
  title: "SOMA FIX",
  site: "https://somafix.com.ua",
  brands: ["soma-fix"],
  // Карта сайту застаріла: у ній 54 картки, з них 12 уже 404, — тож ідемо
  // сімома розділами каталогу, які виробник тримає в актуальному стані.
  discover: {
    kind: "crawl",
    roots: ["https://somafix.com.ua/ua/catalog"],
    follow: /^https:\/\/somafix\.com\.ua\/ua\/catalog(\/[a-z0-9-]+)?$/,
    pageMatch: /^https:\/\/somafix\.com\.ua\/ua\/product\/[a-z0-9-]+$/,
    pages: 40,
  },
  article: (html) => html.match(/\/img\/product\/([A-Za-z]?\d{2,5})_\d/i)?.[1]?.toUpperCase() ?? null,
  photo(html, url) {
    const f = html.match(/\/img\/product\/([A-Za-z]?\d{2,5}_\d+\.(?:png|jpe?g))/i)?.[1];
    return f ? new URL(`/img/product/${f}`, url).toString() : null;
  },
  specs(html) {
    // Характеристики надруковані списком «- ключ: значення <br>».
    const block = html.match(/data-type="characteristics"[\s\S]*?product-description__content"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
    if (!block) return {};
    const specs: Specs = {};
    for (const line of strip(block).split("\n")) {
      const m = line.replace(/^[-–—•]\s*/, "").match(/^(.{2,45}?):\s*(.+)$/);
      if (m) specs[m[1].trim()] = m[2].trim();
    }
    return specs;
  },
  text(html) {
    const d = html.match(/data-type="description"[\s\S]*?product-description__content"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      ?? html.match(/<h1[^>]*>[\s\S]*?<\/h1>([\s\S]{0,900}?)<h2/i)?.[1];
    const t = d ? strip(d).replace(/\s+/g, " ") : "";
    return t.length > 60 ? t.slice(0, 900) : null;
  },
  ourProduct: (n) => /soma\s?fix/i.test(n),
};

/**
 * mastertool.ua — офіційний сайт MASTERTOOL, під яким живуть і власні марки
 * GRANITE, ТИТУЛ, ГОСПОДАР.
 *
 * Чому це найцінніше джерело з усіх: нумерація MASTERTOOL наскрізна («19-4224»,
 * «78-0008», «83-0601»), і саме вона стоїть артикулом у купи наших карток —
 * зокрема в тих, де бренд у 1С не проставлений зовсім. Тому `unbranded: true`.
 *
 * Особливості верстки: og:image немає, зате фото товару лежить під власним
 * артикулом — assets/images/products/<id>/<артикул>.jpg. Опис — у блоці
 * .tezis, характеристики — у вкладці #tabcard-2. Сайт водить не-браузерні
 * клієнти по редиректах, доки ті не почнуть носити куки, — рушій це вміє.
 */
const mastertool: Vendor = {
  slug: "mastertool",
  title: "MASTERTOOL / GRANITE / ТИТУЛ",
  site: "https://mastertool.ua",
  brands: ["mastertool", "granite", "granite-active", "granite-premium", "tytul", "profi", "kt", "eva", "zak", "ievro", "al", "lan"],
  unbranded: true,
  // Карта сайту віддається лише клієнту з куками — curl без банки кук ловить
  // нескінченний редирект і порожню відповідь. Обхід категорій теж працює,
  // але він послідовний і на цьому каталозі тягнеться годинами.
  discover: {
    kind: "sitemap",
    urls: ["https://mastertool.ua/sitemap.xml"],
    pageMatch: /^https:\/\/mastertool\.ua\/(?:ua\/)?[a-z0-9-]+-id-\d+$/,
    rewrite: (u) => (u.includes("/ua/") ? u : u.replace("mastertool.ua/", "mastertool.ua/ua/")),
  },
  article(html, url) {
    const declared = html.match(/number-code-avail-block[\s\S]{0,400}?<span>\s*([^<]{2,24}?)\s*<\/span>/i)?.[1];
    if (declared) return declared.trim();
    return url.match(/-([A-Za-z0-9][\w.-]{2,20})-id-\d+$/)?.[1] ?? null;
  },
  photo(html, url) {
    const id = url.match(/-id-(\d+)$/)?.[1];
    // Фото самого товару лежить у теці його ж id і БЕЗ thumbsmall — решта
    // знімків на сторінці це мініатюри супутніх товарів.
    const re = id
      ? new RegExp(`assets/images/products/${id}/([^"'/]+\\.(?:jpe?g|png|webp))`, "i")
      : /assets\/images\/products\/\d+\/([^"'/]+\.(?:jpe?g|png|webp))/i;
    const f = html.match(re)?.[1];
    return f && id ? `https://mastertool.ua/assets/images/products/${id}/${f}` : null;
  },
  specs(html) {
    const block = html.match(/id="tabcard-2"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1];
    if (!block) return {};
    const specs: Specs = {};
    for (const row of block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const c = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((x) => strip(x[1]));
      if (c.length >= 2 && c[0] && c[1]) specs[c[0].replace(/:$/, "")] = c[1];
    }
    if (!Object.keys(specs).length) {
      for (const line of strip(block).split("\n")) {
        const m = line.match(/^(.{2,40}?):\s*(.{1,80})$/);
        if (m) specs[m[1].trim()] = m[2].trim();
      }
    }
    return specs;
  },
  text(html) {
    const t = html.match(/class="tezis"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
    const s = t ? strip(t).replace(/\s+/g, " ") : "";
    return s.length > 40 ? s.slice(0, 900) : null;
  },
};

export const VENDORS: Vendor[] = [apro, sila, makita, polax, gradient, ultra, revolt, somafix, mastertool];

export function vendorBySlug(slug: string): Vendor {
  const v = VENDORS.find((x) => x.slug === slug);
  if (!v) throw new Error(`джерело «${slug}» невідоме; є: ${VENDORS.map((x) => x.slug).join(", ")}`);
  return v;
}

/**
 * Опис картки з характеристик виробника.
 *
 * Навіщо взагалі складати текст, а не класти таблицю: поле Product.description
 * на вітрині — це абзац, і зараз там стоїть текст, вигаданий моделлю за назвою
 * товару. Дані виробника точніші, тому переписуємо їх у той самий формат, що
 * вже прижився в картках POLAX: перше речення + «Характеристики — к: з».
 */
/**
 * Наскільки назва з 1С і назва в виробника — про той самий товар.
 *
 * Потрібне там, де бренд не підказує нічого: у картці без бренду збіг самого
 * артикулу лишається єдиним доказом, а нумерація в різних постачальників
 * місцями перетинається. Рахуємо частку спільних значущих токенів.
 */
export function similarity(a: string, b: string): number {
  // Триграми, а не збіг слів: назви з 1С і в виробника різняться формою —
  // «Рукавиці для скла» проти «Рукавички скляра», «бетонщика» проти
  // «бетонщика фарбована». За словами це давало 0.14 на очевидному збігу,
  // за триграмами — 0.4+.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[«»"'()\[\],.;:*]/g, " ")
      .replace(/[хx×]/g, "x")
      .replace(/\s+/g, " ")
      .trim();
  const grams = (s: string) => {
    const t = ` ${norm(s)} `;
    const out = new Set<string>();
    for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

/**
 * Спільні числа в назвах — другий доказ, коли слова різні.
 *
 * У MASTERTOOL термінологія розходиться з нашою з 1С настільки, що триграми
 * дають 0.05 на очевидному збігу: «Ванна для валіків 150*220» проти «Кювета
 * малярська 160×220 мм». Але розмір 220 стоїть в обох — і саме він, разом із
 * точним збігом артикулу, і робить пару достовірною.
 */
export function sharedNumbers(a: string, b: string): number {
  const nums = (s: string) => new Set((s.match(/\d+(?:[.,]\d+)?/g) ?? []).filter((n) => n.length >= 2));
  const A = nums(a);
  const B = nums(b);
  let hit = 0;
  for (const n of A) if (B.has(n)) hit++;
  return hit;
}

export function describe(title: string, specs: Specs, text?: string | null): string {
  // Службові поля: покупцю ні до чого артикул (він у картці окремо), крос-код
  // «Аналоги» і «гарантія не передбачена».
  const junkKey =
    /^(артикул|код товару|код товара|бренд|виробник|производитель|торгова марка|тм|аналоги|аналог|країна|страна|гарант|ціна|цена|штрих\s?-?\s?код|ean|upc)/i;

  /**
   * Каталоги виробників не бездоганні: в apro.ua у кутника 50×50 стоять
   * «Макс. продуктивність 7.1 л/хв» і «Макс. потужність до 1600 Вт» — поля
   * від зовсім іншого товару, які хтось скопіював у картку. Такі пари
   * пускаємо лише тоді, коли назва товару взагалі допускає двигун.
   */
  const powerKey = /(потужн|продуктивн|напруг|об\/хв|оберт|двигун|акумулятор|вт\b|квт)/i;
  const powered = /(машин|дриль|перфоратор|пила|шліф|насос|компресор|генератор|двигун|станок|верстат|тример|косар|мийк|пилосос|фен|гайковерт|шурупокрут|шуруповерт|краскопульт|пушк|обприскувач|болгарк|гармат)/i.test(title);

  const pairs = Object.entries(specs).filter(([k, v]) => {
    const key = k.trim();
    if (junkKey.test(key) || !v || v.length > 120) return false;
    if (powerKey.test(key) && !powered) return false;
    return true;
  });

  // «…(36-044)Шукаєте надійного супутника…» — у JSON-LD POLAX заголовок
  // склеєний з текстом без пробілу. Чистимо саме тут, а не при обході сайту:
  // розібрані сторінки лежать у кеші, і правка формулювання інакше вимагала б
  // качати весь каталог заново.
  const head = (text ?? title)
    .replace(/\)([А-ЯІЇЄҐA-Z][а-яіїєґ])/g, "). $1")
    .replace(/\s+/g, " ")
    .trim();
  if (!pairs.length) return head;
  const tail = pairs.map(([k, v]) => `${k.replace(/:$/, "")}: ${v}`).join("; ");
  return `${head.replace(/\.$/, "")}.\nХарактеристики — ${tail}.`
    // <sup>-1</sup> після зняття тегів лишає «хв -1» — повертаємо степінь
    .replace(/(хв|min)\s+-1\b/g, "$1⁻¹");
}
