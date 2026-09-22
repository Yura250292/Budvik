# Планування доставки помічником — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Помічник складає маршрути водіям на день: розподіляє непривезені реалізації між водіями за історією листів, шикує порядок обʼїзду через OSRM і віддає менеджеру чернетки, які той править на карті.

**Architecture:** Чисте ядро `plan-day.ts` (без Prisma й без мережі) рахує грона точок і роздачу водіям; профілі з історії дає `delivery-habits.ts`; кандидатів дня — `plan-candidates.ts`; роут `/api/routes/plan-day` складає все разом і докидає порядок від наявного `optimizeRoute`; `/api/routes/plan-day/apply` створює чернетки `DeliveryRoute`. Модель не рахує жодного числа — вона лише викликає режим `day_plan` наявного інструмента `build_route` і переказує результат.

**Tech Stack:** Next.js 16 (App Router), Prisma, PostgreSQL, OSRM, Leaflet, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-22-planuvannia-dostavky-design.md`

## Global Constraints

- **У 1С не пишемо нічого.** Уся історія читається з таблиць сайту (`RouteSheet`, `RouteSheetStop`), куди її кладе обмін. Жодних записів у 1С, навіть діагностичних.
- **Міграцій у цій роботі немає.** Жодного нового поля в `prisma/schema.prisma`. Якщо десь здається, що поле потрібне, — це сигнал зупинитись і спитати, а не писати міграцію.
- **Модель не рахує чисел.** Кілометри й хвилини — тільки з OSRM, суми — тільки з бази. Попередня версія оптимізації на LLM вигадувала кілометраж, і він лягав у розрахунок пального як факт.
- **Новий інструмент помічника не додається.** У керівника рівно 23 інструменти, це стеля; рости можна лише режимами (`mode`) усередині наявних схем.
- **Імена полів у схемах інструментів — латиницею** (кирилиця дає 400 від провайдера).
- **Юніт-фреймворку в репозиторії немає.** Перевірка — скрипти `scripts/check-*.mts`, які запускаються через `npx tsx --env-file=.env` і завершуються ненульовим кодом при провалі. Це усталений жанр репозиторію (`check-fix-gate.mts`, `check-day-contract.ts`), і саме він грає тут роль тестів.
- **Коментарі в коді — українською**, як у решті `src/lib/routes/`. Шапка файлу пояснює *чому*, а не *що*.
- **Скрипти-проби, які читають базу, мають у шапці `Лише читання бази.`**

## Файлова структура

| Файл | Відповідальність |
| --- | --- |
| `src/lib/routes/plan-day.ts` | чисте ядро: грона, роздача водіям, відкладені. Без Prisma, без мережі, без `next/*`. Тут же живуть `pairKey` і тип `DriverHabit` — ядро не має залежати від модуля з базою |
| `src/lib/routes/delivery-habits.ts` | читає історію листів і віддає пʼять профілів. Єдине місце, де живе SQL по історії |
| `src/lib/routes/plan-candidates.ts` | кандидати дня з бази: що ще не поїхало, у кого немає піна, що поза зоною розвозки |
| `src/lib/routes/build-day-plan.ts` | складає план: кандидати + профілі + ядро + OSRM. Спільний для роуту й помічника |
| `src/app/api/routes/plan-day/route.ts` | тонкий роут над `buildDayPlan`: ролі, розбір тіла, відповідь |
| `src/app/api/routes/plan-day/apply/route.ts` | створює чернетки `DeliveryRoute` за готовим планом |
| `src/app/admin/logistics/delivery/components/PlanTab.tsx` | вкладка «План»: колонки водіїв, карта, правки |
| `src/lib/assistant/tools/route.ts` | режим `day_plan` у наявному `build_route` |
| `scripts/check-delivery-habits.mts` | перевірка профілів на реальній історії |
| `scripts/check-plan-day.mts` | перевірка ядра на синтетичних даних, без бази |
| `scripts/check-plan-candidates.mts` | перевірка вибірки кандидатів |

Поділ «порахувати» і «застосувати» повторює наявну пару `/api/routes/optimize-day` + `/api/routes/apply-order`: подивитися, скільки коштує, не повинно міняти план дня.

---

### Task 1: Ядро планування

**Files:**
- Create: `src/lib/routes/plan-day.ts`
- Test: `scripts/check-plan-day.mts`

**Interfaces:**
- Consumes: `CorridorIndex` з `@/lib/routes/corridor`; `haversineM` з `@/lib/track/geo`. Більше нічого — ядро не залежить від жодного модуля з базою.
- Produces: `planDay(input: PlanInput): DayPlan`, `clusterPoints(points, depot, radiusKm): PlanCluster[]`, `pairKey(a, b)`, `PAIR_MIN`, `DEFAULT_PLAN_OPTIONS`, типи `PlanPoint`, `PlanDriver`, `PlanHabits`, `PlanCluster`, `PlanRoute`, `DeferredCluster`, `DayPlan`, `PlanOptions`, `DriverHabit`.

- [ ] **Step 1: Написати перевірку, яка падає**

Створити `scripts/check-plan-day.mts`:

```ts
/**
 * Ядро планування на синтетичних точках.
 *
 * База тут не потрібна навмисно: ядро — чиста функція, і саме тому його
 * поведінку можна закріпити випадками, які в реальному дні трапляються
 * раз на місяць (далеке дешеве гроно, вичерпана межа дня, закріплена точка).
 *
 *   npx tsx scripts/check-plan-day.mts
 *
 * Бази не торкається.
 */

import { planDay, clusterPoints, DEFAULT_PLAN_OPTIONS, type PlanPoint, type PlanDriver } from "../src/lib/routes/plan-day";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

/** Склад Budvik — Львів. */
const depot = { lat: 49.84, lng: 24.03 };

function pt(id: string, lat: number, lng: number, amount: number): PlanPoint {
  return {
    id,
    counterpartyId: `cp-${id}`,
    name: id,
    lat,
    lng,
    amount,
    score: 0.3,
    pinnedDriverId: null,
  };
}

// Місто: десять точок навколо складу.
const city = Array.from({ length: 10 }, (_, i) => pt(`city${i}`, 49.84 + i * 0.004, 24.03 + i * 0.004, 4000));
// Захід, ~40 км: шість точок, добрі гроші.
const west = Array.from({ length: 6 }, (_, i) => pt(`west${i}`, 49.86 + i * 0.004, 23.52 + i * 0.004, 7000));
// Південь, ~75 км: дві точки на 4 000 ₴ разом — рейс не окупиться.
const south = [pt("south0", 49.24, 23.85, 2000), pt("south1", 49.25, 23.86, 2000)];

const points = [...city, ...west, ...south];

const drivers: PlanDriver[] = [
  { id: "d1", name: "Пайда", maxStops: 16 },
  { id: "d2", name: "Піцишин", maxStops: 13 },
];

/* ── Грона ──────────────────────────────────────────────────────────── */

const clusters = clusterPoints(points, depot, DEFAULT_PLAN_OPTIONS.clusterRadiusKm);
check("три грона", clusters.length === 3, clusters.map((c) => c.points.length).join("+"));
check(
  "південні точки в одному гроні",
  clusters.some((c) => c.points.length === 2 && c.points.every((p) => p.id.startsWith("south"))),
  clusters.map((c) => c.points[0].id).join(", ")
);

/* ── Відкладені ─────────────────────────────────────────────────────── */

const habits = {
  driverByClient: new Map<string, { driverId: string; count: number }[]>(),
  weekdayByClient: new Map<string, number[]>(),
  pairs: new Map<string, number>(),
};

