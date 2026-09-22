# Hotline: фід, облік джерела й передача замовлення менеджеру — план робіт

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Віддати Hotline товарний фід, знати по кожному замовленню, з якого
майданчика прийшов покупець, і показати конверсію в адмінці.

**Architecture:** Фід — окремий роут на ISR-кеші з чистим збирачем XML.
Джерело визначається в браузері на першій сторінці візиту, живе 30 днів у
localStorage і їде в замовлення полем. Звіт читає ті самі `SiteEvent` і
`Order`, що й наявні вкладки вебаналітики.

**Tech Stack:** Next.js 16 (App Router), Prisma 6 + PostgreSQL, TypeScript,
ExcelJS (вже є), перевірки — скрипти `scripts/check-*.mts` через
`npx tsx --env-file=.env`.

**Spec:** `docs/hotline.md`

## Global Constraints

- **У 1С не пишемо нічого.** Жодного запису через COM чи OData. Замовлення в
  1С вносить менеджер руками. Повний текст правила — `docs/1c-read-only.md`.
- **Міграції на прод — руками.** Білд Vercel їх не накочує. Після зміни
  `prisma/schema.prisma` — `npm run db:migrate:prod` тим самим рухом, що й пуш.
- **`Product.price` пише лише рушій цін** (`src/lib/pricing/engine.ts`). Фід
  ціни лише читає.
- **Сторінки каталогу не читають `searchParams` і `cookies`** — це вимкнуло б
  ISR. UTM-мітку читає тільки клієнтський скрипт.
- **Коментарі в коді й повідомлення комітів — українською**, як у решті репозиторію.
- **Поріг ціни фіду — 2000 грн**, виключений розділ — `krip`.
- **Кожен комміт — лише явні шляхи** (`git add <шлях>`), бо з репозиторієм
  паралельно працюють інші сесії. Після комміту перевіряти `git show --stat`.

---

## Файлова структура

**Створюємо:**

| Файл | Відповідальність |
|---|---|
| `src/lib/feeds/hotline.ts` | Відбір товарів + збирання XML Hotline (чисті функції + один запит) |
| `src/app/feeds/hotline.xml/route.ts` | Роут фіду, кеш, заголовки |
| `src/lib/webstats/source.ts` | Визначення джерела візиту й пам'ять на 30 днів (чисті функції) |
| `src/lib/webstats/sources.ts` | Звіт по джерелах (SQL) |
| `src/app/api/admin/site-analytics/sources/route.ts` | Доступ і період для звіту |
| `src/app/admin/site-analytics/components/SourcesTab.tsx` | Вкладка «Джерела» |
| `src/lib/orders/for-1c.ts` | Текст замовлення для внесення в 1С (чиста функція) |
| `src/app/api/admin/orders/[id]/entered-1c/route.ts` | Позначка «Заведено в 1С» |
| `scripts/check-hotline-feed.mts` | Перевірка відбору й XML |
| `scripts/check-source.mts` | Перевірка визначення джерела |

**Правимо:**

| Файл | Що саме |
|---|---|
| `prisma/schema.prisma` | `SiteEvent.source`, `Order.source/sourceMedium/sourceCampaign/enteredIn1CAt` |
| `src/lib/webstats/server.ts` | `sourceTag()` — санітайзер мітки |
| `src/lib/webstats/client.ts` | поле `src` у події |
| `src/components/webstats/WebstatsTracker.tsx` | визначення джерела на першій сторінці візиту |
| `src/app/api/site-events/route.ts` | приймання `src` |
| `src/app/checkout/page.tsx` | джерело в тілі замовлення |
| `src/lib/orders/create-order.ts` | запис джерела, артикули в сповіщення |
| `src/lib/telegram/order-alerts.ts` | артикул у рядку позиції |
| `src/app/admin/orders/[id]/page.tsx` | кнопка «Скопіювати для 1С», позначка |
| `src/app/admin/site-analytics/components/SiteAnalyticsShell.tsx` | вкладка «Джерела» |

---

### Task 1: Схема бази

**Files:**
- Modify: `prisma/schema.prisma` (модель `SiteEvent` ~3564–3620, модель `Order` ~595–640)

**Interfaces:**
- Produces: колонки `SiteEvent.source`, `Order.source`, `Order.sourceMedium`,
  `Order.sourceCampaign`, `Order.enteredIn1CAt` — ними користуються всі
  наступні задачі.

- [ ] **Крок 1: Додати колонку в `SiteEvent`**

У `prisma/schema.prisma`, у моделі `SiteEvent`, одразу після поля `refCode`:

```prisma
  /// Джерело ЦЬОГО візиту: 'hotline', 'google', 'direct', хост реферера.
  /// Пишеться лише на першій події сесії, як і referrer. NULL — подія до
  /// вересня 2026, коли джерела ще не рахували; 'direct' пишемо явно.
  source String?
```

Там же, до наявних `@@index`, додати:

```prisma
  @@index([source, createdAt])
```

- [ ] **Крок 2: Додати колонки в `Order`**

У моделі `Order`, після поля `salesRep`:

```prisma
  /// Звідки прийшов покупець — знімок на момент оформлення з пам'яті
  /// браузера (30 днів, src/lib/webstats/source.ts). Саме знімок: людина
  /// могла побачити товар на Hotline, а купити через тиждень напряму, і
  /// замовлення однаково заробив Hotline. Застосунок покупця не шле — null.
  source         String?
  /// 'cpc' | 'organic' | 'social' | 'referral' — як саме прийшли.
  sourceMedium   String?
  sourceCampaign String?

  /// Коли менеджер вніс замовлення в 1С. Ставить людина кнопкою: у 1С ми не
  /// пишемо і дізнатися самі не можемо. Захист від подвійного внесення.
  enteredIn1CAt DateTime?
```

Там же, до наявних `@@index`:

```prisma
  @@index([source, createdAt])
```

- [ ] **Крок 3: Створити міграцію локально**

```bash
npx prisma migrate dev --name order_traffic_source --create-only
```

Перевірити, що у створеному `prisma/migrations/*/migration.sql` рівно п'ять
`ALTER TABLE ... ADD COLUMN` і два `CREATE INDEX`, без `DROP`.

- [ ] **Крок 4: Перевірити міграцію без проду**

За `docs/`-практикою «перевірка міграції без проду»: HEAD-схема + нова
міграція + звірка.

```bash
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
```

Очікуємо код виходу 0 («різниці немає»). Якщо `SHADOW_DATABASE_URL` не
заведено — підняти локальну порожню базу і вказати її.

