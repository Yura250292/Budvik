"use client";

import { Fragment, useEffect, useState } from "react";
import useSWR from "swr";
import { Search, Users } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { ListRow, Note, Page, Pill } from "@/components/cabinet/ui";

const AVATAR_COLORS = ["#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B", "#22C55E", "#EF4444", "#06B6D4"];

/**
 * Чий список показуємо.
 *
 * «Мої» — закріплені керівником плюс ті, з ким були документи. Обидва
 * джерела дірчасті, тож у режимі «Всі» видно всю базу компанії: торговий
 * на новій території інакше не знайде навіть того клієнта, до якого його
 * щойно відправили.
 */
type Scope = "mine" | "all";

/**
 * Скільки рядків тягнемо в режимі «Всі».
 *
 * Уся база — 3.6 тис. контрагентів і майже мегабайт JSON: гортати це на
 * телефоні однаково ніхто не буде, а пошук і так іде на сервер по всій
 * базі. Тому показуємо перші 200 і чесно кажемо, що список обрізано.
 */
const ALL_LIMIT = 200;

type Client = {
  id: string;
  name: string;
  /** Проставляється на клієнті після злиття двох вибірок, з API не приходить. */
  mine?: boolean;
  code: string | null;
  phone: string | null;
  address: string | null;
  receivableBalance: number | null;
  geoSource: string | null;
  /**
   * Прострочена частина боргу, порахована на сервері.
   *
   * Раніше тут складались поля debtOverdue30/60/90/90Plus, але 1С розбивку
   * за строками не надсилає — вони порожні у всіх контрагентів, і список
   * завжди показував нуль, поки аналітика показувала реальну прострочку.
   */
  overdue?: number | null;
  _count?: { salesDocuments?: number };
};

function ClientsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-g200 bg-white p-4">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

const isCustomer = (c: Client) => {
  const type = (c as unknown as { type?: string }).type;
  return type === "CUSTOMER" || type === "BOTH";
};

const ask = (extra: Record<string, string>, query: string) => {
  const params = new URLSearchParams(extra);
  if (query) params.set("search", query);
  return fetch(`/api/erp/counterparties?${params}`)
    .then((r) => r.json())
    .then((d): Client[] => (Array.isArray(d) ? d.filter(isCustomer) : []));
};

/**
 * У режимі «Всі» тягнемо дві вибірки й зшиваємо: спершу свої, потім
 * решта бази за абеткою.
 *
 * Одним запитом так не вийде: сортувати «спершу мої» довелося б у SQL
 * спільного роуту, яким користується ще десяток екранів. А без цього
 * порядку торговий, відкривши «Клієнтів», бачив би дві сотні чужих
 * прізвищ на «А» замість власного списку — формально всіх, практично
 * гірше, ніж було.
 */