const plain = planDay({ points, drivers, habits, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
const deferredIds = plain.deferred.flatMap((d) => d.points.map((p) => p.id));
check("далеке дешеве гроно відкладено", deferredIds.includes("south0") && deferredIds.includes("south1"), deferredIds.join(", "));
check("відкладене має причину", plain.deferred.every((d) => d.reason.length > 0), plain.deferred.map((d) => d.reason).join(" | "));

const planned = plain.routes.flatMap((r) => r.points.map((p) => p.id));
check("міські й західні точки в маршрутах", planned.length === 16, planned.length);

/* ── Історія тягне точку до «свого» водія ───────────────────────────── */

const habitsWithHistory = {
  driverByClient: new Map(west.map((p) => [p.counterpartyId, [{ driverId: "d2", count: 9 }]])),
  weekdayByClient: new Map<string, number[]>(),
  pairs: new Map<string, number>(),
};

const withHistory = planDay({ points, drivers, habits: habitsWithHistory, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
const westRoute = withHistory.routes.find((r) => r.points.some((p) => p.id.startsWith("west")));
check("західне гроно пішло Піцишину", westRoute?.driverId === "d2", westRoute?.driverId);
check("рішення пояснене", Boolean(westRoute?.reason), westRoute?.reason);

/* ── Межа дня ───────────────────────────────────────────────────────── */

const tight: PlanDriver[] = [
  { id: "d1", name: "Пайда", maxStops: 6 },
  { id: "d2", name: "Піцишин", maxStops: 6 },
];
const overflow = planDay({ points, drivers: tight, habits, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
check(
  "жоден водій не перевищив межу",
  overflow.routes.every((r) => r.points.length <= 6),
  overflow.routes.map((r) => r.points.length).join("+")
);
check("зайве пішло у відкладені", overflow.deferred.length > 0, overflow.deferred.flatMap((d) => d.points).length);

/* ── Закріплена точка ───────────────────────────────────────────────── */

const pinned = points.map((p) => (p.id === "south0" ? { ...p, pinnedDriverId: "d1" } : p));
const withPin = planDay({ points: pinned, drivers, habits, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
const pinRoute = withPin.routes.find((r) => r.points.some((p) => p.id === "south0"));
check("закріплена точка їде попри невигідність", pinRoute?.driverId === "d1", pinRoute?.driverId);

/* ── Пари не розриваються ───────────────────────────────────────────── */

const pairHabits = {
  driverByClient: new Map<string, { driverId: string; count: number }[]>(),
  weekdayByClient: new Map<string, number[]>(),
  pairs: new Map([[`cp-city0|cp-city1`, 9]]),
};
const pairPlan = planDay({ points: city, drivers: tight, habits: pairHabits, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
const routeOf = (id: string) => pairPlan.routes.find((r) => r.points.some((p) => p.id === id))?.driverId ?? null;
check("стійка пара лишилась разом", routeOf("city0") === routeOf("city1"), `${routeOf("city0")} / ${routeOf("city1")}`);

if (fails.length) {
  console.error(`\nне зійшлося: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nядро планування працює як домовлено");
```

- [ ] **Step 2: Запустити й переконатися, що падає**

Run: `npx tsx scripts/check-plan-day.mts`
Expected: `Cannot find module '../src/lib/routes/plan-day'`

- [ ] **Step 3: Написати ядро**

Створити `src/lib/routes/plan-day.ts`:

```ts
/**
 * Кого якому водію і що відкласти: ядро планування дня.
 *
 * Чиста функція — без бази, без мережі, без `next/*`. Причина не в красі:
 * рішення «Коваль їде до Піцишина, а Турка чекає четверга» людина має
 * змогу відтворити й оскаржити, а відтворити можна лише те, що не залежить
 * від того, що відповів OSRM о 19:40.
 *
 * Кілометрів тут немає СВІДОМО. Грона будуються по прямій від складу, і це
 * чесно названо: справжню дорогу знає тільки OSRM, і саме він рахує порядок
 * та відстані потім, у роуті. Прямої досить, щоб зрозуміти, що Турка й
 * Борислав — один бік, а Броди — інший; рахувати нею кілометраж не можна.
 *
 * Порядок точок усередині маршруту ядро не визначає: це робота optimize.ts,
 * яка коштує запитів до OSRM і має свої два варіанти вибору.
 *
 * Типи профілів і ключ пари живуть ТУТ, а не в delivery-habits: той модуль
 * тягне Prisma, і ядро, імпортуючи з нього хоч одну функцію, перестало б
 * запускатися без бази — разом зі своїм тестом.
 */

import { CorridorIndex } from "@/lib/routes/corridor";
import { haversineM } from "@/lib/track/geo";

/** Скільки разів водій возив цього клієнта. Профілі заповнює delivery-habits. */
export type DriverHabit = { driverId: string; count: number };

/** З якої кількості спільних поїздок пара клієнтів вважається стійкою. */
export const PAIR_MIN = 5;

/**
 * Ключ пари, незалежний від порядку.
 *
 * Пара «Коваль і Гевко» та «Гевко і Коваль» — одна пара; без сортування
 * лічильник роздвоївся б, і жодна пара не дотягнула б до порога.
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type PlanPoint = {
  /** salesDocumentId — саме він потім стане точкою маршруту */
  id: string;
  counterpartyId: string;
  name: string;
  lat: number;
  lng: number;
  /** Сума накладної, ₴ */
  amount: number;
  /** 0..1 з priority.ts: борг, оборот, стан клієнта. Рахує викликач */
  score: number;
  /** Менеджер закріпив точку за водієм — їде попри будь-яку арифметику */
  pinnedDriverId: string | null;
};

export type PlanDriver = {
  id: string;
  name: string;
  /** Межа дня з історії (delivery-habits) або дефолт */
  maxStops: number;
};

export type PlanHabits = {
  driverByClient: Map<string, DriverHabit[]>;
  weekdayByClient: Map<string, number[]>;
  pairs: Map<string, number>;
};

export type PlanOptions = {
  /** Ширина грона: точка далі цього від осі «склад → якір» іде в інше гроно */
  clusterRadiusKm: number;
  /** З якої відстані від складу гроно вважається далеким */
  farKm: number;
  /** Скільки грошей має бути в далекому гроні, щоб рейс окупився */
  minFarAmount: number;
};

/**
 * Числа підібрані по історії 139 листів: середній розтяг листа 74 км, у
 * місті точки стоять щільно, а далекі напрямки (Турка, Броди) відходять
 * від складу на 60–90 км. 12 км ширини — це смуга, у якій водій справді
 * заїжджає «по дорозі», не роблячи окремого рейсу.
 */
export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  clusterRadiusKm: 12,
  farKm: 45,
  minFarAmount: 15_000,
};

export type PlanCluster = {
  points: PlanPoint[];
  /** Відстань по прямій від складу до найдальшої точки грона, км */
  anchorKm: number;
  amount: number;
};

export type PlanRoute = {
  driverId: string;
  points: PlanPoint[];
  /** Чому саме цей водій — рядок, який побачить менеджер */
  reason: string;
};

export type DeferredCluster = {
  points: PlanPoint[];
  reason: string;
  /** Найчастіший день тижня цих точок в історії, 0 = понеділок; null — історії немає */
  suggestWeekday: number | null;
};

export type DayPlan = {
  routes: PlanRoute[];
  deferred: DeferredCluster[];
};

export type PlanInput = {
  points: PlanPoint[];
  drivers: PlanDriver[];
  habits: PlanHabits;
  depot: { lat: number; lng: number };
  options: PlanOptions;
  /** День тижня, на який плануємо, 0 = понеділок. Потрібен для поради «зазвичай їде в…» */
  weekday: number;
};

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineM(a.lat, a.lng, b.lat, b.lng) / 1000;
}

/**
 * Грона «по дорозі»: найдальша точка задає напрямок, решта чіпляється до осі.
 *
 * Чому від найдальшої, а не кластеризацією загального вигляду: рейс завжди
 * має вістря — точку, заради якої виїжджають, — і все, що по дорозі до неї,
 * дістається безкоштовно. k-means такого поняття не має і порізав би
 * напрямок на «ближню» й «дальню» половини, тобто на два рейси однією дорогою.
 */
export function clusterPoints(points: PlanPoint[], depot: { lat: number; lng: number }, radiusKm: number): PlanCluster[] {
  const left = [...points].sort((a, b) => km(depot, b) - km(depot, a));
  const clusters: PlanCluster[] = [];

  while (left.length > 0) {
    const anchor = left.shift()!;
    const anchorKm = km(depot, anchor);
    const axis = new CorridorIndex([depot, { lat: anchor.lat, lng: anchor.lng }]);

    const taken: PlanPoint[] = [anchor];
    for (let i = left.length - 1; i >= 0; i--) {
      const p = left[i];
      // Не далі смуги вздовж осі — і не за якорем: те, що лежить далі
      // вістря, належить наступному, ще дальшому напрямку.
      if (axis.distanceKm(p) <= radiusKm && km(depot, p) <= anchorKm + radiusKm) {
        taken.push(p);
        left.splice(i, 1);
      }
    }

    clusters.push({
      points: taken,
      anchorKm,
      amount: taken.reduce((s, p) => s + p.amount, 0),
    });
  }

  return clusters;
}

/** Наскільки гроно «своє» для водія: сума доставок його клієнтам в історії. */
function affinity(cluster: PlanPoint[], driverId: string, habits: PlanHabits): number {
  let total = 0;
  for (const p of cluster) {
    const list = habits.driverByClient.get(p.counterpartyId);
    if (!list) continue;
    total += list.find((h) => h.driverId === driverId)?.count ?? 0;
  }
  return total;
}

/** Найчастіший день тижня точок грона; null — історії немає. */
function usualWeekday(cluster: PlanPoint[], habits: PlanHabits): number | null {
  const sum = [0, 0, 0, 0, 0, 0, 0];
  let seen = false;
  for (const p of cluster) {
    const week = habits.weekdayByClient.get(p.counterpartyId);
    if (!week) continue;
    seen = true;
    for (let i = 0; i < 7; i++) sum[i] += week[i];
  }
  if (!seen) return null;
  let best = 0;
  for (let i = 1; i < 7; i++) if (sum[i] > sum[best]) best = i;
  return sum[best] > 0 ? best : null;
}

/**
 * Порядок, у якому точки грона віддаються водію, коли гроно не влазить цілком.
 *
 * Спершу ті, що в стійких парах із уже взятими, — щоб розрив пройшов між
 * чужими одна одній точками, а не посеред села, яке водій завжди об'їжджає
 * разом. Далі — за грошима й важливістю.
 */
function splitOrder(points: PlanPoint[], habits: PlanHabits): PlanPoint[] {
  const scored = points.map((p) => {
    let pairWeight = 0;
    for (const other of points) {
      if (other.id === p.id) continue;
      const n = habits.pairs.get(pairKey(p.counterpartyId, other.counterpartyId)) ?? 0;
      if (n >= PAIR_MIN) pairWeight += n;
    }
    return { p, pairWeight };
  });

  return scored
    .sort((a, b) => b.pairWeight - a.pairWeight || b.p.amount - a.p.amount || b.p.score - a.p.score)
    .map((s) => s.p);
}

export function planDay(input: PlanInput): DayPlan {
  const { points, drivers, habits, depot, options } = input;

  const routes = new Map<string, PlanRoute>();
  for (const d of drivers) {
    routes.set(d.id, { driverId: d.id, points: [], reason: "" });
  }
  const free = new Map(drivers.map((d) => [d.id, d.maxStops]));
  const deferred: DeferredCluster[] = [];

  /* ── Закріплені точки — поза будь-якою арифметикою ─────────────────── */

  const rest: PlanPoint[] = [];
  for (const p of points) {
    const route = p.pinnedDriverId ? routes.get(p.pinnedDriverId) : undefined;
    if (route) {
      route.points.push(p);
      free.set(route.driverId, (free.get(route.driverId) ?? 0) - 1);
      route.reason = route.reason || "закріплено менеджером";
    } else {
      rest.push(p);
    }
  }

  /* ── Грона: дорогі й близькі першими ───────────────────────────────── */

  const clusters = clusterPoints(rest, depot, options.clusterRadiusKm)
    .sort((a, b) => b.amount - a.amount);

  for (const cluster of clusters) {
    const far = cluster.anchorKm > options.farKm;
    if (far && cluster.amount < options.minFarAmount) {
      deferred.push({
        points: cluster.points,
        reason: `${cluster.points.length} точ. на ${Math.round(cluster.amount).toLocaleString("uk-UA")} ₴ за ${Math.round(cluster.anchorKm)} км — рейс не окупиться`,
        suggestWeekday: usualWeekday(cluster.points, habits),
      });
      continue;
    }

    // Водії за спорідненістю, далі за вільним місцем: коли історії немає
    // (новий напрямок), вирішує той, у кого день вільніший.
    const ranked = [...drivers].sort((a, b) => {
      const affDiff = affinity(cluster.points, b.id, habits) - affinity(cluster.points, a.id, habits);
      if (affDiff !== 0) return affDiff;
      return (free.get(b.id) ?? 0) - (free.get(a.id) ?? 0);
    });

    let left = splitOrder(cluster.points, habits);

    for (const driver of ranked) {
      if (left.length === 0) break;
      const room = free.get(driver.id) ?? 0;
      if (room <= 0) continue;

      const take = left.slice(0, room);
      left = left.slice(room);

      const route = routes.get(driver.id)!;
      route.points.push(...take);
      free.set(driver.id, room - take.length);

      const aff = affinity(take, driver.id, habits);
      const line = aff > 0 ? `${aff} доставок цим клієнтам в історії` : "вільний день, історії по цих клієнтах немає";
      route.reason = route.reason ? `${route.reason}; ${line}` : line;
    }

    if (left.length > 0) {
      deferred.push({
        points: left,
        reason: "денна межа водіїв вичерпана",
        suggestWeekday: usualWeekday(left, habits),
      });
    }
  }

  return {
    routes: [...routes.values()].filter((r) => r.points.length > 0),
    deferred,
  };
}
```

- [ ] **Step 4: Запустити перевірку — має пройти**

Run: `npx tsx scripts/check-plan-day.mts`
Expected: усі `ok`, «ядро планування працює як домовлено», код виходу 0.

- [ ] **Step 5: Перевірити типи**

Run: `npx tsc --noEmit`
Expected: без помилок.

- [ ] **Step 6: Коміт**

```bash
git add src/lib/routes/plan-day.ts scripts/check-plan-day.mts
git commit -m "Ядро планування дня: грона по дорозі, роздача водіям, відкладені"
```

---

### Task 2: Профілі з історії листів

**Files:**
- Create: `src/lib/routes/delivery-habits.ts`
- Test: `scripts/check-delivery-habits.mts`

**Interfaces:**
- Consumes: `prisma` з `@/lib/prisma`; `pairKey` і тип `DriverHabit` з `@/lib/routes/plan-day` (Task 1); таблиці `RouteSheet`, `RouteSheetStop`, `User.driver1CExternalId`.
- Produces: `deliveryHabits(sinceDays?: number): Promise<DeliveryHabits>`, константи `DEFAULT_SINCE_DAYS`, `DEFAULT_MAX_STOPS`, типи `DeliveryHabits`, `DriverCapacity`.

- [ ] **Step 1: Написати перевірку, яка падає**

Створити `scripts/check-delivery-habits.mts`:

```ts
/**
 * Профілі доставки на справжній історії листів.
 *
 * Навіщо. Увесь розподіл точок між водіями спирається на пʼять лічильників
 * з історії. Якщо вони порахуються криво — план виглядатиме розумним і буде
 * неправильним, а помітить це тільки водій, що поїхав не туди. Тому числа
 * звіряються з тим, що було виміряно на етапі дизайну 22.09.2026.
 *
 *   npx tsx --env-file=.env scripts/check-delivery-habits.mts
 *
 * Лише читання бази.
 */

import { deliveryHabits } from "../src/lib/routes/delivery-habits";
import { PAIR_MIN } from "../src/lib/routes/plan-day";
import { prisma } from "../src/lib/prisma";

const fails: string[] = [];

function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

const habits = await deliveryHabits(180);

// 380 клієнтів мали доставки за виміром 22.09.2026; історія росте, тож нижня межа.
check("клієнтів з доставками", habits.deliveriesByClient.size >= 300, habits.deliveriesByClient.size);

// Частка «свого» водія: 0.64 на 22.09.2026. Ширші межі — щоб скрипт не падав
// від природного дрейфу, але ловив зламаний підрахунок.
let withThree = 0;
let shareSum = 0;
for (const [cp, list] of habits.driverByClient) {
  const total = list.reduce((s, h) => s + h.count, 0);
  if (total < 3) continue;
  withThree++;
  shareSum += list[0].count / total;
  void cp;
}
const share = withThree ? shareSum / withThree : 0;
check("частка «свого» водія 0.5..0.8", share >= 0.5 && share <= 0.8, share.toFixed(3));

// 819 пар ≥5 разів на 22.09.2026.
let strongPairs = 0;
for (const n of habits.pairs.values()) if (n >= PAIR_MIN) strongPairs++;
check("стійких пар ≥ 500", strongPairs >= 500, strongPairs);

// Медіана 15–16 точок на лист; межа дня не може бути абсурдною.
for (const [driverId, cap] of habits.capacity) {
  check(
    `межа дня водія ${driverId} у 5..45`,
    cap.maxStops >= 5 && cap.maxStops <= 45,
    `${cap.maxStops} (медіана ${cap.medianStops}, днів ${cap.days})`
  );
}

// Дні тижня: хоч у когось має бути виражений день.
let withWeekday = 0;
for (const w of habits.weekdayByClient.values()) {
  if (w.some((n) => n >= 2)) withWeekday++;
}
check("клієнтів з повторюваним днем ≥ 50", withWeekday >= 50, withWeekday);

await prisma.$disconnect();

if (fails.length) {
  console.error(`\nне зійшлося: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nпрофілі зійшлися");
```

- [ ] **Step 2: Запустити й переконатися, що падає**

Run: `npx tsx --env-file=.env scripts/check-delivery-habits.mts`
Expected: помилка імпорту — `Cannot find module '../src/lib/routes/delivery-habits'`

- [ ] **Step 3: Написати модуль профілів**

Створити `src/lib/routes/delivery-habits.ts`:

```ts
/**
 * Звички доставки: чого навчила історія маршрутних листів.
 *
 * Пʼять лічильників, а не модель. Вони прозорі настільки, що кожне рішення
 * планувальника можна пояснити людині одним рядком — «Коваль: 9 з 11 доставок
 * возив Пайда», — і саме це робить автоматичний план прийнятним для того,
 * хто досі складав його головою.
 *
 * Джерело — листи з 1С, а не маршрути сайту: листів 139 проти 9, і вся
 * фактична розвозка живе саме в них.
 *
 * Водій береться з `driverId`, а коли обмін його не прив'язав (17 листів зі
 * 139) — через `driverExternalId1C`, бо Ref_Key стабільніший за ім'я.
 *
 * Усе рахується одним запитом і згортається в пам'яті: 2157 точок — обсяг,
 * на якому окрема таблиця профілів коштувала б більше, ніж економила.
 *
 * `pairKey` і тип `DriverHabit` беремо з ядра plan-day: ядро має лишатися
 * придатним до запуску без бази, тому спільне живе там, а не тут.
 */

import { prisma } from "@/lib/prisma";
import { pairKey, type DriverHabit } from "@/lib/routes/plan-day";

export type DriverCapacity = {
  /** Скільки точок брати за межу дня: 80-й процентиль по історії */
  maxStops: number;
  medianStops: number;
  /** Скільки днів історії стоїть за цими числами */
  days: number;
};

export type DeliveryHabits = {
  /** counterpartyId → водії за спаданням кількості доставок */
  driverByClient: Map<string, DriverHabit[]>;
  /** counterpartyId → скільки разів клієнт був у листі кожного дня тижня, індекс 0 = понеділок */
  weekdayByClient: Map<string, number[]>;
  /** `pairKey(a, b)` → скільки разів двоє клієнтів були в одному листі */
  pairs: Map<string, number>;
  /** driverId → межа дня */
  capacity: Map<string, DriverCapacity>;
  /** counterpartyId → скільки доставок мав. Відсутній ключ = не возили ЖОДНОГО разу */
  deliveriesByClient: Map<string, number>;
};

/** Скільки історії беремо за замовчуванням. */
export const DEFAULT_SINCE_DAYS = 180;

/** Який процентиль денних точок вважати межею дня. */
const CAPACITY_PERCENTILE = 0.8;

/** Межа дня для водія, якого в історії ще немає (медіана по фірмі). */
export const DEFAULT_MAX_STOPS = 16;

type HistoryRow = {
  sheet_id: string;
  driver_id: string | null;
  sheet_date: Date;
  cp: string;
};

/** Процентиль по відсортованому масиву; порожній — null. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

export async function deliveryHabits(sinceDays = DEFAULT_SINCE_DAYS): Promise<DeliveryHabits> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const rows = await prisma.$queryRaw<HistoryRow[]>`
    SELECT rs.id AS sheet_id,
           COALESCE(rs."driverId", u.id) AS driver_id,
           rs.date AS sheet_date,
           s."counterpartyId" AS cp
    FROM "RouteSheet" rs
    JOIN "RouteSheetStop" s
      ON s."routeSheetId" = rs.id AND s.hidden = false
    LEFT JOIN "User" u
      ON u."driver1CExternalId" = rs."driverExternalId1C"
    WHERE rs.date >= ${since}
      AND s."counterpartyId" IS NOT NULL
  `;

  /* Лист → його водій, день і склад клієнтів. Клієнти в множині: три рядки
     на одну адресу — це одна точка, і для пар та місткості вони не троїться. */
  const sheets = new Map<string, { driverId: string | null; weekday: number; clients: Set<string> }>();

  for (const row of rows) {
    let sheet = sheets.get(row.sheet_id);
    if (!sheet) {
      // getUTCDay(): 0 = неділя. Нам треба 0 = понеділок.
      const weekday = (row.sheet_date.getUTCDay() + 6) % 7;
      sheet = { driverId: row.driver_id, weekday, clients: new Set() };
      sheets.set(row.sheet_id, sheet);
    }
    sheet.clients.add(row.cp);
  }

  const driverCounts = new Map<string, Map<string, number>>();
  const weekdayByClient = new Map<string, number[]>();
  const pairs = new Map<string, number>();
  const deliveriesByClient = new Map<string, number>();
  const stopsPerDay = new Map<string, number[]>();

  for (const sheet of sheets.values()) {
    const clients = [...sheet.clients];

    for (const cp of clients) {
      deliveriesByClient.set(cp, (deliveriesByClient.get(cp) ?? 0) + 1);

      const week = weekdayByClient.get(cp) ?? [0, 0, 0, 0, 0, 0, 0];
      week[sheet.weekday]++;
      weekdayByClient.set(cp, week);

      if (sheet.driverId) {
        const byDriver = driverCounts.get(cp) ?? new Map<string, number>();
        byDriver.set(sheet.driverId, (byDriver.get(sheet.driverId) ?? 0) + 1);
        driverCounts.set(cp, byDriver);
      }
    }

    for (let i = 0; i < clients.length; i++) {
      for (let j = i + 1; j < clients.length; j++) {
        const key = pairKey(clients[i], clients[j]);
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }

    if (sheet.driverId) {
      const list = stopsPerDay.get(sheet.driverId) ?? [];
      list.push(clients.length);
      stopsPerDay.set(sheet.driverId, list);
    }
  }

  const driverByClient = new Map<string, DriverHabit[]>();
  for (const [cp, byDriver] of driverCounts) {
    const list = [...byDriver.entries()]
      .map(([driverId, count]) => ({ driverId, count }))
      .sort((a, b) => b.count - a.count);
    driverByClient.set(cp, list);
  }

  const capacity = new Map<string, DriverCapacity>();
  for (const [driverId, list] of stopsPerDay) {
    const sorted = [...list].sort((a, b) => a - b);
    capacity.set(driverId, {
      maxStops: percentile(sorted, CAPACITY_PERCENTILE) ?? DEFAULT_MAX_STOPS,
      medianStops: percentile(sorted, 0.5) ?? DEFAULT_MAX_STOPS,
      days: list.length,
    });
  }

  return { driverByClient, weekdayByClient, pairs, capacity, deliveriesByClient };
}
```

- [ ] **Step 4: Запустити перевірку — має пройти**

Run: `npx tsx --env-file=.env scripts/check-delivery-habits.mts`
Expected: усі рядки `ok`, у кінці «профілі зійшлися», код виходу 0.

- [ ] **Step 5: Перевірити типи**

Run: `npx tsc --noEmit`
Expected: без помилок.

- [ ] **Step 6: Коміт**

```bash
git add src/lib/routes/delivery-habits.ts scripts/check-delivery-habits.mts
git commit -m "Звички доставки: пʼять профілів з історії маршрутних листів"
```

---

### Task 3: Кандидати дня

**Files:**
- Create: `src/lib/routes/plan-candidates.ts`
- Test: `scripts/check-plan-candidates.mts`

**Interfaces:**
- Consumes: `prisma`; таблиці `SalesDocument`, `Counterparty`, `RouteSheetStop`, `DeliveryStop`.
- Produces: `planCandidates(days?: number): Promise<CandidatesResult>`, тип `PlanCandidate`, константи `CANDIDATE_DAYS = 14`, `DELIVERY_BBOX`.

- [ ] **Step 1: Написати перевірку, яка падає**

Створити `scripts/check-plan-candidates.mts`:

```ts
/**
 * Кандидати на розвозку: що саме потрапить у план.
 *
 * Навіщо. Найдорожча помилка планувальника — не крива дорога, а зайвий або
 * загублений документ: повезти те, що клієнт уже забрав, або забути те, що
 * чекає тиждень. Тому вибірка перевіряється окремо від усієї решти.
 *
 *   npx tsx --env-file=.env scripts/check-plan-candidates.mts
 *
 * Лише читання бази.
 */

import { planCandidates, DELIVERY_BBOX } from "../src/lib/routes/plan-candidates";
import { prisma } from "../src/lib/prisma";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

const res = await planCandidates();
console.log(`кандидатів: ${res.points.length}, без піна: ${res.noPin.length}, поза зоною: ${res.outOfZone.length}`);

check("щось знайшлося", res.points.length + res.noPin.length > 0, res.points.length + res.noPin.length);

check(
  "усі кандидати з координатами",
  res.points.every((p) => p.lat !== null && p.lng !== null),
  res.points.filter((p) => p.lat === null).length
);

check(
  "усі кандидати в зоні розвозки",
  res.points.every(
    (p) =>
      p.lat! >= DELIVERY_BBOX.latMin && p.lat! <= DELIVERY_BBOX.latMax &&
      p.lng! >= DELIVERY_BBOX.lngMin && p.lng! <= DELIVERY_BBOX.lngMax
  ),
  res.points.length
);

// Жоден кандидат не має вже лежати в листі 1С або в маршруті сайту.
const ids = res.points.map((p) => p.salesDocumentId);
if (ids.length) {
  const inSheet = await prisma.routeSheetStop.count({ where: { salesDocumentId: { in: ids }, hidden: false } });
  const inRoute = await prisma.deliveryStop.count({ where: { salesDocumentId: { in: ids } } });
  check("жоден не в листі 1С", inSheet === 0, inSheet);
  check("жоден не в маршруті сайту", inRoute === 0, inRoute);
}

// Дублів документів бути не може: один документ — одна точка.
check("без дублів", new Set(ids).size === ids.length, `${new Set(ids).size} / ${ids.length}`);

await prisma.$disconnect();

if (fails.length) {
  console.error(`\nне зійшлося: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nвибірка кандидатів чиста");
```

- [ ] **Step 2: Запустити й переконатися, що падає**

Run: `npx tsx --env-file=.env scripts/check-plan-candidates.mts`
Expected: `Cannot find module '../src/lib/routes/plan-candidates'`

- [ ] **Step 3: Написати модуль кандидатів**

Створити `src/lib/routes/plan-candidates.ts`:

```ts
/**
 * Що взагалі можна повезти завтра.
 *
 * Критерій «ще не поїхало» один: проведена реалізація, якої немає ні в
 * маршрутному листі 1С, ні в маршруті сайту. Замовлення сюди не годяться —
 * усі 2157 історичних точок прив'язані саме до реалізацій, а 94% замовлень
 * стають реалізацією протягом трьох днів, тобто менеджер планує вже після
 * проведення.
 *
 * Вікно — два тижні. Без нього в план щодня лізли б документи, які ніхто
 * ніколи не повезе: клієнт забрав сам, домовленість скасували телефоном,
 * товар поїхав поштою. Нічого з цього в базі не позначено, і єдине, що їх
 * відрізняє, — те, що вони висять.
 *
 * Точки поза Львівщиною відсіюються окремо, а не мовчки: 9 клієнтів з
 * доставками стоять у Дніпрі та Києві, і це Нова пошта, а не розвозка.
 * Крім того, наш OSRM зібраний з витяжки по області, тож дорогу за її межі
 * він однаково не покаже чесно.
 */

import { prisma } from "@/lib/prisma";

export type PlanCandidate = {
  salesDocumentId: string;
  number: string;
  counterpartyId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  amount: number;
  /** Коли документ проведено — щоб показати, скільки вже чекає */
  createdAt: Date;
};

export type CandidatesResult = {
  /** Готові до планування: пін є, зона наша */
  points: PlanCandidate[];
  /** Клієнт у базі є, координат немає — менеджер має показати на карті */
  noPin: PlanCandidate[];
  /** Поза Львівщиною: пошта, не розвозка */
  outOfZone: PlanCandidate[];
};

/** Скільки днів назад дивимося. */
export const CANDIDATE_DAYS = 14;

/**
 * Межі розвозки. Ширші за адміністративну Львівщину: розвозка заходить у
 * прикордонні села сусідніх областей, і різати їх по межі області було б
 * неправдою про те, як їздять насправді.
 */
export const DELIVERY_BBOX = {
  latMin: 48.6,
  latMax: 50.8,
  lngMin: 22.4,
  lngMax: 26.5,
};

type Row = {
  id: string;
  number: string;
  counterpartyId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  amount: number;
  created_at: Date;
};

export async function planCandidates(days = CANDIDATE_DAYS): Promise<CandidatesResult> {
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT d.id,
           d.number,
           d."counterpartyId" AS "counterpartyId",
           c.name,
           COALESCE(c."deliveryAddress", c.address) AS address,
           c."deliveryLat" AS lat,
           c."deliveryLng" AS lng,
           d."totalAmount" AS amount,
           d."createdAt" AS created_at
    FROM "SalesDocument" d
    JOIN "Counterparty" c ON c.id = d."counterpartyId"
    WHERE d."docType" = 'REALIZATION'
      AND d.status = 'CONFIRMED'
      AND d."createdAt" >= ${since}
      AND NOT EXISTS (
        SELECT 1 FROM "RouteSheetStop" s
        WHERE s."salesDocumentId" = d.id AND s.hidden = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM "DeliveryStop" ds
        WHERE ds."salesDocumentId" = d.id
      )
    ORDER BY d."createdAt" ASC
  `;

  const points: PlanCandidate[] = [];
  const noPin: PlanCandidate[] = [];
  const outOfZone: PlanCandidate[] = [];

  for (const r of rows) {
    const c: PlanCandidate = {
      salesDocumentId: r.id,
      number: r.number,
      counterpartyId: r.counterpartyId,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      amount: r.amount,
      createdAt: r.created_at,
    };

    if (c.lat === null || c.lng === null) {
      noPin.push(c);
      continue;
    }
    if (
      c.lat < DELIVERY_BBOX.latMin || c.lat > DELIVERY_BBOX.latMax ||
      c.lng < DELIVERY_BBOX.lngMin || c.lng > DELIVERY_BBOX.lngMax
    ) {
      outOfZone.push(c);
      continue;
    }
    points.push(c);
  }

  return { points, noPin, outOfZone };
}
```

- [ ] **Step 4: Запустити перевірку — має пройти**

Run: `npx tsx --env-file=.env scripts/check-plan-candidates.mts`
Expected: усі `ok`, «вибірка кандидатів чиста».

- [ ] **Step 5: Перевірити типи**

Run: `npx tsc --noEmit`
Expected: без помилок.

- [ ] **Step 6: Коміт**

```bash
git add src/lib/routes/plan-candidates.ts scripts/check-plan-candidates.mts
git commit -m "Кандидати на розвозку: реалізації, які ще нікуди не поїхали"
```

---

### Task 4: Складання плану й роут розрахунку

**Files:**
- Create: `src/lib/routes/build-day-plan.ts`
- Create: `src/app/api/routes/plan-day/route.ts`
- Read first: `src/app/api/routes/optimize-day/route.ts` (стиль ролей, пального й відповіді)

**Interfaces:**
- Consumes: `planDay`, `DEFAULT_PLAN_OPTIONS`, типи `PlanPoint`, `PlanDriver`, `PlanRoute` з Task 1; `deliveryHabits`, `DEFAULT_MAX_STOPS` з Task 2; `planCandidates`, тип `PlanCandidate` з Task 3; наявні `defaultDepot`, `optimizeRoute`, `scoreClient`, `agingByCounterparty`, `colorForRep`, `requireRoles`/`OFFICE_ROLES`.
- Produces: `buildDayPlan(input: BuildDayPlanInput): Promise<PlanDayResponse | { error: string }>` і типи `PlanDayResponse`, `PlanRouteOut`, `PlanStopOut`, `BuildDayPlanInput` — усі з `src/lib/routes/build-day-plan.ts`; `POST /api/routes/plan-day`.

Логіка живе в `src/lib/routes/build-day-plan.ts`, а не в роуті, з двох причин: її викликає ще й інструмент помічника (Task 7), і клієнтська вкладка (Task 6) імпортує звідси типи — імпорт типів із серверного роуту тягне той роут у граф збірки клієнта.

- [ ] **Step 1: Написати складальник плану**

Створити `src/lib/routes/build-day-plan.ts`:

```ts
/**
 * План доставки на день: хто що везе і в якому порядку.
 *
 * Нічого не зберігає — складає й віддає. Запис робить окремий виклик
 * `apply`, як і в парі optimize-day / apply-order: інакше «подивитися,
 * скільки коштує» вже міняло б завтрашній день водія.
 *
 * Розподіл рахує ядро plan-day.ts по прямій, а кілометри й порядок — OSRM,
 * уже по дорозі. Розділення навмисне: пряма годиться, щоб зрозуміти
 * напрямок, і не годиться, щоб називати число людині.
 *
 * Поле `fixed` — це «перерахуй порядок, склад я вже поправив»: менеджер
 * перетягнув точки на карті й хоче свіжі кілометри, а не новий розподіл.
 * Без нього кожне перетягування скасовувало б попередні правки.
 */

import { prisma } from "@/lib/prisma";
import { defaultDepot } from "@/lib/routes/depot";
import { planCandidates, type PlanCandidate } from "@/lib/routes/plan-candidates";
import { deliveryHabits, DEFAULT_MAX_STOPS } from "@/lib/routes/delivery-habits";
import { planDay, DEFAULT_PLAN_OPTIONS, type PlanPoint, type PlanDriver, type PlanRoute } from "@/lib/routes/plan-day";
import { optimizeRoute, type FuelParams, type OptimizeStop } from "@/lib/routes/optimize";
import { scoreClient } from "@/lib/routes/priority";
import { agingByCounterparty } from "@/lib/analytics/money-facts";
import { colorForRep } from "@/lib/routes/colors";

/** Типове авто розвозки — те саме, що в optimize-day. */
const DEFAULT_FUEL: FuelParams = { consumption: 12, pricePerUnit: 56, bufferPercent: 10 };

/** Кого вважаємо «сьогоднішніми» водіями, якщо менеджер не назвав склад. */
const ACTIVE_DRIVER_DAYS = 14;

export type PlanStopOut = {
  salesDocumentId: string;
  counterpartyId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  amount: number;
  sequence: number;
  /** Клієнт ніколи не був у маршрутному листі — схоже, забирає сам */
  neverDelivered: boolean;
};

export type PlanRouteOut = {
  driverId: string;
  driverName: string;
  color: string;
  stops: PlanStopOut[];
  distanceKm: number | null;
  durationMin: number | null;
  fuelCost: number | null;
  geometry: GeoJSON.LineString | null;
  reason: string;
  /** Порядок дала пряма, а не дорога: OSRM не відповів */
  orderFromDistance: boolean;
};

export type PlanWaiting = {
  salesDocumentId: string;
  counterpartyId: string;
  name: string;
  address: string | null;
};

export type PlanDayResponse = {
  date: string;
  depot: { lat: number; lng: number; name: string } | null;
  drivers: Array<{ id: string; name: string; color: string; maxStops: number }>;
  routes: PlanRouteOut[];
  deferred: Array<{ points: PlanStopOut[]; reason: string; suggestWeekday: number | null }>;
  noPin: PlanWaiting[];
  outOfZone: PlanWaiting[];
  notes: string[];
};

export type BuildDayPlanInput = {
  date: string;
  /** Кого саме ставимо на день; без цього — усі, хто возив за два тижні */
  driverIds?: string[];
  /** salesDocumentId → driverId: точка їде попри будь-яку арифметику */
  pins?: Record<string, string>;
  /** Документи, які менеджер прибрав з плану */
  exclude?: string[];
  /** Готовий склад маршрутів: розподіл не чіпаємо, рахуємо лише порядок і км */
  fixed?: Array<{ driverId: string; salesDocumentIds: string[] }>;
};

function waiting(c: PlanCandidate): PlanWaiting {
  return { salesDocumentId: c.salesDocumentId, counterpartyId: c.counterpartyId, name: c.name, address: c.address };
}

export async function buildDayPlan(input: BuildDayPlanInput): Promise<PlanDayResponse | { error: string }> {
  const notes: string[] = [];

  const depot = await defaultDepot();
  if (!depot) return { error: "У базі немає складу з координатами — нема звідки виїжджати" };

  /* ── Кандидати ─────────────────────────────────────────────────────── */

  const candidates = await planCandidates();
  const exclude = new Set(input.exclude ?? []);
  const usable = candidates.points.filter((c) => !exclude.has(c.salesDocumentId));

  const habits = await deliveryHabits();

  if (usable.length === 0) {
    return {
      date: input.date,
      depot,
      drivers: [],
      routes: [],
      deferred: [],
      noPin: candidates.noPin.map(waiting),
      outOfZone: candidates.outOfZone.map(waiting),
      notes: ["Непривезених реалізацій з координатами не знайшлося"],
    };
  }

  /* ── Водії ─────────────────────────────────────────────────────────── */

  const since = new Date(Date.now() - ACTIVE_DRIVER_DAYS * 86_400_000);

  const driverRows = await prisma.user.findMany({
    where: input.driverIds?.length
      ? { id: { in: input.driverIds } }
      : {
          role: "DRIVER",
          // Relation зветься routeSheets (@relation("driverRouteSheets")),
          // поля isActive у User немає — активність міряємо листами.
          routeSheets: { some: { date: { gte: since } } },
        },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  });

  if (driverRows.length === 0) {
    return { error: "Не знайшов водіїв: за два тижні ні в кого немає маршрутних листів" };
  }

  const drivers: PlanDriver[] = driverRows.map((d) => ({
    id: d.id,
    name: d.name,
    maxStops: habits.capacity.get(d.id)?.maxStops ?? DEFAULT_MAX_STOPS,
  }));

  /* ── Важливість точки ──────────────────────────────────────────────── */

  const aging = await agingByCounterparty(usable.map((c) => c.counterpartyId));

  const points: PlanPoint[] = usable.map((c) => {
    const debt = aging.get(c.counterpartyId);
    return {
      id: c.salesDocumentId,
      counterpartyId: c.counterpartyId,
      name: c.name,
      lat: c.lat!,
      lng: c.lng!,
      amount: c.amount,
      score: scoreClient({
        receivable: debt?.debt ?? 0,
        overdue: debt?.overdue ?? 0,
        turnover: 0,
        deliveryAmount: c.amount,
        state: null,
      }),
      pinnedDriverId: input.pins?.[c.salesDocumentId] ?? null,
    };
  });

  const byId = new Map(points.map((p) => [p.id, p]));
  const candById = new Map(usable.map((c) => [c.salesDocumentId, c]));

  /* ── Розподіл: або рахуємо, або беремо готовий ─────────────────────── */

  let planRoutes: PlanRoute[];
  let deferred: ReturnType<typeof planDay>["deferred"] = [];

  if (input.fixed?.length) {
    planRoutes = input.fixed
      .map((f) => ({
        driverId: f.driverId,
        points: f.salesDocumentIds.map((id) => byId.get(id)).filter((p): p is PlanPoint => Boolean(p)),
        reason: "склад визначив менеджер",
      }))
      .filter((r) => r.points.length > 0);
  } else {
    // 0 = понеділок, як у профілях.
    const weekday = (new Date(`${input.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const plan = planDay({ points, drivers, habits, depot, options: DEFAULT_PLAN_OPTIONS, weekday });
    planRoutes = plan.routes;
    deferred = plan.deferred;
  }

  /* ── Порядок і кілометри — OSRM ────────────────────────────────────── */

  const toStopOut = (p: PlanPoint, sequence: number): PlanStopOut => {
    const c = candById.get(p.id)!;
    return {
      salesDocumentId: p.id,
      counterpartyId: p.counterpartyId,
      name: p.name,
      address: c.address,
      lat: p.lat,
      lng: p.lng,
      amount: p.amount,
      sequence,
      neverDelivered: !habits.deliveriesByClient.has(p.counterpartyId),
    };
  };

  const routes: PlanRouteOut[] = [];
  for (const r of planRoutes) {
    const driver = driverRows.find((d) => d.id === r.driverId);
    if (!driver) continue;

    const stops: OptimizeStop[] = r.points.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, score: p.score }));

    let order = r.points.map((p) => p.id);
    let distanceKm: number | null = null;
    let durationMin: number | null = null;
    let fuelCost: number | null = null;
    let geometry: GeoJSON.LineString | null = null;
    let orderFromDistance = false;

    try {
      const optimized = await optimizeRoute([depot.lng, depot.lat], stops, DEFAULT_FUEL);
      const variant = optimized.balanced ?? optimized.cheapest;
      order = variant.order;
      distanceKm = variant.distanceKm;
      durationMin = variant.durationMin;
      fuelCost = variant.fuelCost;
      geometry = variant.geometry;
    } catch {
      // OSRM мовчить — порядок лишаємо як дало ядро і кажемо про це вголос.
      // Вигадати кілометраж тут було б найгіршим з можливих рішень.
      orderFromDistance = true;
      notes.push(`Маршрут ${driver.name}: OSRM не відповів, порядок за відстанню, кілометрів немає`);
    }

    const stopsOut = order
      .map((id) => byId.get(id))
      .filter((p): p is PlanPoint => Boolean(p))
      .map((p, i) => toStopOut(p, i + 1));

    const selfPickup = stopsOut.filter((s) => s.neverDelivered).length;
    if (selfPickup > 0) {
      notes.push(`${driver.name}: ${selfPickup} точ. — клієнти, яких у листах ще не було, перевірте, чи не самовивіз`);
    }

    routes.push({
      driverId: r.driverId,
      driverName: driver.name,
      color: colorForRep(r.driverId, driver.color),
      stops: stopsOut,
      distanceKm,
      durationMin,
      fuelCost,
      geometry,
      reason: r.reason,
      orderFromDistance,
    });
  }

  return {
    date: input.date,
    depot,
    drivers: driverRows.map((d) => ({
      id: d.id,
      name: d.name,
      color: colorForRep(d.id, d.color),
      maxStops: habits.capacity.get(d.id)?.maxStops ?? DEFAULT_MAX_STOPS,
    })),
    routes,
    deferred: deferred.map((d) => ({
      points: d.points.map((p, i) => toStopOut(p, i + 1)),
      reason: d.reason,
      suggestWeekday: d.suggestWeekday,
    })),
    noPin: candidates.noPin.map(waiting),
    outOfZone: candidates.outOfZone.map(waiting),
    notes,
  };
}
```

- [ ] **Step 2: Написати тонкий роут**

Створити `src/app/api/routes/plan-day/route.ts`:

```ts
/**
 * План доставки на день. Рахує й віддає — не пише нічого.
 *
 * Уся робота в src/lib/routes/build-day-plan.ts: те саме складання плану
 * викликає інструмент помічника, і роздвоювати його між роутом і чатом
 * означало б чекати, поки два плани розійдуться.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";
import { kyivDate } from "@/lib/date/kyiv";
import { buildDayPlan, type BuildDayPlanInput } from "@/lib/routes/build-day-plan";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as Partial<BuildDayPlanInput>;
  const plan = await buildDayPlan({
    date: body.date ?? kyivDate(new Date()),
    driverIds: body.driverIds,
    pins: body.pins,
    exclude: body.exclude,
    fixed: body.fixed,
  });

  if ("error" in plan) return NextResponse.json(plan, { status: 400 });
  return NextResponse.json(plan);
}
```

- [ ] **Step 3: Перевірити типи**

Run: `npx tsc --noEmit`
Expected: без помилок. Якщо Prisma свариться на `routeSheets` або `color` — звірити з `prisma/schema.prisma` і виправити за схемою, а не вигадувати поле.

- [ ] **Step 4: Перевірити роут на живих даних**

Запустити `npm run dev`, зайти в браузері як ADMIN і виконати в консолі:

```js
await (await fetch("/api/routes/plan-day", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ date: "2026-09-23" }),
})).json()
```

Expected: обʼєкт із `routes` (у кожного водія непорожні `stops` і числовий `distanceKm`), `deferred`, `noPin`, `outOfZone`, `drivers`.

- [ ] **Step 5: Перевірити режим перерахунку**

Тим самим запитом, але з `fixed`: узяти два документи з першого маршруту й передати їх другому водію.

```js
await (await fetch("/api/routes/plan-day", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ date: "2026-09-23", fixed: [{ driverId: "<id2>", salesDocumentIds: ["<doc1>", "<doc2>"] }] }),
})).json()
```

Expected: один маршрут із двома точками, свої `distanceKm`, `reason: "склад визначив менеджер"`.

- [ ] **Step 6: Звірити з реальністю**

Порівняти видачу з тим, що менеджер зробив руками на цю дату: відкрити `/admin/logistics/delivery?tab=journal` і подивитися лист того ж дня. Записати в повідомлення коміту, скільки точок збіглося.

- [ ] **Step 7: Коміт**

```bash
git add src/lib/routes/build-day-plan.ts src/app/api/routes/plan-day/route.ts
git commit -m "Складання плану дня: кандидати, профілі, ядро і порядок від OSRM"
```

---

### Task 5: Застосування плану

**Files:**
- Create: `src/app/api/routes/plan-day/apply/route.ts`
- Read first: `src/app/api/erp/delivery-routes/route.ts:138-200` (як створюються маршрут і точки)

**Interfaces:**
- Consumes: `getNextDocumentNumber` з `@/lib/erp/document-numbers`; `requireRoles`/`OFFICE_ROLES`.
- Produces: `POST /api/routes/plan-day/apply` з тілом `{ date: string, routes: Array<{ driverId: string, salesDocumentIds: string[], distanceKm?: number | null, geometry?: unknown }> }`, відповідь `{ created: Array<{ id: string, number: string, driverId: string, stops: number }> }`.

- [ ] **Step 1: Написати роут**

Створити `src/app/api/routes/plan-day/apply/route.ts`:

```ts
/**
 * Застосувати план: чернетки маршрутів на день.
 *
 * Створює рівно те, що менеджер бачив на екрані, — жодного перерахунку.
 * Якщо між «порахувати» і «застосувати» щось змінилося (документ уже
 * потрапив у лист 1С), такий документ пропускаємо й називаємо його: мовчки
 * створити маршрут з половиною точок гірше, ніж сказати правду.
 *
 * Статус PLANNED: водій чернетки не бачить. Передача — окрема дія
 * (`/api/erp/delivery-routes/[id]/assign`), і вона лишається за людиною.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";
import { getNextDocumentNumber } from "@/lib/erp/document-numbers";

export const dynamic = "force-dynamic";

type ApplyRoute = {
  driverId: string;
  salesDocumentIds: string[];
  distanceKm?: number | null;
  geometry?: unknown;
};

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const body = (await req.json()) as { date?: string; routes?: ApplyRoute[] };
  if (!body.date) return NextResponse.json({ error: "Вкажіть дату" }, { status: 400 });
  if (!body.routes?.length) return NextResponse.json({ error: "Немає маршрутів для створення" }, { status: 400 });

  const allIds = body.routes.flatMap((r) => r.salesDocumentIds);

  // Хто вже поїхав, поки менеджер дивився на екран.
  const taken = new Set<string>();
  for (const row of await prisma.routeSheetStop.findMany({
    where: { salesDocumentId: { in: allIds }, hidden: false },
    select: { salesDocumentId: true },
  })) {
    if (row.salesDocumentId) taken.add(row.salesDocumentId);
  }
  for (const row of await prisma.deliveryStop.findMany({
    where: { salesDocumentId: { in: allIds } },
    select: { salesDocumentId: true },
  })) {
    if (row.salesDocumentId) taken.add(row.salesDocumentId);
  }

  const skipped: string[] = [];
  const created: Array<{ id: string; number: string; driverId: string; stops: number }> = [];

  for (const r of body.routes) {
    const ids = r.salesDocumentIds.filter((id) => {
      if (taken.has(id)) {
        skipped.push(id);
        return false;
      }
      return true;
    });
    if (ids.length === 0) continue;

    const docs = await prisma.salesDocument.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        counterpartyId: true,
        counterparty: { select: { address: true, deliveryAddress: true } },
      },
    });
    const byId = new Map(docs.map((d) => [d.id, d]));

    const number = await getNextDocumentNumber("DR");

    const route = await prisma.$transaction(async (tx) => {
      const createdRoute = await tx.deliveryRoute.create({
        data: {
          number,
          driverId: r.driverId,
          date: new Date(body.date!),
          status: "PLANNED",
          totalDistanceKm: r.distanceKm ?? null,
          routeGeometry: (r.geometry as never) ?? null,
          createdById: me.userId,
          notes: "Склав помічник",
        },
      });

      let sequence = 0;
      for (const id of ids) {
        const doc = byId.get(id);
        if (!doc) continue;
        sequence += 1;
        await tx.deliveryStop.create({
          data: {
            deliveryRouteId: createdRoute.id,
            salesDocumentId: doc.id,
            counterpartyId: doc.counterpartyId,
            sequence,
            address: doc.counterparty?.deliveryAddress || doc.counterparty?.address || null,
          },
        });
      }

      return { id: createdRoute.id, number: createdRoute.number, stops: sequence };
    });

    created.push({ ...route, driverId: r.driverId });
  }

  return NextResponse.json({ created, skipped });
}
```

- [ ] **Step 2: Перевірити типи**

Run: `npx tsc --noEmit`
Expected: без помилок.

- [ ] **Step 3: Перевірити на живих даних і прибрати за собою**

У браузері як ADMIN створити маршрут із двох документів, узятих із видачі Task 4:

```js
await (await fetch("/api/routes/plan-day/apply", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ date: "2026-09-23", routes: [{ driverId: "<id>", salesDocumentIds: ["<doc1>", "<doc2>"] }] }),
})).json()
```

Expected: `{ created: [{ id, number, stops: 2 }], skipped: [] }`. Відкрити `/admin/logistics/delivery?tab=day&day=2026-09-23` — маршрут видно як чернетку. Після перевірки видалити його кнопкою в інтерфейсі, щоб не лишати сміття в базі.

- [ ] **Step 4: Коміт**

```bash
git add src/app/api/routes/plan-day/apply/route.ts
git commit -m "Застосування плану: чернетки маршрутів без перерахунку"
```

---

### Task 6: Вкладка «План»

**Files:**
- Create: `src/app/admin/logistics/delivery/components/PlanTab.tsx`
- Modify: `src/app/admin/logistics/delivery/components/RoutesShell.tsx` (масив `TABS`, тип `TabKey`, функція `isTab`, рендер вкладки)
- Read first: `src/app/admin/logistics/delivery/components/DayTab.tsx` (як вкладка тягне дані й показує стан), `src/app/admin/logistics/components/RoutesTab.tsx:34` (як оглядова карта підключається через `dynamic`)

**Interfaces:**
- Consumes: `PlanDayResponse`, `PlanRouteOut`, `PlanStopOut` з `@/lib/routes/build-day-plan` (Task 4); `RoutesOverviewMap` з `@/components/map/RoutesOverviewMap` (типи `OverviewRoute`, `LegendEntry`); `StopPinModal` з `@/components/routes/StopPinModal` (пропси: `counterpartyId`, `name`, `address`, `lat`, `lng`, `approximate`, `onClose`, `onSaved`).
- Produces: компонент `PlanTab({ day }: { day: string })`.

- [ ] **Step 1: Додати вкладку в оболонку**

У `src/app/admin/logistics/delivery/components/RoutesShell.tsx`:

```tsx
const TABS = [
  { key: "day", label: "День" },
  { key: "plan", label: "План" },
  { key: "journal", label: "Журнал" },
  { key: "map", label: "Карта" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTab(v: string | null): v is TabKey {
  return v === "day" || v === "plan" || v === "journal" || v === "map";
}
```

Додати імпорт `import PlanTab from "./PlanTab";` і в місці рендеру вкладок — гілку `{tab === "plan" && <PlanTab day={day} />}` поруч із наявними.

- [ ] **Step 2: Написати вкладку**

Створити `src/app/admin/logistics/delivery/components/PlanTab.tsx`:

```tsx
"use client";

/**
 * «План» — те, що помічник пропонує на день, і що менеджер із цим робить.
 *
 * Колонки водіїв ліворуч, карта праворуч, під ними відкладені й ті, кого
 * немає на карті. Правка — перетягуванням між колонками, а з телефона
 * кнопкою «Перекинути»: шістнадцять рядків на сенсорі перетягувати
 * неможливо, а вкладка потрібна і в дорозі.
 *
 * Порядок після правки НЕ перераховується сам. Кожен перерахунок — це
 * запити до OSRM на кожен маршрут, і робити їх після кожного руху рукою
 * означало б чекати по кілька секунд. Тому кілометри зникають («—»), поки
 * людина не натисне «Перерахувати порядок»: порожнє число честніше за старе.
 *
 * Карта підключається через `dynamic`, як у RoutesTab: Leaflet на сервері
 * падає.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { OverviewRoute, LegendEntry } from "@/components/map/RoutesOverviewMap";
import StopPinModal from "@/components/routes/StopPinModal";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { formatPrice } from "@/lib/utils";
import type { PlanDayResponse, PlanRouteOut, PlanStopOut } from "@/lib/routes/build-day-plan";

const RoutesOverviewMap = dynamic(() => import("@/components/map/RoutesOverviewMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-[var(--radius-card)] bg-g100 text-sm text-g400">
      Завантаження карти...
    </div>
  ),
});

const WEEKDAY = ["понеділок", "вівторок", "середу", "четвер", "пʼятницю", "суботу", "неділю"];

export default function PlanTab({ day }: { day: string }) {
  const [plan, setPlan] = useState<PlanDayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<{ counterpartyId: string; name: string; address: string | null } | null>(null);
  /** salesDocumentId → driverId: закріплення переживає перескладання плану */
  const [pins, setPins] = useState<Record<string, string>>({});
  /** Склад маршрутів правили руками — кілометри більше не відповідають */
  const [stale, setStale] = useState(false);

  /**
   * `fixed` — коли перераховуємо порядок уже виправленого складу; без нього
   * сервер складає план заново.
   */
  const load = useCallback(
    async (fixed?: Array<{ driverId: string; salesDocumentIds: string[] }>) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/routes/plan-day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: day, pins, fixed }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Не вдалося скласти план");
        setPlan(data as PlanDayResponse);
        setStale(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося скласти план");
      } finally {
        setLoading(false);
      }
    },
    [day, pins]
  );

  // Автоматично нічого не рахуємо: кожен план — це десятки запитів до OSRM,
  // і робити їх на кожне відкриття вкладки було б витратою без потреби.
  useEffect(() => {
    setPlan(null);
    setError(null);
    setStale(false);
  }, [day]);

  /** Перекинути точку іншому водію. Кілометри після цього не чинні. */
  const moveStop = (salesDocumentId: string, toDriverId: string) => {
    setPlan((prev) => {
      if (!prev) return prev;
      let moved: PlanStopOut | null = null;
      const routes = prev.routes.map((r) => {
        const found = r.stops.find((s) => s.salesDocumentId === salesDocumentId);
        if (!found) return r;
        moved = found;
        return { ...r, stops: r.stops.filter((s) => s.salesDocumentId !== salesDocumentId), distanceKm: null, durationMin: null, fuelCost: null };
      });
      if (!moved) return prev;
      return {
        ...prev,
        routes: routes.map((r) =>
          r.driverId === toDriverId
            ? { ...r, stops: [...r.stops, { ...moved!, sequence: r.stops.length + 1 }], distanceKm: null, durationMin: null, fuelCost: null }
            : r
        ),
      };
    });
    setStale(true);
    setMenuFor(null);
  };

  /** Закріпити точку за водієм: наступне складання плану її не зрушить. */
  const pinStop = (salesDocumentId: string, driverId: string) => {
    setPins((prev) => ({ ...prev, [salesDocumentId]: driverId }));
    setMenuFor(null);
  };

  const reorder = () =>
    load(plan?.routes.map((r) => ({ driverId: r.driverId, salesDocumentIds: r.stops.map((s) => s.salesDocumentId) })));

  const mapRoutes: OverviewRoute[] = useMemo(
    () =>
      (plan?.routes ?? []).map((r) => ({
        id: r.driverId,
        name: r.driverName,
        color: r.color,
        geometry: r.geometry as OverviewRoute["geometry"],
        subtitle: r.reason,
        stops: r.stops.map((s) => ({ settlement: s.name, displayName: s.address, lat: s.lat, lng: s.lng, seq: s.sequence })),
      })),
    [plan]
  );

  const legend: LegendEntry[] = useMemo(
    () => (plan?.routes ?? []).map((r) => ({ label: `${r.driverName} — ${r.stops.length} точ.`, color: r.color })),
    [plan]
  );

  const apply = async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/routes/plan-day/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: plan.date,
          routes: plan.routes.map((r) => ({
            driverId: r.driverId,
            salesDocumentIds: r.stops.map((s) => s.salesDocumentId),
            distanceKm: r.distanceKm,
            geometry: r.geometry,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не вдалося створити маршрути");
      setPlan(null);
      setError(
        data.skipped?.length
          ? `Створено маршрутів: ${data.created.length}. Пропущено ${data.skipped.length} документів — вони вже потрапили в лист 1С.`
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося створити маршрути");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="rounded-[var(--radius-btn)] bg-primary-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Рахую…" : plan ? "Скласти заново" : `Скласти план на ${day}`}
          </button>
          {plan && (
            <>
              <button
                type="button"
                onClick={reorder}
                disabled={loading}
                className={`rounded-[var(--radius-btn)] border px-4 py-2 text-sm disabled:opacity-50 ${stale ? "border-primary-dark text-primary-dark" : "border-g200"}`}
              >
                Перерахувати порядок
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={saving || plan.routes.length === 0}
                className="rounded-[var(--radius-btn)] border border-g200 px-4 py-2 text-sm disabled:opacity-50"
              >
                {saving ? "Створюю…" : "Створити маршрути"}
              </button>
              {Object.keys(pins).length > 0 && (
                <span className="text-xs text-g600">закріплено точок: {Object.keys(pins).length}</span>
              )}
            </>
          )}
        </div>
        {stale && (
          <div className="border-t border-g200 px-4 py-2 text-xs text-g600">
            Склад правили руками — кілометри показані як «—», поки не перерахуєте порядок.
          </div>
        )}
      </Card>

      {error && <ErrorBox>{error}</ErrorBox>}
      {loading && <CardSkeleton />}

      {plan && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              {plan.routes.map((r) => (
                <RouteColumn
                  key={r.driverId}
                  route={r}
                  others={plan.routes.filter((x) => x.driverId !== r.driverId)}
                  menuFor={menuFor}
                  setMenuFor={setMenuFor}
                  onMove={moveStop}
                  onPin={pinStop}
                  pins={pins}
                />
              ))}
            </div>
            <RoutesOverviewMap routes={mapRoutes} legend={legend} height="520px" />
          </div>

          {plan.deferred.length > 0 && (
            <Card>
              <CardHeader title="Відкладені" />
              <div className="space-y-3 p-4 text-sm">
                {plan.deferred.map((d, i) => (
                  <div key={i}>
                    <div className="text-g600">
                      {d.reason}
                      {d.suggestWeekday !== null && ` — зазвичай цей напрямок їде в ${WEEKDAY[d.suggestWeekday]}`}
                    </div>
                    <div>{d.points.map((x) => `${x.name} (${formatPrice(x.amount)})`).join(", ")}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {plan.noPin.length > 0 && (
            <Card>
              <CardHeader title={`Без точки на карті — ${plan.noPin.length}`} />
              <div className="space-y-1 p-4 text-sm">
                {plan.noPin.map((x) => (
                  <div key={x.salesDocumentId} className="flex items-center justify-between gap-2">
                    <span>
                      {x.name}
                      {x.address && <span className="text-g600"> · {x.address}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPinFor({ counterpartyId: x.counterpartyId, name: x.name, address: x.address })}
                      className="text-xs text-primary-dark"
                    >
                      Показати на карті
                    </button>
                  </div>
                ))}
                <div className="pt-2 text-g600">Пін лягає в картку клієнта — він діятиме й на всі наступні маршрути.</div>
              </div>
            </Card>
          )}

          {plan.outOfZone.length > 0 && (
            <Card>
              <CardHeader title={`Не наша розвозка — ${plan.outOfZone.length}`} />
              <div className="p-4 text-sm text-g600">
                {plan.outOfZone.map((x) => x.name).join(", ")} — поза Львівщиною, це доставка поштою.
              </div>
            </Card>
          )}

          {plan.notes.map((n, i) => (
            <div key={i} className="text-sm text-g600">{n}</div>
          ))}
        </>
      )}

      {pinFor && (
        <StopPinModal
          counterpartyId={pinFor.counterpartyId}
          name={pinFor.name}
          address={pinFor.address}
          lat={null}
          lng={null}
          approximate={false}
          onClose={() => setPinFor(null)}
          onSaved={() => {
            setPinFor(null);
            // Пін збережено — точка стане кандидатом, але тільки в новому
            // плані: досипати її в поточний означало б тихо змінити склад,
            // під який уже пораховані кілометри.
            setStale(true);
          }}
        />
      )}
    </div>
  );
}

function RouteColumn({
  route,
  others,
  menuFor,
  setMenuFor,
  onMove,
  onPin,
  pins,
}: {
  route: PlanRouteOut;
  others: PlanRouteOut[];
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  onMove: (salesDocumentId: string, toDriverId: string) => void;
  onPin: (salesDocumentId: string, driverId: string) => void;
  pins: Record<string, string>;
}) {
  const total = route.stops.reduce((s, x) => s + x.amount, 0);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-g200 p-3">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: route.color }} />
        <strong className="text-sm">{route.driverName}</strong>
        <span className="text-sm text-g600">
          {route.stops.length} точ. · {formatPrice(total)} ·{" "}
          {route.distanceKm === null ? "— км" : `${Math.round(route.distanceKm)} км`}
          {route.durationMin !== null && ` · ${Math.round(route.durationMin)} хв`}
        </span>
      </div>
      <div className="px-3 py-2 text-xs text-g600">
        {route.reason}
        {route.orderFromDistance && " · порядок за відстанню: OSRM не відповів"}
      </div>
      <ul className="divide-y divide-g200">
        {route.stops.map((s) => (
          <li
            key={s.salesDocumentId}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", s.salesDocumentId)}
            className="flex items-start justify-between gap-2 px-3 py-2 text-sm"
          >
            <span>
              <span className="text-g600">{s.sequence}. </span>
              {s.name}
              <span className="text-g600"> · {formatPrice(s.amount)}</span>
              {pins[s.salesDocumentId] && <span className="text-xs text-primary-dark"> · закріплено</span>}
              {s.neverDelivered && <span className="text-xs text-g600"> · у листах не бував</span>}
            </span>
            <span className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMenuFor(menuFor === s.salesDocumentId ? null : s.salesDocumentId)}
                className="text-xs text-primary-dark"
              >
                Дії
              </button>
              {menuFor === s.salesDocumentId && (
                <span className="absolute right-0 z-10 mt-1 flex flex-col rounded-[var(--radius-btn)] border border-g200 bg-white shadow">
                  {others.map((o) => (
                    <button
                      key={o.driverId}
                      type="button"
                      onClick={() => onMove(s.salesDocumentId, o.driverId)}
                      className="whitespace-nowrap px-3 py-2 text-left text-xs"
                    >
                      Перекинути до {o.driverName}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onPin(s.salesDocumentId, route.driverId)}
                    className="whitespace-nowrap border-t border-g200 px-3 py-2 text-left text-xs"
                  >
                    Закріпити за {route.driverName}
                  </button>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain");
          if (id) onMove(id, route.driverId);
        }}
        className="border-t border-dashed border-g200 p-2 text-center text-xs text-g600"
      >
        перетягніть точку сюди
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Звірити імпорти з реальністю**

Відкрити `src/components/ui/Card.tsx`, `src/components/ui/ErrorBox.tsx`, `src/components/ui/Skeleton.tsx` і `src/lib/utils.ts` та переконатися, що `Card`, `CardHeader`, `ErrorBox`, `CardSkeleton`, `formatPrice` експортуються саме так (іменовано чи за замовчуванням). Якщо ні — виправити імпорт під факт, а не додавати новий експорт.

- [ ] **Step 4: Перевірити типи й збірку**

Run: `npx tsc --noEmit && npm run build`
Expected: без помилок.

- [ ] **Step 5: Перевірити в браузері**

Запустити `npm run dev`, відкрити `/admin/logistics/delivery?tab=plan&day=2026-09-23` під ADMIN. Натиснути «Скласти план» і перевірити очима:
- колонки водіїв із точками, сумами й кілометрами;
- карта з лініями різного кольору й легендою;
- «Дії → Перекинути до …» переносить точку, кілометри стають «—», з'являється смужка про перерахунок;
- «Перерахувати порядок» повертає кілометри й не змінює складу колонок;
- «Дії → Закріпити» позначає точку, і після «Скласти заново» вона лишається в того ж водія;
- «Показати на карті» в блоці без піна відкриває модалку й зберігає пін;
- відкладені показані з причиною й порадою про день тижня;
- «Створити маршрути» створює чернетки, і вони видно на вкладці «День».

Зберегти знімок екрана в `output/` — він піде в повідомлення коміту як доказ.

- [ ] **Step 6: Коміт**

```bash
git add src/app/admin/logistics/delivery/components/PlanTab.tsx src/app/admin/logistics/delivery/components/RoutesShell.tsx
git commit -m "Вкладка «План»: колонки водіїв, карта, перекидання й закріплення точок"
```

---

### Task 7: Режим day_plan у помічнику

**Files:**
- Modify: `src/lib/assistant/tools/route.ts` (схема `parameters`, `description`, `run`)

**Interfaces:**
- Consumes: `buildDayPlan` з `@/lib/routes/build-day-plan` (Task 4 вже виніс логіку туди — переносити нічого не треба); `prisma`, `kyivDate`, `WEEKDAY_ACCUSATIVE` з `@/lib/assistant/facts/route-habits`.
- Produces: `build_route` з полем `mode: "stops" | "day_plan"`.

- [ ] **Step 1: Оновити опис і схему інструмента**

У `src/lib/assistant/tools/route.ts` замінити опис і додати поля:

```ts
  description:
    "Два режими. mode=\"stops\" (за замовчуванням): порядок обʼїзду за названими точками — клієнти з бази, адреси текстом, слово «склад»; повертає порядок, кілометри й хвилини від OSRM і посилання Google Maps. mode=\"day_plan\": СКЛАДАЄ МАРШРУТИ ВОДІЯМ НА ДЕНЬ — сам бере непривезені реалізації, ділить їх між водіями за історією доставок, шикує порядок і каже, що відкласти. Викликай day_plan на «склади маршрути на завтра», «розкинь доставку по водіях», «кому що везти завтра»; stops — на «як обʼїхати …», «маршрут по Стрию: …».",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["stops", "day_plan"],
        description: "stops — порядок за названими точками; day_plan — план доставки на день. Без поля — stops.",
      },
      stops: {
        type: "array",
        items: { type: "string" },
        minItems: MIN_STOPS,
        maxItems: MAX_STOPS,
        description: "Тільки для mode=stops. Точки маршруту: назви клієнтів, адреси або «склад». Від 2 до 20.",
      },
      start: {
        type: "string",
        description: "Тільки для mode=stops. Звідки виїжджати: клієнт, адреса або «склад». Без цього — склад.",
      },
      date: {
        type: "string",
        description: "Тільки для mode=day_plan. День у форматі YYYY-MM-DD. Без цього — завтра.",
      },
      drivers: {
        type: "array",
        items: { type: "string" },
        description: "Тільки для mode=day_plan. Імена водіїв, якщо людина назвала їх сама. Без цього — усі, хто возив за два тижні.",
      },
    },
    required: [],
  },
```

- [ ] **Step 2: Додати гілку в `run`**

На початку `run`, перед розбором `stops`:

```ts
    const mode = args.mode === "day_plan" ? "day_plan" : "stops";
    if (mode === "day_plan") {
      const date = str(args.date, "date", { min: 10, max: 10, required: false }) ?? kyivDate(new Date(Date.now() + 86_400_000));
      const names = Array.isArray(args.drivers) ? args.drivers.filter((v): v is string => typeof v === "string") : [];

      // Імена водіїв розв'язуємо тут, а не в ядрі: ядро не знає про базу,
      // а модель називає людей так, як їх називає менеджер — «Пайда».
      const driverIds = names.length
        ? (
            await prisma.user.findMany({
              where: { role: "DRIVER", OR: names.map((n) => ({ name: { contains: n, mode: "insensitive" as const } })) },
              select: { id: true },
            })
          ).map((d) => d.id)
        : undefined;

      const plan = await buildDayPlan({ date, driverIds });
      if ("error" in plan) return { помилка: plan.error };

      return {
        дата: plan.date,
        маршрути: plan.routes.map((r) => ({
          водій: r.driverName,
          точок: r.stops.length,
          сума: Math.round(r.stops.reduce((s, x) => s + x.amount, 0)),
          км: r.distanceKm === null ? null : Math.round(r.distanceKm),
          хвилин: r.durationMin === null ? null : Math.round(r.durationMin),
          підстава: r.reason,
          порядок: r.stops.map((s) => ({ n: s.sequence, назва: s.name, адреса: s.address, сума: Math.round(s.amount) })),
        })),
        відкладені: plan.deferred.map((d) => ({
          причина: d.reason,
          зазвичай_їде: d.suggestWeekday === null ? null : WEEKDAY_ACCUSATIVE[d.suggestWeekday],
          точки: d.points.map((p) => p.name),
        })),
        без_координат: plan.noPin.map((p) => p.name),
        не_наша_розвозка: plan.outOfZone.map((p) => p.name),
        посилання: `/admin/logistics/delivery?tab=plan&day=${plan.date}`,
        примітка: [
          ...plan.notes,
          "План поки нікуди не записаний. Щоб створити чернетки маршрутів, людина відкриває посилання й тисне «Створити маршрути».",
        ].join(" "),
      };
    }
```

Імпорти, які треба додати у файл: `prisma` з `@/lib/prisma`, `kyivDate` з `@/lib/date/kyiv`, `buildDayPlan` з `@/lib/routes/build-day-plan`, `WEEKDAY_ACCUSATIVE` з `@/lib/assistant/facts/route-habits`.

- [ ] **Step 3: Перевірити типи**

Run: `npx tsc --noEmit`
Expected: без помилок.

- [ ] **Step 4: Перевірити в чаті помічника**

Запустити `npm run dev`, відкрити помічника керівника, спитати: «склади маршрути на завтра». Перевірити:
- інструмент викликався в режимі `day_plan` (видно підпис «Будую маршрут»);
- у відповіді є розподіл по водіях із кілометрами й підставами;
- є посилання на вкладку плану;
- модель не придумала жодного числа — звірити км із видачею роуту Task 4.

Далі спитати «перекинь Коваля Піцишину» — модель має відповісти, що правки робляться на карті за посиланням (інструмент запису не має).

- [ ] **Step 5: Коміт**

```bash
git add src/lib/assistant/tools/route.ts
git commit -m "Помічник складає маршрути на день: режим day_plan у build_route"
```

---

## Після плану

Коли всі задачі закриті:

1. `npx tsc --noEmit && npm run build` — збірка має бути чистою.
2. `npx tsx --env-file=.env scripts/check-delivery-habits.mts && npx tsx scripts/check-plan-day.mts && npx tsx --env-file=.env scripts/check-plan-candidates.mts` — усі три перевірки зелені.
3. Звірка з реальністю: скласти план на день, для якого менеджер уже зробив листи руками, і порівняти склад точок по водіях. Розбіжності — матеріал для калібрування `DEFAULT_PLAN_OPTIONS`, а не привід міняти ядро.
4. Оновити `docs/1c-sync.md` не потрібно — обміну ця робота не торкається. А от рядок у `README.md` про вкладку «План» варто додати.