- [ ] **Крок 5: Комміт**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Замовлення й події знають джерело переходу"
git show --stat HEAD
```

---

### Task 2: Визначення джерела (чисті функції)

**Files:**
- Create: `src/lib/webstats/source.ts`
- Create: `scripts/check-source.mts`

**Interfaces:**
- Produces:
  - `type Attribution = { source: string; medium: string; campaign: string | null }`
  - `resolveSource(search: string, referrer: string | null, ownHost: string): Attribution`
  - `packSource(a: Attribution, now: number): string` — рядок для localStorage
  - `unpackSource(raw: string | null, now: number): Attribution | null` — з перевіркою 30 днів
  - `SOURCE_MEMORY_KEY = "bv_src"`, `SOURCE_MEMORY_DAYS = 30`

- [ ] **Крок 1: Написати перевірку, яка падає**

Створити `scripts/check-source.mts`:

```ts
/**
 * Перевірка визначення джерела переходу. READ ONLY: нічого не пишемо.
 *
 * Запуск: npx tsx scripts/check-source.mts
 */
import { resolveSource, packSource, unpackSource } from "../src/lib/webstats/source";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : `\n   маємо: ${JSON.stringify(got)}\n   треба: ${JSON.stringify(want)}`}`);
}

const HOST = "www.budvik27.com";

eq(
  "мітка з фіду",
  resolveSource("?utm_source=hotline&utm_medium=cpc&utm_campaign=feed", "https://hotline.ua/", HOST),
  { source: "hotline", medium: "cpc", campaign: "feed" }
);

eq(
  "без мітки — за реферером Hotline",
  resolveSource("", "https://hotline.ua/ua/tovar/123/", HOST),
  { source: "hotline", medium: "cpc", campaign: null }
);

eq("пошук Google", resolveSource("", "https://www.google.com/", HOST), {
  source: "google",
  medium: "organic",
  campaign: null,
});

eq("чужий сайт — хостом", resolveSource("", "https://ek.ua/ua/link/", HOST), {
  source: "ek.ua",
  medium: "referral",
  campaign: null,
});

eq("свій сайт — прямий захід", resolveSource("", `https://${HOST}/catalog`, HOST), {
  source: "direct",
  medium: "none",
  campaign: null,
});

eq("без реферера — прямий захід", resolveSource("", null, HOST), {
  source: "direct",
  medium: "none",
  campaign: null,
});

eq(
  "сміття в мітці відсікається",
  resolveSource("?utm_source=<script>alert(1)</script>", null, HOST),
  { source: "direct", medium: "none", campaign: null }
);

eq(
  "мітка обрізається до 40 символів",
  resolveSource(`?utm_source=${"a".repeat(80)}`, null, HOST).source.length,
  40
);

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 22);
const packed = packSource({ source: "hotline", medium: "cpc", campaign: "feed" }, now);

eq("пам'ять читається назад", unpackSource(packed, now + 3 * DAY), {
  source: "hotline",
  medium: "cpc",
  campaign: "feed",
});
eq("через 31 день пам'ять не діє", unpackSource(packed, now + 31 * DAY), null);
eq("побитий рядок не валить код", unpackSource("{зламано", now), null);
eq("порожня пам'ять", unpackSource(null, now), null);

console.log(failed === 0 ? "\nУсе гаразд." : `\nПомилок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Крок 2: Запустити — має впасти**

```bash
npx tsx scripts/check-source.mts
```

Очікуємо помилку «Cannot find module '../src/lib/webstats/source'».

- [ ] **Крок 3: Написати `src/lib/webstats/source.ts`**

```ts
/**
 * Звідки прийшов покупець.
 *
 * Дві причини, чому це окремий файл із чистими функціями: правила
 * («мітка важливіша за реферер», «прямий захід не перетирає Hotline»)
 * перевіряються скриптом без браузера, і той самий розбір потрібен і
 * трекеру, і оформленню замовлення.
 *
 * Пам'ять — localStorage, а не кука: кука на сторінках каталогу вимикає
 * ISR, на чому вже одного разу виріс рахунок Vercel.
 */

export type Attribution = {
  /** 'hotline', 'google', 'ek.ua', 'direct' — нижній регістр, до 40 символів. */
  source: string;
  /** 'cpc' | 'organic' | 'social' | 'referral' | 'none' */
  medium: string;
  campaign: string | null;
};

export const SOURCE_MEMORY_KEY = "bv_src";
/** Скільки днів пам'ятаємо майданчик, з якого прийшла людина. */
export const SOURCE_MEMORY_DAYS = 30;

export const DIRECT: Attribution = { source: "direct", medium: "none", campaign: null };

/** Реферери, у яких є звичне ім'я: інакше у звіті був би голий хост. */
const KNOWN: Array<{ re: RegExp; source: string; medium: string }> = [
  { re: /(^|\.)hotline\.ua$/, source: "hotline", medium: "cpc" },
  { re: /(^|\.)google\./, source: "google", medium: "organic" },
  { re: /(^|\.)bing\.com$/, source: "bing", medium: "organic" },
  { re: /(^|\.)facebook\.com$/, source: "facebook", medium: "social" },
  { re: /(^|\.)instagram\.com$/, source: "instagram", medium: "social" },
  { re: /(^|\.)t\.me$/, source: "telegram", medium: "social" },
];

/** Дозволені символи мітки: усе інше — спроба щось підсунути. */
const TAG = /^[a-z0-9_-]+$/;

/** Мітка з адреси: нижній регістр, до 40 символів, інакше null. */
export function sourceTag(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.trim().toLowerCase().slice(0, 40);
  return clean && TAG.test(clean) ? clean : null;
}

function host(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Джерело візиту. Порядок навмисний: мітка з фіду точніша за реферер, бо
 * реферер губиться на редиректах і в застосунках-браузерах.
 */
export function resolveSource(
  search: string,
  referrer: string | null,
  ownHost: string
): Attribution {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const utm = sourceTag(params.get("utm_source"));
  if (utm) {
    return {
      source: utm,
      medium: sourceTag(params.get("utm_medium")) ?? "referral",
      campaign: sourceTag(params.get("utm_campaign")),
    };
  }

  const from = host(referrer);
  const own = ownHost.replace(/^www\./, "").toLowerCase();
  if (!from || from === own) return DIRECT;

  const known = KNOWN.find((k) => k.re.test(from));
  if (known) return { source: known.source, medium: known.medium, campaign: null };

  return { source: from.slice(0, 40), medium: "referral", campaign: null };
}

/** Рядок для localStorage. Короткі ключі — сховище ділимо з кошиком. */
export function packSource(a: Attribution, now: number): string {
  return JSON.stringify({ s: a.source, m: a.medium, c: a.campaign, t: now });
}

/** Назад із localStorage, якщо не старше 30 днів. */
export function unpackSource(raw: string | null, now: number): Attribution | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { s?: unknown; m?: unknown; c?: unknown; t?: unknown };
    const source = sourceTag(typeof v.s === "string" ? v.s : null);
    const at = typeof v.t === "number" ? v.t : 0;
    if (!source || !at) return null;
    if (now - at > SOURCE_MEMORY_DAYS * 86_400_000) return null;
    return {
      source,
      medium: sourceTag(typeof v.m === "string" ? v.m : null) ?? "referral",
      campaign: sourceTag(typeof v.c === "string" ? v.c : null),
    };
  } catch {
    return null;
  }
}
```

Увага: `sourceTag` дозволяє лише `[a-z0-9_-]`, а хост містить крапку. Щоб
перевірка «чужий сайт — хостом» проходила, у `resolveSource` хост
повертається без `sourceTag`, а `unpackSource` має приймати і крапку —
розширити `TAG` до `/^[a-z0-9._-]+$/` і додати в `check-source.mts` випадок:

```ts
eq("хост із пам'яті читається", unpackSource(packSource({ source: "ek.ua", medium: "referral", campaign: null }, now), now), {
  source: "ek.ua",
  medium: "referral",
  campaign: null,
});
```

- [ ] **Крок 4: Запустити перевірку — має пройти**

```bash
npx tsx scripts/check-source.mts
```

Очікуємо «Усе гаразд.» і код виходу 0.

- [ ] **Крок 5: Комміт**

```bash
git add src/lib/webstats/source.ts scripts/check-source.mts
git commit -m "Джерело переходу: розбір мітки й реферера з пам'яттю на 30 днів"
git show --stat HEAD
```

---

### Task 3: Джерело доїжджає до бази

**Files:**
- Modify: `src/lib/webstats/client.ts` (тип `WebstatsPayload` ~36–44, `QueuedEvent` ~46)
- Modify: `src/components/webstats/WebstatsTracker.tsx:122-132`
- Modify: `src/app/api/site-events/route.ts` (тип `RawEvent` ~40–48, збирання `data` ~105–130)
- Modify: `src/app/checkout/page.tsx:158-168`
- Modify: `src/lib/orders/create-order.ts` (тип `CreateOrderInput` ~28–37, `tx.order.create` ~179–197)

**Interfaces:**
- Consumes: `resolveSource`, `packSource`, `unpackSource`, `SOURCE_MEMORY_KEY` (Task 2);
  колонки з Task 1.
- Produces: подія з полем `src`; `Order.source/sourceMedium/sourceCampaign` заповнені.

- [ ] **Крок 1: Поле `src` у клієнті аналітики**

У `src/lib/webstats/client.ts`, в `WebstatsPayload`, після `referrer`:

```ts
  /** Джерело візиту — лише на першій події сесії (src/lib/webstats/source.ts). */
  src?: string | null;
