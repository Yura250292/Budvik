"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { SalesHeader } from "@/components/sales/SalesHeader";

const AVATAR_COLORS = ["#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B", "#22C55E", "#EF4444", "#06B6D4"];

type Client = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  address: string | null;
  receivableBalance: number | null;
  geoSource: string | null;
  debtOverdue30: number | null;
  debtOverdue60: number | null;
  debtOverdue90: number | null;
  debtOverdue90Plus: number | null;
  _count?: { salesDocuments?: number };
};

/** Сума всіх прострочених кошиків. Поля можуть бути null — борг ще не синхронізовано. */
function overdueOf(c: Client): number {
  return (
    (c.debtOverdue30 ?? 0) + (c.debtOverdue60 ?? 0) + (c.debtOverdue90 ?? 0) + (c.debtOverdue90Plus ?? 0)
  );
}

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

    const params = new URLSearchParams();
    if (query) params.set("search", query);

    fetch(`/api/erp/counterparties?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const arr: Client[] = Array.isArray(data) ? data : [];
        setClients(arr.filter((c) => {
          const type = (c as unknown as { type?: string }).type;
          return type === "CUSTOMER" || type === "BOTH";
        }));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

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
                  документи. Якщо список порожній — зверніться до керівника.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((c) => {
              const color = getColor(c.name);
              const debt = c.receivableBalance ?? 0;
              const overdue = overdueOf(c);

              return (
                <Link
                  key={c.id}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