async function loadClients([, scope, query]: [string, Scope, string]): Promise<Client[]> {
  if (scope === "mine") return ask({ mine: "1" }, query);

  const [mine, all] = await Promise.all([
    ask({ mine: "1" }, query),
    ask({ limit: String(ALL_LIMIT) }, query),
  ]);
  const mineIds = new Set(mine.map((c) => c.id));
  return [
    ...mine.map((c) => ({ ...c, mine: true })),
    ...all.filter((c) => !mineIds.has(c.id)).map((c) => ({ ...c, mine: false })),
  ];
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");

  // Debounce: раніше запит летів на кожну натиснуту літеру, і при
  // повільному 3G у машині відповіді приходили не в тому порядку, у якому
  // їх просили — у списку опинявся результат передостаннього запиту.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * Список живе в кеші SWR, а не в стані сторінки.
   *
   * З fetch у useEffect кожен захід на вкладку починався з порожнього
   * екрана й двох запитів по ~0,5 с — навіть якщо торговий був тут
   * хвилину тому й нічого не змінилося. Ключ масивом: у ньому і зріз, і
   * пошуковий запит, тож повернення до вже баченого списку миттєве, а
   * нова літера в пошуку — це новий ключ і новий запит, як і було.
   */
  const { data, isLoading } = useSWR(["sales-clients", scope, query] as const, loadClients, {
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const clients = data ?? [];
  // keepPreviousData лишає на екрані попередній список, поки їде новий —
  // заглушку показуємо лише коли показувати справді нічого.
  const loading = isLoading && !data;

  const getColor = (name: string) => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

  return (
    <>
      <SalesHeader
        title="Клієнти"
        backTo="/sales"
        sticky
        right={
          !loading ? (
            <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>{clients.length}</span>
          ) : null
        }
      />

      <Page>
        {/* Чий список. Той самий поділ, що на карті: «мої» — робочий
            портфель, «всі» — база компанії для пошуку чужого клієнта. */}
        <div className="flex gap-1 rounded-full bg-[#E9E9E6] p-1">
          {(
            [
              { key: "mine", label: "Мої" },
              { key: "all", label: "Всі клієнти" },
            ] as Array<{ key: Scope; label: string }>
          ).map((sc) => {
            const on = scope === sc.key;
            return (
              <button
                key={sc.key}
                type="button"
                onClick={() => setScope(sc.key)}
                aria-pressed={on}
                className={`min-h-[38px] flex-1 rounded-full text-sm transition-colors ${
                  on ? "bg-bk font-bold text-white" : "font-medium text-cab-t2"
                }`}
              >
                {sc.label}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-cab-t3" />
          <input
            type="search"
            placeholder="Пошук клієнта…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Пошук клієнта"
            // 16px — нижче цього iOS зумить сторінку при фокусі в поле
            className="h-12 w-full rounded-xl border border-cab-line bg-white pl-11 pr-4 text-base"
          />
        </div>

        {loading ? (
          <ClientsSkeleton />
        ) : clients.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Users size={32} className="text-cab-t3" />
            {/*
              Два різні порожні стани. «Нічого не знайдено» і «за вами ще
              нікого не закріплено» вимагають різних дій, і зливати їх в
              одну фразу означало б, що торговий шукатиме клієнта, якого
              йому просто не призначили.
            */}
            {query ? (
              <>
                <p className="text-[15px] font-semibold text-bk">Нічого не знайдено</p>
                <Note>за запитом «{query}»</Note>
              </>
            ) : (
              <>
                <p className="text-[15px] font-semibold text-bk">За вами ще немає клієнтів</p>
                <Note>
                  Тут зʼявляться контрагенти, яких закріпив керівник, і ті, з ким у вас були
                  документи. Щоб знайти будь-якого клієнта компанії — перемкніть на «Всі клієнти».
                </Note>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Обрізаний список видно одразу, а не після марного гортання. */}
            {scope === "all" && !query && (
              <Note>
                Спершу ваші клієнти, далі — решта бази компанії (перші {ALL_LIMIT} за абеткою). Щоб
                знайти конкретного — введіть назву в пошук: він шукає по всій базі.
              </Note>
            )}
            {clients.map((c, i) => {
              const debt = c.receivableBalance ?? 0;
              const overdue = c.overdue ?? 0;
              const docs = c._count?.salesDocuments ?? 0;
              // Межа між своїм портфелем і рештою бази. Підпис, а не колір:
              // у списку з двох сотень рядків відтінок нічого не пояснює.
              const boundary = scope === "all" && !c.mine && i > 0 && clients[i - 1].mine === true;

              return (
                <Fragment key={c.id}>
                  {boundary && (
                    <p className="px-1 pb-1 pt-3 text-xs font-semibold text-cab-t3">
                      Решта клієнтів компанії
                    </p>
                  )}
                  <ListRow
                    href={`/sales/clients/${c.id}`}
                    lead={c.name.charAt(0).toUpperCase()}
                    leadColor={getColor(c.name)}
                    title={c.name}
                    subtitle={
                      [
                        c.code,
                        c.phone,
                        // Точка ще не уточнена — тиха позначка, щоб торговий
                        // бачив обсяг роботи, але вона не кричала гучніше
                        // за борг, по який він насправді їде.
                        c.geoSource !== "MANUAL" ? "точку не уточнено" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    /*
                      Борг замість кількості документів: торговий іде до
                      клієнта не за статистикою, а щоб забрати гроші.
                      Прострочене підсвічуємо — це і є привід для розмови.
                    */
                    value={
                      debt > 0 ? (
                        <span className={overdue > 0 ? "tabular-nums text-bad-fg" : "tabular-nums text-cab-t2"}>
                          {formatPrice(debt)}
                        </span>
                      ) : docs > 0 ? (
                        <span className="font-medium text-cab-t3">{docs} док.</span>
                      ) : undefined
                    }
                    badge={
                      debt > 0 ? (
                        <Pill tone={overdue > 0 ? "bad" : "neutral"} dot>
                          {overdue > 0 ? "прострочено" : "борг"}
                        </Pill>
                      ) : undefined
                    }
                  />
                </Fragment>
              );
            })}
          </div>
        )}
      </Page>
    </>
  );
}