```

- [ ] **Крок 2: Трекер визначає й запам'ятовує джерело**

У `src/components/webstats/WebstatsTracker.tsx` додати імпорт:

```ts
import { resolveSource, packSource, SOURCE_MEMORY_KEY, DIRECT } from "@/lib/webstats/source";
```

і замінити тіло ефекту `page_view` (рядки 122–132) на:

```ts
  useEffect(() => {
    if (!pathname || isInternalPath(pathname)) return;
    const fresh = isNewSession();
    const referrer = fresh && document.referrer ? document.referrer : null;

    let src: string | null = null;
    if (fresh) {
      const attribution = resolveSource(
        window.location.search,
        document.referrer || null,
        window.location.host
      );
      src = attribution.source;
      // Прямий захід не перетирає майданчик: людина могла побачити товар
      // на Hotline, а за два дні прийти на сайт сама — замовлення все одно
      // заробив Hotline.
      if (attribution.source !== DIRECT.source) {
        try {
          localStorage.setItem(SOURCE_MEMORY_KEY, packSource(attribution, Date.now()));
        } catch {
          /* приватний режим — джерело просто не запам'ятається */
        }
      }
    }

    track("page_view", {
      path: pathname,
      referrer: referrer && !referrer.includes(window.location.host) ? referrer : null,
      src,
    });
    noteHumanPath(pathname);
  }, [pathname]);
```

- [ ] **Крок 3: Приймання на сервері**

У `src/app/api/site-events/route.ts`: додати `src?: unknown;` в `RawEvent`,
імпортувати санітайзер

```ts
import { sourceTag } from "@/lib/webstats/source";
```

і в об'єкті події (поряд із `referrer`) додати:

```ts
        source: sourceTag(typeof e.src === "string" ? e.src : null),
```

- [ ] **Крок 4: Оформлення передає джерело**

У `src/app/checkout/page.tsx` додати імпорт:

```ts
import { unpackSource, SOURCE_MEMORY_KEY } from "@/lib/webstats/source";
```

і в тіло `fetch("/api/orders")` після `comment: form.comment,` додати:

```ts
        // Звідки прийшов покупець — з пам'яті браузера (30 днів). Читаємо
        // тут, а не на сервері: на сервері цього знання немає, кука для
        // нього вбила б кеш каталогу.
        ...(() => {
          let attribution = null;
          try {
            attribution = unpackSource(localStorage.getItem(SOURCE_MEMORY_KEY), Date.now());
          } catch {
            /* сховище недоступне */
          }
          return attribution
            ? {
                source: attribution.source,
                sourceMedium: attribution.medium,
                sourceCampaign: attribution.campaign,
              }
            : {};
        })(),
```

- [ ] **Крок 5: Замовлення зберігає джерело**

У `src/lib/orders/create-order.ts`:

додати імпорт `import { sourceTag } from "@/lib/webstats/source";`

у `CreateOrderInput` додати три поля:

```ts
  source?: unknown;
  sourceMedium?: unknown;
  sourceCampaign?: unknown;
```

перед `let order;` (рядок ~175) додати розбір:

```ts
  // Джерело переходу приходить із браузера, тож проходить той самий
  // санітайзер, що й мітка в аналітиці: у базу лягає або чиста мітка, або нічого.
  const source = sourceTag(typeof body.source === "string" ? body.source : null);
  const sourceMedium = sourceTag(typeof body.sourceMedium === "string" ? body.sourceMedium : null);
  const sourceCampaign = sourceTag(
    typeof body.sourceCampaign === "string" ? body.sourceCampaign : null
  );
```

і в `tx.order.create({ data: { ... } })` після `salesRepId,` додати:

```ts
          source,
          sourceMedium,
          sourceCampaign,
