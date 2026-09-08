"use client";

/**
 * Що збирати зараз.
 *
 * Список навмисно короткий і живий: накладні за останні дні, які ще в роботі.
 * «Набирається» вгорі списку — це та, яку менеджер дописує просто зараз, і
 * саме її склад збирає, не чекаючи «проведено».
 *
 * Оновлюється сама: обмін привозить нові позиції кожні пʼять хвилин, і екран,
 * який показує стан на момент відкриття, брехав би вже через десять.
 */

import useSWR from "swr";
import Link from "next/link";
import { ChevronRight, RefreshCw } from "lucide-react";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Card, Eyebrow, Note, Page, Pill } from "@/components/cabinet/ui";

type Row = {
  id: string;
  номер: string;
  стан: "набирається" | "проведено" | "пакується";
  клієнт: string;
  торговий: string | null;
  позицій: number;
  сума: number;
  створено: string;
  взявся: string | null;
  рядківЗібрано: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PickingPage() {
  const { data, isLoading, isValidating } = useSWR<{ документи: Row[] }>(
    "/api/warehouse/picking",
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );

  const rows = data?.документи ?? [];
  const inWork = rows.filter((r) => r.стан === "набирається");
  const rest = rows.filter((r) => r.стан !== "набирається");

  return (
    <>
      <CabinetHeader
        title="Збірка"
        subtitle={rows.length ? `${rows.length} накладних у роботі` : "Накладні в роботі"}
        right={
          isValidating ? <RefreshCw size={16} className="animate-spin text-white/50" /> : undefined
        }
      />

      <Page>
        {isLoading && <Body>Завантажую…</Body>}

        {!isLoading && rows.length === 0 && (
          <Card className="flex flex-col gap-1.5">
            <p className="text-[15px] font-semibold text-bk">Зараз нічого збирати</p>
            <Body>
              Тут зʼявляються накладні, які менеджер набирає в 1С. Нова позиція доїжджає сюди за
              кілька хвилин після того, як її вписали.
            </Body>
          </Card>
        )}

        {inWork.length > 0 && <Eyebrow>Набираються просто зараз</Eyebrow>}
        {inWork.map((r) => (
          <PickRow key={r.id} row={r} />
        ))}

        {rest.length > 0 && <Eyebrow>Проведені</Eyebrow>}
        {rest.map((r) => (
          <PickRow key={r.id} row={r} />
        ))}

        {rows.length > 0 && (
          <Note>
            Накладна росте, поки менеджер її набирає: нові позиції зʼявляються самі, а зібране
            нікуди не дінеться.
          </Note>
        )}
      </Page>
    </>
  );
}

function PickRow({ row }: { row: Row }) {
  return (
    <Card tone={row.стан === "набирається" ? "brand" : "plain"} className="p-0">
      <Link href={`/warehouse/picking/${row.id}`} className="flex items-start gap-2 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-bold text-bk">№{row.номер}</span>
            {row.стан === "набирається" ? (
              <Pill tone="warn">набирається</Pill>
            ) : row.рядківЗібрано > 0 ? (
              <Pill tone="ok">збирають</Pill>
            ) : null}
          </div>
          <p className="truncate text-[13px] text-cab-t2">{row.клієнт}</p>
          <p className="text-xs text-cab-t3">
            {time(row.створено)} · {row.позицій} позицій · {money.format(row.сума)} ₴
            {row.взявся ? ` · ${row.взявся}` : ""}
          </p>
        </div>
        <ChevronRight size={18} className="mt-1 shrink-0 text-cab-t3" />
      </Link>
    </Card>
  );
}
