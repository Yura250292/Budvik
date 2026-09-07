"use client";

/**
 * Пошук товару: що це, скільки є і де лежить.
 *
 * Питання, заради якого екран існує, — «на якому складі шукати». Тому
 * розкладка по складах стоїть у самій картці, а не за додатковим дотиком:
 * без неї відповідь «є 40 шт» відправляє людину ходити по всіх складах.
 *
 * Лише читання. Залишки веде обмін із 1С, і жодна дія тут їх не змінює.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Search } from "lucide-react";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Card, Note, Page, Pill } from "@/components/cabinet/ui";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  packQty: number | null;
  brand: string | null;
  stock: number;
  locations: Array<{ name: string; quantity: number; available: number; isService: boolean }>;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function WarehouseStockPage() {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");

  // Пауза перед запитом: без неї кожна літера артикула — окремий похід у базу
  // на 40 тисяч товарів, і відповіді приходять не в тому порядку, що набрані.
  useEffect(() => {
    const t = setTimeout(() => setQuery(term.trim()), 350);
    return () => clearTimeout(t);
  }, [term]);

  const { data, isLoading } = useSWR<{ products: Product[] }>(
    query.length >= 2 ? `/api/warehouse/products?q=${encodeURIComponent(query)}` : null,
    fetcher
  );

  const products = data?.products ?? [];

  return (
    <>
      <CabinetHeader title="Товар" subtitle="Залишки й де лежить" backTo="/warehouse" />

      <Page>
        <div className="flex items-center gap-2 rounded-2xl border border-cab-line bg-white px-3">
          <Search size={18} className="shrink-0 text-cab-t3" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Артикул або назва"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-bk outline-none"
          />
        </div>

        {query.length < 2 && (
          <Body>Введіть артикул із коробки або кілька слів назви — знайдемо обидва.</Body>
        )}

        {isLoading && <Body>Шукаю…</Body>}

        {query.length >= 2 && !isLoading && products.length === 0 && (
          <Card className="flex flex-col gap-1.5">
            <p className="text-[15px] font-semibold text-bk">Нічого не знайшлося</p>
            <Body>
              Артикул на коробці постачальника часто не збігається з нашим — спробуйте пошукати за
              назвою.
            </Body>
          </Card>
        )}

        {products.map((p) => (
          <Card key={p.id} className="flex flex-col gap-2">
            <div>
              <p className="text-[14px] font-semibold leading-snug text-bk">{p.name}</p>
              <p className="text-xs text-cab-t3">
                {p.sku ? `Артикул ${p.sku}` : "Без артикула"}
                {p.brand ? ` · ${p.brand}` : ""}
                {p.packQty && p.packQty > 1 ? ` · кратно ${p.packQty}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold leading-none text-bk">{p.stock}</span>
              <span className="text-[13px] text-cab-t2">вільний залишок</span>
              {p.stock <= 0 && <Pill tone="bad">немає</Pill>}
            </div>

            {p.locations.length > 0 ? (
              <div className="flex flex-col gap-1 rounded-xl bg-cab-bg px-3 py-2">
                {p.locations.map((l) => (
                  <div key={l.name} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] text-cab-t2">
                      {l.name}
                      {l.isService ? " (службовий)" : ""}
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold text-bk">
                      {l.quantity} шт
                      {l.available !== l.quantity ? ` · вільно ${l.available}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Note>Розкладки по складах немає — 1С віддає лише ненульові рядки.</Note>
            )}
          </Card>
        ))}
      </Page>
    </>
  );
}