```

- [ ] **Крок 6: Перевірити збірку й типи**

```bash
npx tsc --noEmit
npm run lint
```

Очікуємо: помилок немає.

- [ ] **Крок 7: Комміт**

```bash
git add src/lib/webstats/client.ts src/components/webstats/WebstatsTracker.tsx src/app/api/site-events/route.ts src/app/checkout/page.tsx src/lib/orders/create-order.ts
git commit -m "Візит і замовлення записують джерело переходу"
git show --stat HEAD
```

---

### Task 4: Фід Hotline

**Files:**
- Create: `src/lib/feeds/hotline.ts`
- Create: `src/app/feeds/hotline.xml/route.ts`
- Create: `scripts/check-hotline-feed.mts`

**Interfaces:**
- Consumes: `indexableProductWhere()` з `@/lib/seo/indexable`, `isRealSku` з
  `@/lib/catalog/sku-search`, `isHiddenCategory` з `@/lib/catalog/category-display`,
  `SECTION_BY_ID`, `TYPE_LABELS` з `@/lib/catalog/classify`, `escapeXml`,
  `stripHtml`, `absoluteUrl`, `SITE_NAME` з `@/lib/seo/site`, `DELIVERY_TERMS` з
  `@/lib/delivery-terms`.
- Produces:
  - `HOTLINE = { minPrice: 2000, excludeSections: ["krip"] }`
  - `type FeedItem = { id, categoryId, code, barcode, vendor, name, description, url, image, price }`
  - `feedItemId(productId: string): string`
  - `categoryId(key: string): number`
  - `buildHotlineXml(items: FeedItem[], cats: FeedCategory[], opts: { date: string; firmId: string | null }): string`
  - `loadHotlineFeed(): Promise<{ items: FeedItem[]; categories: FeedCategory[] }>`

- [ ] **Крок 1: Написати перевірку, яка падає**

Створити `scripts/check-hotline-feed.mts`:

```ts
/**
 * Перевірка фіду Hotline. READ ONLY: лише SELECT по базі сайту.
 *
 * Запуск: npx tsx --env-file=.env scripts/check-hotline-feed.mts
 */
import {
  HOTLINE,
  feedItemId,
  categoryId,
  buildHotlineXml,
  loadHotlineFeed,
} from "../src/lib/feeds/hotline";

let failed = 0;
function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(`${condition ? "✅" : "❌"} ${name}${condition || !detail ? "" : `\n   ${detail}`}`);
}

// 1. Ідентифікатори
const id = feedItemId("cmf1a2b3c4d5e6f7g8h9i0jk");
ok("id товару ≤ 20 символів", id.length <= 20, `маємо ${id.length}: ${id}`);
ok("id товару стабільний", id === feedItemId("cmf1a2b3c4d5e6f7g8h9i0jk"));
ok("різні товари — різні id", feedItemId("a") !== feedItemId("b"));
ok("id категорії — додатне ціле", Number.isInteger(categoryId("s:elektro")) && categoryId("s:elektro") > 0);
ok("id категорії стабільний", categoryId("t:шуруповерт") === categoryId("t:шуруповерт"));

// 2. XML
const xml = buildHotlineXml(
  [
    {
      id: "abc",
      categoryId: 42,
      code: 'ША 3420*4 "R"',
      barcode: "4820000000001",
      vendor: "APRO",
      name: "Дриль ударний <тест> & Co",
      description: "Опис із <b>розміткою</b> та 'лапками'",
      url: "https://www.budvik27.com/catalog/dryl?utm_source=hotline",
      image: "https://cdn/1.jpg",
      price: 2499.5,
    },
  ],
  [{ id: 42, parentId: null, name: "Електроінструмент" }],
  { date: "2026-09-22 10:00", firmId: null }
);

ok("немає сирих кутових дужок у назві", !xml.includes("<тест>"));
ok("амперсанд екранований", xml.includes("&amp;"));
ok("ціна без розділювачів розрядів", xml.includes("<priceRUAH>2499.50</priceRUAH>"));
ok("наявність одним значенням", xml.includes("<stock>В наявності</stock>"));
ok("оплата при отриманні", xml.includes('payment type="cash-on-delivery"'));
ok("гарантію не вигадуємо", !xml.includes("<guarantee"));
ok("корінь price", xml.trimStart().startsWith('<?xml') && xml.includes("<price>"));

// 3. Відбір із бази
const { items, categories } = await loadHotlineFeed();
console.log(`\nУ фіді ${items.length} товарів, ${categories.length} категорій.`);
ok("фід не порожній", items.length > 0);
ok("усі дорожчі за поріг", items.every((i) => i.price >= HOTLINE.minPrice));
ok("у кожного є артикул", items.every((i) => i.code.trim().length > 0));
ok("у кожного є бренд", items.every((i) => i.vendor.trim().length > 0));
ok("немає сурогатних артикулів 1С", items.every((i) => !i.code.startsWith("1C-")));
ok("id унікальні", new Set(items.map((i) => i.id)).size === items.length);
ok("усі id ≤ 20 символів", items.every((i) => i.id.length <= 20));
ok(
  "кожен товар має свою категорію",
  items.every((i) => categories.some((c) => c.id === i.categoryId))
);
ok("посилання з міткою hotline", items.every((i) => i.url.includes("utm_source=hotline")));

console.log(failed === 0 ? "\nУсе гаразд." : `\nПомилок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Крок 2: Запустити — має впасти**

```bash
npx tsx --env-file=.env scripts/check-hotline-feed.mts
```

Очікуємо «Cannot find module '../src/lib/feeds/hotline'».

- [ ] **Крок 3: Написати `src/lib/feeds/hotline.ts`**

```ts
/**
 * Товарний фід Hotline: відбір позицій і збирання XML.
 *
 * Чому не всі 5,5 тис. товарів у наявності: Hotline бере 7,5 грн за КОЖЕН
 * перехід незалежно від покупки, тож товар, який заробляє менше, ніж коштує
 * десяток кліків, віддавати туди — гарантований мінус (розрахунок у
 * docs/hotline.md). Поріг тут — не смак, а точка беззбитковості.
 *
 * Роут лише віддає те, що зібрано тут: логіка в чистих функціях, щоб її
 * перевіряв scripts/check-hotline-feed.mts без підняття сервера.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { indexableProductWhere } from "@/lib/seo/indexable";
import { isRealSku } from "@/lib/catalog/sku-search";
import { isHiddenCategory } from "@/lib/catalog/category-display";
import { SECTION_BY_ID, TYPE_LABELS } from "@/lib/catalog/classify";
import { absoluteUrl, escapeXml, stripHtml, SITE_NAME } from "@/lib/seo/site";
import { DELIVERY_TERMS } from "@/lib/delivery-terms";

export const HOTLINE = {
  /** Точка беззбитковості при 7,5 грн за клік — див. docs/hotline.md. */
  minPrice: 2000,
  /** Кріплення й метизи: у рубрикаторі Hotline таких рубрик немає взагалі. */
  excludeSections: ["krip"] as string[],
  /** Мітка, за якою звіт упізнає переходи з Hotline. */
  utm: "utm_source=hotline&utm_medium=cpc&utm_campaign=feed",
};

export type FeedItem = {
  id: string;
  categoryId: number;
  code: string;
  barcode: string | null;
  vendor: string;
  name: string;
  description: string;
  url: string;
  image: string;
  price: number;
};

export type FeedCategory = { id: number; parentId: number | null; name: string };

/**
 * Id товару для Hotline: до 20 символів, і його не можна перевикористати.
 * cuid у нас 25 символів, тож беремо стабільний хеш — він не зміниться,
 * поки живий сам товар.
 */
export function feedItemId(productId: string): string {
  const hex = createHash("sha1").update(productId).digest("hex").slice(0, 16);
  return BigInt(`0x${hex}`).toString(36).slice(0, 20);
}

