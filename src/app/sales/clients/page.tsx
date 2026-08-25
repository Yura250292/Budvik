"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { SalesHeader } from "@/components/sales/SalesHeader";

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

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>("all");

  // Debounce: раніше запит летів на кожну натиснуту літеру, і при
  // повільному 3G у машині відповіді приходили не в тому порядку, у якому
  // їх просили — у списку опинявся результат передостаннього запиту.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const isCustomer = (c: Client) => {
      const type = (c as unknown as { type?: string }).type;
      return type === "CUSTOMER" || type === "BOTH";
    };

    const ask = (extra: Record<string, string>) => {
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
    const load =
      scope === "mine"
        ? ask({ mine: "1" })
        : Promise.all([ask({ mine: "1" }), ask({ limit: String(ALL_LIMIT) })]).then(
            ([mine, all]) => {
              const mineIds = new Set(mine.map((c) => c.id));
              return [
                ...mine.map((c) => ({ ...c, mine: true })),
                ...all.filter((c) => !mineIds.has(c.id)).map((c) => ({ ...c, mine: false })),
              ];
            }
          );

    load
      .then((list) => {
        if (cancelled) return;
        setClients(list);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, scope]);

  const getColor = (name: string) => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

  return (
    <div className="min-h-screen bg-background">
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

      <div className="mx-auto max-w-lg px-4 pt-3">
        {/* Чий список. Той самий поділ, що на карті: «мої» — робочий
            портфель, «всі» — база компанії для пошуку чужого клієнта. */}
        <div className="mb-3 flex gap-1 rounded-full p-1" style={{ background: "#F3F4F6" }}>
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
                className="flex-1 cursor-pointer rounded-full transition-colors duration-200"
                style={{
                  minHeight: "38px",
                  border: "none",
                  background: on ? "#0A0A0A" : "transparent",
                  color: on ? "#fff" : "#374151",
                  fontSize: "13px",
                  fontWeight: on ? 700 : 500,
                }}
              >
                {sc.label}
              </button>
            );
          })}
        </div>

        <div className="relative mb-4">
          <svg
            className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="#9CA3AF"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            placeholder="Пошук клієнта..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Пошук клієнта"
            className="w-full"
            style={{
              padding: "12px 16px 12px 44px",
              borderRadius: "14px",
              border: "1px solid #E5E7EB",
              // 16px — нижче цього iOS зумить сторінку при фокусі в поле
              fontSize: "16px",
              background: "white",
              boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
            }}
          />
        </div>

        {loading ? (
          <ClientsSkeleton />
        ) : clients.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "#F3F4F6" }}>
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            {/*
              Два різні порожні стани. «Нічого не знайдено» і «за вами ще
              нікого не закріплено» вимагають різних дій, і зливати їх в
              одну фразу означало б, що торговий шукатиме клієнта, якого
              йому просто не призначили.
            */}
            {query ? (
              <>
                <p style={{ color: "#6B7280", fontSize: "15px" }}>Нічого не знайдено</p>
                <p className="mt-1 text-xs text-g500">за запитом «{query}»</p>
              </>
            ) : (
              <>
                <p style={{ color: "#6B7280", fontSize: "15px" }}>За вами ще немає клієнтів</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-g500">
                  Тут з&apos;являться контрагенти, яких закріпив керівник, і ті, з ким у вас були
                  документи. Щоб знайти будь-якого клієнта компанії — перемкніть на «Всі клієнти».
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Обрізаний список видно одразу, а не після марного гортання. */}
            {scope === "all" && !query && (
              <p className="pb-1 text-xs text-g500">
                Спершу ваші клієнти, далі — решта бази компанії (перші {ALL_LIMIT} за абеткою).
                Щоб знайти конкретного — введіть назву в пошук: він шукає по всій базі.
              </p>
            )}
            {clients.map((c, i) => {
              const color = getColor(c.name);
              const debt = c.receivableBalance ?? 0;
              const overdue = c.overdue ?? 0;
              // Межа між своїм портфелем і рештою бази. Підпис, а не колір:
              // у списку з двох сотень рядків відтінок нічого не пояснює.
              const boundary = scope === "all" && !c.mine && i > 0 && clients[i - 1].mine === true;

              return (
                <Fragment key={c.id}>
                {boundary && (
                  <p className="px-1 pt-3 pb-1 text-xs font-semibold text-g500">Решта клієнтів компанії</p>
                )}
                <Link
                  href={`/sales/clients/${c.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-white p-4"
                  style={{ border: "1px solid #EFEFEF", textDecoration: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
                >
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                    style={{ background: `${color}15`, color, fontWeight: 700, fontSize: "16px" }}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}>
                      {c.name}
                    </p>
                    <div className="flex min-w-0 items-center gap-2">
                      {c.code && (
                        <span
                          className="shrink-0"
                          style={{ fontSize: "12px", color: "#9CA3AF", background: "#F3F4F6", padding: "1px 6px", borderRadius: "4px" }}
                        >
                          {c.code}
                        </span>
                      )}
                      {c.phone && (
                        <span className="truncate" style={{ fontSize: "12px", color: "#9CA3AF" }}>
                          {c.phone}
                        </span>
                      )}
                      {/* Точка ще не уточнена — тиха позначка, щоб торговий
                          бачив обсяг роботи, але вона не кричала гучніше
                          за борг, по який він насправді їде. */}
                      {c.geoSource !== "MANUAL" && (
                        <span
                          className="shrink-0"
                          title="Точку на карті ще не уточнено"
                          style={{ fontSize: "11px", color: "#D97706" }}
                        >
                          ⌖ пін
                        </span>
                      )}
                    </div>
                  </div>

                  {/*
                    Борг замість кількості документів: торговий іде до
                    клієнта не за статистикою, а щоб забрати гроші.
                    Прострочене підсвічуємо — це і є привід для розмови.
                  */}
                  <div className="shrink-0 text-right">
                    {debt > 0 ? (
                      <>
                        <p
                          className="tabular-nums"
                          style={{ fontSize: "14px", fontWeight: 700, color: overdue > 0 ? "#DC2626" : "#6B7280" }}
                        >
                          {formatPrice(debt)}
                        </p>
                        <p style={{ fontSize: "11px", color: overdue > 0 ? "#DC2626" : "#9CA3AF" }}>
                          {overdue > 0 ? "прострочено" : "борг"}
                        </p>
                      </>
                    ) : (
                      (c._count?.salesDocuments ?? 0) > 0 && (
                        <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{c._count!.salesDocuments} док.</p>
                      )
                    )}
                  </div>
                </Link>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