/** Числовий id категорії з її ключа — стабільний між вивантаженнями. */
export function categoryId(key: string): number {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 8);
  return parseInt(hex, 16);
}

/** Ціна вітрини: акційна, якщо діє. Та сама, що бачить покупець. */
function shownPrice(p: { price: number; isPromo: boolean; promoPrice: number | null }): number {
  return p.isPromo && p.promoPrice && p.promoPrice < p.price ? p.promoPrice : p.price;
}

export async function loadHotlineFeed(): Promise<{
  items: FeedItem[];
  categories: FeedCategory[];
}> {
  const products = await prisma.product.findMany({
    where: {
      ...indexableProductWhere(),
      stock: { gt: 0 },
      price: { gte: HOTLINE.minPrice },
      brandId: { not: null },
      sectionId: { notIn: HOTLINE.excludeSections },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      price: true,
      isPromo: true,
      promoPrice: true,
      image: true,
      sku: true,
      barcodes: true,
      sectionId: true,
      typeKey: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });

  const categories = new Map<number, FeedCategory>();
  const items: FeedItem[] = [];

  for (const p of products) {
    // Артикул виробника обов'язковий: внутрішні коди магазину Hotline
    // забороняє, а сурогат «1C-…» саме таким кодом і є.
    if (!isRealSku(p.sku) || !p.brand || !p.sectionId) continue;
    if (isHiddenCategory(p.category?.name)) continue;

    const section = SECTION_BY_ID.get(p.sectionId);
    if (!section) continue;

    const sectionCatId = categoryId(`s:${section.id}`);
    if (!categories.has(sectionCatId)) {
      categories.set(sectionCatId, { id: sectionCatId, parentId: null, name: section.title });
    }

    // Лист дерева — тип товару; без типу товар лишається в категорії розділу.
    let cat = sectionCatId;
    const typeLabel = p.typeKey ? TYPE_LABELS[p.typeKey] : null;
    if (p.typeKey && typeLabel) {
      cat = categoryId(`t:${p.typeKey}`);
      if (!categories.has(cat)) {
        categories.set(cat, { id: cat, parentId: sectionCatId, name: typeLabel });
      }
    }

    items.push({
      id: feedItemId(p.id),
      categoryId: cat,
      code: p.sku!,
      barcode: p.barcodes[0] ?? null,
      vendor: p.brand.name,
      name: p.name,
      description: stripHtml(p.description).slice(0, 1000) || p.name,
      url: `${absoluteUrl(`/catalog/${p.slug}`)}?${HOTLINE.utm}`,
      image: p.image!,
      price: shownPrice(p),
    });
  }

  return { items, categories: [...categories.values()] };
}

export function buildHotlineXml(
  items: FeedItem[],
  categories: FeedCategory[],
  opts: { date: string; firmId: string | null }
): string {
  const cats = categories
    .map(
      (c) =>
        `<category><id>${c.id}</id>${
          c.parentId ? `<parentId>${c.parentId}</parentId>` : ""
        }<name>${escapeXml(c.name)}</name></category>`
    )
    .join("\n");

  const rows = items
    .map(
      (i) => `<item>
<id>${i.id}</id>
<categoryId>${i.categoryId}</categoryId>
<code>${escapeXml(i.code)}</code>${
        i.barcode ? `\n<barcode>${escapeXml(i.barcode)}</barcode>` : ""
      }
<vendor>${escapeXml(i.vendor)}</vendor>
<name>${escapeXml(i.name)}</name>
<description>${escapeXml(i.description)}</description>
<url>${escapeXml(i.url)}</url>
<image>${escapeXml(i.image)}</image>
<priceRUAH>${i.price.toFixed(2)}</priceRUAH>
<stock>В наявності</stock>
<condition>0</condition>
<payment type="cash-on-delivery">true</payment>
</item>`
    )
    .join("\n");

  // Доставка — та сама, що на сторінці «Оплата і доставка» й у фіді Google:
  // майданчики звіряють її з тим, що покупець бачить при оформленні.
  const delivery = `<delivery id="3" type="warehouse" carrier="NP" cost="${DELIVERY_TERMS.fee}"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<price>
<date>${opts.date}</date>
<firmName>${escapeXml(SITE_NAME)}</firmName>
<firmId>${opts.firmId ?? ""}</firmId>
${delivery}
<categories>
${cats}
</categories>
<items>
${rows}
</items>
</price>`;
}
```

- [ ] **Крок 4: Запустити перевірку — має пройти**

```bash
npx tsx --env-file=.env scripts/check-hotline-feed.mts
```

Очікуємо «Усе гаразд.» і ~300 товарів у звіті.

- [ ] **Крок 5: Написати роут**

Створити `src/app/feeds/hotline.xml/route.ts`:

```ts
import { loadHotlineFeed, buildHotlineXml } from "@/lib/feeds/hotline";

/** Година кешу — як у фіді Merchant Center; Hotline частіше й не забирає. */
export const revalidate = 3600;

/**
 * Товарний фід для Hotline (https://hotline.ua/ua/about/pricelists_specs/).
 *
 * Окремий роут, а не параметр до фіду Google: формати різні (у Hotline свій
 * XML замість RSS), і склад інший — на Hotline платимо за кожен перехід,
 * тож туди їде лише дорогий товар.
 */
export async function GET() {
  const { items, categories } = await loadHotlineFeed();

  // Київський час: Hotline звіряє дату фіду зі своїм годинником.
  const date = new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/Kyiv" })
    .slice(0, 16);

  const xml = buildHotlineXml(items, categories, {
    date,
    firmId: process.env.HOTLINE_FIRM_ID ?? null,
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
```

- [ ] **Крок 6: Перевірити роут на локальному сервері**

```bash
npm run dev &
sleep 12
curl -s "http://localhost:3000/feeds/hotline.xml" | head -30
curl -s "http://localhost:3000/feeds/hotline.xml" | grep -c "<item>"
```

Очікуємо коректну шапку `<price>` і кількість `<item>`, що збігається зі
звітом перевірки. Зупинити сервер після перевірки.

- [ ] **Крок 7: Комміт**

```bash
git add src/lib/feeds/hotline.ts src/app/feeds/hotline.xml/route.ts scripts/check-hotline-feed.mts
git commit -m "Товарний фід для Hotline"
git show --stat HEAD
```

---

### Task 5: Вкладка «Джерела»

**Files:**
- Create: `src/lib/webstats/sources.ts`
- Create: `src/app/api/admin/site-analytics/sources/route.ts`
- Create: `src/app/admin/site-analytics/components/SourcesTab.tsx`
- Modify: `src/app/admin/site-analytics/components/SiteAnalyticsShell.tsx:22-27` (список вкладок) і місце, де рендериться активна вкладка

**Interfaces:**
- Consumes: `peopleOnly`, `TrafficView` з `@/lib/webstats/people`; `parsePeriod` з
  `@/lib/analytics/period`; колонки з Task 1.
- Produces:
  - `type SourceRow = { source: string; sessions: number; productViews: number; addToCarts: number; orders: number; revenue: number; conversion: number; avgCheck: number }`
  - `sourceReport(from: Date, to: Date, view: TrafficView): Promise<{ rows: SourceRow[] }>`

- [ ] **Крок 1: Написати `src/lib/webstats/sources.ts`**

```ts
/**
 * Звіт «Джерела»: скільки людей прийшло з кожного майданчика і скільки з
 * них купило.
 *
 * Візити рахуються за подією, а замовлення — за полем у самому замовленні.
 * Це навмисна асиметрія: візит належить сесії, а замовлення може статися
 * через тиждень після переходу, і прив'язка до сесії загубила б саме ті
 * покупки, заради яких платимо Hotline.
 */

import { prisma } from "@/lib/prisma";
import { peopleOnly, type TrafficView } from "@/lib/webstats/people";

export type SourceRow = {
  source: string;
  sessions: number;
  productViews: number;
  addToCarts: number;
  orders: number;
  revenue: number;
  /** Скільки візитів закінчилося замовленням, %. */
  conversion: number;
  avgCheck: number;
};

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
/** Подія без джерела — візит до вересня 2026, коли джерел ще не писали. */
const UNKNOWN = "невідомо";

export async function sourceReport(
  from: Date,
  to: Date,
  view: TrafficView = "people"
): Promise<{ rows: SourceRow[] }> {
  const people = peopleOnly(view, "e");

  const [visits, orders] = await Promise.all([
    prisma.$queryRaw<Array<{ source: string; sessions: bigint; product_views: bigint; add_to_carts: bigint }>>`
      WITH first_event AS (
        SELECT DISTINCT ON (e."sessionId")
          e."sessionId",
          COALESCE(e."source", ${UNKNOWN}) AS source
        FROM "SiteEvent" e
        WHERE e."createdAt" BETWEEN ${from} AND ${to} ${people}
        ORDER BY e."sessionId", e."createdAt"
      ),
      per_session AS (
        SELECT e."sessionId",
          bool_or(e."type" = 'product_view') AS pv,
          bool_or(e."type" = 'add_to_cart')  AS atc
        FROM "SiteEvent" e
        WHERE e."createdAt" BETWEEN ${from} AND ${to} ${people}
        GROUP BY e."sessionId"
      )
      SELECT f.source,
        COUNT(*)                          AS sessions,
        COUNT(*) FILTER (WHERE s.pv)      AS product_views,
        COUNT(*) FILTER (WHERE s.atc)     AS add_to_carts
      FROM first_event f
      LEFT JOIN per_session s ON s."sessionId" = f."sessionId"
      GROUP BY f.source
      ORDER BY sessions DESC`,
    prisma.$queryRaw<Array<{ source: string; orders: bigint; revenue: number }>>`
      SELECT COALESCE("source", ${UNKNOWN}) AS source,
        COUNT(*)              AS orders,
        COALESCE(SUM("totalAmount"), 0) AS revenue
      FROM "Order"
      WHERE "createdAt" BETWEEN ${from} AND ${to}
      GROUP BY 1`,
  ]);

  const byOrders = new Map(orders.map((o) => [o.source, o]));
  const sources = new Set<string>([...visits.map((v) => v.source), ...byOrders.keys()]);

  const rows = [...sources].map((source) => {
    const v = visits.find((x) => x.source === source);
    const o = byOrders.get(source);
    const sessions = n(v?.sessions);
    const ordersCount = n(o?.orders);
    const revenue = n(o?.revenue);
    return {
      source,
      sessions,
      productViews: n(v?.product_views),
      addToCarts: n(v?.add_to_carts),
      orders: ordersCount,
      revenue,
      conversion: sessions > 0 ? Math.round((ordersCount / sessions) * 1000) / 10 : 0,
      avgCheck: ordersCount > 0 ? Math.round(revenue / ordersCount) : 0,
    };
  });

  rows.sort((a, b) => b.sessions - a.sessions || b.orders - a.orders);
  return { rows };
}
```

- [ ] **Крок 2: Написати роут**

Створити `src/app/api/admin/site-analytics/sources/route.ts`:

```ts
/**
 * Звіт «Джерела». Запити живуть у src/lib/webstats/sources.ts — тут лише
 * доступ і розбір періоду, як у сусідньому overview.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { parseView } from "@/lib/webstats/people";
import { sourceReport } from "@/lib/webstats/sources";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const period = parsePeriod(params);
  const view = parseView(params);
  const data = await sourceReport(period.from, period.to, view);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    view,
    ...data,
  });
}
```

- [ ] **Крок 3: Перевірити роут запитом**

```bash
npx tsx --env-file=.env -e '
import { sourceReport } from "./src/lib/webstats/sources";
const to = new Date(); const from = new Date(Date.now() - 30*864e5);
console.table((await sourceReport(from, to, "all")).rows);
'
```

Очікуємо таблицю з рядками (щонайменше `невідомо` і `google` — старі події
джерела не мають).

- [ ] **Крок 4: Написати вкладку**

Створити `src/app/admin/site-analytics/components/SourcesTab.tsx` за зразком
сусіднього `EventsTab.tsx` (той самий хук завантаження, ті самі класи
таблиці). Зміст:

```tsx
"use client";

/**
 * «Джерела»: звідки приходять покупці й скільки з них купує.
 *
 * Колонка «Замовлення» рахується за полем самого замовлення, а не за
 * сесією: покупець із Hotline часто повертається за кілька днів.
 */

import { useEffect, useState } from "react";
import type { Period } from "@/components/ui/PeriodPicker";
import type { TrafficView } from "./SiteAnalyticsShell";

type Row = {
  source: string;
  sessions: number;
  productViews: number;
  addToCarts: number;
  orders: number;
  revenue: number;
  conversion: number;
  avgCheck: number;
};

export function SourcesTab({ period, view }: { period: Period; view: TrafficView }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetch(`/api/admin/site-analytics/sources?from=${period.from}&to=${period.to}&view=${view}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => alive && setRows(d.rows ?? []))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [period.from, period.to, view]);

  if (!rows) return <div className="p-6 text-sm text-g600">Рахую…</div>;
  if (rows.length === 0) return <div className="p-6 text-sm text-g600">За цей період переходів немає.</div>;

  return (
    <div className="overflow-x-auto rounded-xl border border-g200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-g50 text-left text-g600">
          <tr>
            <th className="px-3 py-2 font-medium">Джерело</th>
            <th className="px-3 py-2 font-medium">Візити</th>
            <th className="px-3 py-2 font-medium">Дивилися товар</th>
            <th className="px-3 py-2 font-medium">У кошик</th>
            <th className="px-3 py-2 font-medium">Замовлення</th>
            <th className="px-3 py-2 font-medium">Виручка</th>
            <th className="px-3 py-2 font-medium">Конверсія</th>
            <th className="px-3 py-2 font-medium">Середній чек</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.source} className="border-t border-g100">
              <td className="px-3 py-2.5 font-medium">{r.source}</td>
              <td className="px-3 py-2.5">{r.sessions}</td>
              <td className="px-3 py-2.5">{r.productViews}</td>
              <td className="px-3 py-2.5">{r.addToCarts}</td>
              <td className="px-3 py-2.5">{r.orders}</td>
              <td className="px-3 py-2.5">{r.revenue.toLocaleString("uk-UA")} ₴</td>
              <td className="px-3 py-2.5">{r.conversion} %</td>
              <td className="px-3 py-2.5">{r.avgCheck.toLocaleString("uk-UA")} ₴</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Перед написанням відкрити `EventsTab.tsx` і звірити назви класів і хук
завантаження — стиль має збігатися з рештою вкладок.

- [ ] **Крок 5: Додати вкладку в оболонку**

У `src/app/admin/site-analytics/components/SiteAnalyticsShell.tsx`:

імпорт `import { SourcesTab } from "./SourcesTab";`

у масив `TABS` після `{ key: "overview", label: "Огляд" }`:

```ts
  { key: "sources", label: "Джерела" },
```

і в місці рендеру вкладок додати гілку:

```tsx
      {tab === "sources" && <SourcesTab period={period} view={view} />}
```

- [ ] **Крок 6: Перевірити типи й екран**

```bash
npx tsc --noEmit
npm run lint
```

Потім `npm run dev`, відкрити `/admin/site-analytics?tab=sources`, переконатися,
що таблиця малюється і перемикач «Люди/Усі» на неї впливає.

- [ ] **Крок 7: Комміт**

```bash
git add src/lib/webstats/sources.ts src/app/api/admin/site-analytics/sources src/app/admin/site-analytics/components/SourcesTab.tsx src/app/admin/site-analytics/components/SiteAnalyticsShell.tsx
git commit -m "Вкладка «Джерела»: переходи, замовлення й конверсія по майданчиках"
git show --stat HEAD
```

---

### Task 6: Передача замовлення менеджеру

**Files:**
- Create: `src/lib/orders/for-1c.ts`
- Create: `src/app/api/admin/orders/[id]/entered-1c/route.ts`
- Modify: `src/app/admin/orders/[id]/page.tsx` (таблиця позицій ~210–240)
- Modify: `src/lib/orders/create-order.ts` (виклик `notifyStaffNewOrder` ~245–262)
- Modify: `src/lib/telegram/order-alerts.ts` (рядок позиції ~58–72)
- Modify: `scripts/check-source.mts` → ні; натомість Create: `scripts/check-order-for-1c.mts`

**Interfaces:**
- Consumes: `Order.enteredIn1CAt` (Task 1).
- Produces: `orderTextFor1C(order: OrderFor1C): string`, де
  `type OrderFor1C = { orderNumber: number; contactName: string | null; phone: string | null; city: string | null; address: string | null; deliveryMethod: string; comment: string | null; totalAmount: number; items: Array<{ sku: string | null; name: string; quantity: number; price: number }> }`

- [ ] **Крок 1: Написати перевірку, яка падає**

Створити `scripts/check-order-for-1c.mts`:

```ts
/**
 * Перевірка тексту замовлення для внесення в 1С. READ ONLY.
 *
 * Запуск: npx tsx scripts/check-order-for-1c.mts
 */
import { orderTextFor1C } from "../src/lib/orders/for-1c";

const text = orderTextFor1C({
  orderNumber: 1043,
  contactName: "Іван Коваль",
  phone: "+380671112233",
  city: "Львів",
  address: "Відділення №12",
  deliveryMethod: "DELIVERY",
  comment: "Подзвонити після 17:00",
  totalAmount: 5240,
  items: [
    { sku: "GR-17318", name: "Перфоратор Grösser GR-17318", quantity: 1, price: 4200 },
    { sku: null, name: "Свердло", quantity: 2, price: 520 },
  ],
});

let failed = 0;
function ok(name: string, condition: boolean) {
  if (!condition) failed++;
  console.log(`${condition ? "✅" : "❌"} ${name}`);
}

console.log(`\n${text}\n`);
ok("номер замовлення", text.includes("№ 1043"));
ok("телефон", text.includes("+380671112233"));
ok("артикул позиції", text.includes("GR-17318"));
ok("кількість і ціна", text.includes("1 шт") && text.includes("4200"));
ok("товар без артикулу помічений", text.includes("без артикулу"));
ok("сума", text.includes("5240"));
ok("коментар", text.includes("Подзвонити після 17:00"));

console.log(failed === 0 ? "Усе гаразд." : `Помилок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Крок 2: Запустити — має впасти**

```bash
npx tsx scripts/check-order-for-1c.mts
```

Очікуємо «Cannot find module '../src/lib/orders/for-1c'».

- [ ] **Крок 3: Написати `src/lib/orders/for-1c.ts`**

```ts
/**
 * Замовлення з сайту текстом — щоб менеджер вніс його в 1С.
 *
 * У 1С ми не пишемо нічого (docs/1c-read-only.md), тож замовлення вносить
 * людина. Єдине, що ми можемо, — зробити це внесення швидким: артикул
 * першим у рядку, бо саме за ним шукають номенклатуру.
 */

export type OrderFor1C = {
  orderNumber: number;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  deliveryMethod: string;
  comment: string | null;
  totalAmount: number;
  items: Array<{ sku: string | null; name: string; quantity: number; price: number }>;
};

export function orderTextFor1C(o: OrderFor1C): string {
  const head = [
    `Замовлення з сайту № ${o.orderNumber}`,
    `Клієнт: ${o.contactName ?? "—"}`,
    `Телефон: ${o.phone ?? "—"}`,
    o.deliveryMethod === "PICKUP"
      ? "Доставка: самовивіз"
      : `Доставка: ${[o.city, o.address].filter(Boolean).join(", ") || "—"}`,
  ];
  if (o.comment) head.push(`Коментар: ${o.comment}`);

  const lines = o.items.map(
    (i) =>
      `${i.sku ?? "без артикулу"} · ${i.name} · ${i.quantity} шт · ${i.price.toFixed(2)} грн`
  );

  return [...head, "", ...lines, "", `Разом: ${o.totalAmount.toFixed(2)} грн`].join("\n");
}
```

- [ ] **Крок 4: Запустити перевірку — має пройти**

```bash
npx tsx scripts/check-order-for-1c.mts
```

- [ ] **Крок 5: Роут позначки «Заведено в 1С»**

Створити `src/app/api/admin/orders/[id]/entered-1c/route.ts`:

```ts
/**
 * Позначка «менеджер вніс це замовлення в 1С».
 *
 * Ставить людина: у 1С ми не пишемо і дізнатися самі не можемо. Повторний
 * виклик знімає позначку — менеджер міг натиснути помилково.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id }, select: { enteredIn1CAt: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.order.update({
    where: { id },
    data: { enteredIn1CAt: order.enteredIn1CAt ? null : new Date() },
    select: { enteredIn1CAt: true },
  });

  return NextResponse.json({ enteredIn1CAt: updated.enteredIn1CAt });
}
```

- [ ] **Крок 6: Кнопки на сторінці замовлення**

У `src/app/admin/orders/[id]/page.tsx` поруч із наявною кнопкою вивантаження
в Excel додати дві: «Скопіювати для 1С» (складає текст через `orderTextFor1C`
і кладе в буфер через `navigator.clipboard.writeText`, показує «Скопійовано»
на 2 секунди) і «Заведено в 1С» (POST на роут із кроку 5, після відповіді
показує дату або порожню позначку). Якщо сторінка серверна — винести кнопки
в невеликий клієнтський компонент поряд із нею.

Перед правкою прочитати файл цілком: у ньому вже є клієнтська частина зі
зміною статусу, і кнопки мають стати в той самий ряд.

- [ ] **Крок 7: Артикули в сповіщенні Telegram**

У `src/lib/orders/create-order.ts` у виклику `notifyStaffNewOrder` замінити

```ts
    items: order.items.map((i) => ({ name: i.product.name, quantity: i.quantity })),
```

на

```ts
    items: order.items.map((i) => ({
      sku: i.product.sku,
      name: i.product.name,
      quantity: i.quantity,
    })),
```

і в `include` того ж запиту (`tx.order.create`) розширити вибірку товару:

```ts
        include: { items: { include: { product: { select: { name: true, sku: true } } } } },
```

У `src/lib/telegram/order-alerts.ts` розширити тип позиції на
`{ sku?: string | null; name: string; quantity: number }` і в рядку позиції
писати артикул попереду назви: `${i.sku ? `${i.sku} · ` : ""}${i.name} — ${i.quantity} шт`.

- [ ] **Крок 8: Перевірити типи й лінт**

```bash
npx tsc --noEmit
npm run lint
```

- [ ] **Крок 9: Комміт**

```bash
git add src/lib/orders/for-1c.ts scripts/check-order-for-1c.mts src/app/api/admin/orders/[id]/entered-1c src/app/admin/orders/[id]/page.tsx src/lib/orders/create-order.ts src/lib/telegram/order-alerts.ts
git commit -m "Замовлення для менеджера: текст для 1С, позначка внесення, артикули в сповіщенні"
git show --stat HEAD
```

---

### Task 7: Викочування й перевірка на проді

**Files:**
- Modify: `docs/hotline.md` (розділ «Ручні кроки» — дописати підсумок перевірки)

**Interfaces:**
- Consumes: усе попереднє.

- [ ] **Крок 1: Звірити залишки товарів фіду**

```bash
npx tsx --env-file=.env -e '
import { loadHotlineFeed } from "./src/lib/feeds/hotline";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const { items } = await loadHotlineFeed();
const rows: any[] = await prisma.$queryRawUnsafe(`
  SELECT COUNT(*)::int items,
    COUNT(*) FILTER (WHERE p."syncedAt" < now() - interval ${"'"}7 days${"'"})::int stale,
    COUNT(*) FILTER (WHERE p."syncedAt" IS NULL)::int never_synced
  FROM "Product" p WHERE p."isActive" AND p.stock > 0 AND p.price >= 2000`);
console.log(`У фіді ${items.length}`, rows[0]);
await prisma.$disconnect();
'
```

Якщо `stale` помітний — виписати ці позиції й показати власнику: товар із
застиглим залишком на Hotline дає скаргу «немає в наявності».

- [ ] **Крок 2: Накотити міграцію на прод**

```bash
npm run db:migrate:prod
```

Очікуємо `Applied migration(s)` без помилок. Робиться тим самим рухом, що й
пуш, — інакше прод отримає новий код зі старою базою.

- [ ] **Крок 3: Пуш**

```bash
git push origin main
```

- [ ] **Крок 4: Перевірити фід на проді не-браузерним клієнтом**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -A "HotlineBot/1.0" https://www.budvik27.com/feeds/hotline.xml
curl -s -A "HotlineBot/1.0" https://www.budvik27.com/feeds/hotline.xml | grep -c "<item>"
```

Очікуємо `200` і кількість позицій. Якщо прилетить 429 — у дашборді Vercel
вимкнений/увімкнений «Attack Challenge Mode» ріже не-браузерні клієнти:
виключити `/feeds/*` або зняти режим.

- [ ] **Крок 5: Пройти шлях покупця з міткою**

Відкрити `https://www.budvik27.com/catalog/<будь-який-товар>?utm_source=hotline&utm_medium=cpc&utm_campaign=feed`,
покласти товар у кошик, оформити тестове замовлення. Далі:

```bash
npx tsx --env-file=.env -e '
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
console.log(await prisma.order.findMany({ take: 3, orderBy: { createdAt: "desc" }, select: { orderNumber: true, source: true, sourceMedium: true, sourceCampaign: true } }));
console.log(await prisma.siteEvent.findMany({ take: 3, where: { source: { not: null } }, orderBy: { createdAt: "desc" }, select: { type: true, source: true } }));
await prisma.$disconnect();
'
```

Очікуємо `source: "hotline"` і в замовленні, і в події. Після перевірки
скасувати тестове замовлення в адмінці.

- [ ] **Крок 6: Перевірити вкладку**

Відкрити `/admin/site-analytics?tab=sources&view=all` — тестове замовлення
має бути в рядку `hotline`.

- [ ] **Крок 7: Дописати підсумок у документ і закомітити**

У `docs/hotline.md`, у «Ручні кроки», дописати рядок із фактичною кількістю
товарів у фіді та датою перевірки.

```bash
git add docs/hotline.md
git commit -m "Hotline: підсумок перевірки фіду на проді"
git push origin main
git show --stat HEAD
```

---

## Самоперевірка плану

**Покриття спеки:**

| Розділ `docs/hotline.md` | Задача |
|---|---|
| 1. Фід (відбір, категорії, поля, мітки, кеш) | Task 4 |
| 2. Облік джерела (розбір, пам'ять 30 днів, запис) | Task 2, Task 3 |
| 3. Вкладка «Джерела» | Task 5 |
| 4. Передача замовлення менеджеру | Task 6 |
| Перевірка (скрипти, міграція, прод) | Task 2, 4, 6, 7 |
| Ризики (залишки, челендж Vercel) | Task 7, кроки 1 і 4 |

Розріз по товарах усередині вкладки «Джерела» зі спеки свідомо відкладено:
на пілоті рядків буде менше десятка, і таблиця джерел відповідає на головне
питання. Додамо, коли буде що дивитися.

**Типи наскрізь:** `Attribution` (Task 2) → поле `src` події (Task 3) →
колонка `SiteEvent.source` (Task 1) → `SourceRow.source` (Task 5).
`FeedItem` живе лише всередині Task 4. `OrderFor1C` — лише Task 6.
