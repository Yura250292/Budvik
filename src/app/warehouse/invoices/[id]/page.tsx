"use client";

/**
 * Одна накладна: що саме прочитав AI.
 *
 * Позиції показуємо разом із фото — і це не прикраса. Єдиний спосіб перевірити
 * розпізнане — покласти поруч рядок і аркуш; без знімка людина мусила б іти
 * шукати паперову накладну, тобто перевірка не робилася б узагалі.
 *
 * Зіставлення з довідником показуємо окремим підписом, а не підміняємо ним
 * назву з накладної: «схоже, це ось цей товар» і «в накладній написано так» —
 * різні твердження, і плутати їх на складі коштує дорого.
 */

import { use } from "react";
import useSWR from "swr";
import { Link2 } from "lucide-react";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Card, CardTitle, Eyebrow, Note, Page, Pill } from "@/components/cabinet/ui";

type Item = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  price: number;
  unit: string | null;
  lineTotal: number;
  matchedProductName: string | null;
};

type Resp = {
  report: {
    id: string;
    status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
    createdAt: string;
    docType: string | null;
    docNumber: string | null;
    docDate: string | null;
    counterpartyName: string | null;
    counterpartyCode: string | null;
    totalAmount: number | null;
    itemsCount: number;
    notes: string | null;
    errorMessage: string | null;
  };
  items: Item[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 });

export default function WarehouseInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading } = useSWR<Resp>(`/api/warehouse/reports/${id}`, fetcher);

  const r = data?.report;

  return (
    <>
      <CabinetHeader
        title={r?.docNumber ? `№${r.docNumber}` : "Накладна"}
        subtitle={r?.docType === "purchase" ? "Прихідна" : r?.docType === "sales" ? "Видаткова" : "Накладна"}
        backTo="/warehouse/invoices"
      />

      <Page>
        {isLoading && <Body>Завантажую…</Body>}

        {!!r && (
          <Card className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <CardTitle big>{r.counterpartyName ?? "Контрагента не впізнано"}</CardTitle>
              {r.status === "DONE" ? (
                <Pill tone="ok">Прочитано</Pill>
              ) : r.status === "FAILED" ? (
                <Pill tone="bad">Не вийшло</Pill>
              ) : (
                <Pill tone="warn">Читається</Pill>
              )}
            </div>
            <p className="text-[13px] text-cab-t2">
              {r.docDate ? new Date(r.docDate).toLocaleDateString("uk-UA") : "Дата не прочиталася"}
              {r.counterpartyCode ? ` · ЄДРПОУ ${r.counterpartyCode}` : ""}
            </p>
            {r.totalAmount != null && (
              <p className="text-2xl font-bold text-bk">{money.format(r.totalAmount)} ₴</p>
            )}
            {!!r.notes && <Note>{r.notes}</Note>}
            {!!r.errorMessage && <Note tone="bad">{r.errorMessage}</Note>}
          </Card>
        )}

        {/* Фото приватне: віддається роутом під тим самим гейтом, а не
            публічним посиланням R2. */}
        <Card className="overflow-hidden p-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/warehouse/reports/${id}/photo`}
            alt="Фото накладної"
            className="w-full"
          />
        </Card>

        {!!data?.items?.length && <Eyebrow>Позиції ({data.items.length})</Eyebrow>}

        {data?.items?.map((it) => (
          <Card key={it.id} className="flex flex-col gap-1">
            <p className="text-[14px] font-semibold leading-snug text-bk">{it.name}</p>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] text-cab-t2">
                {it.quantity} {it.unit ?? "шт"} × {money.format(it.price)} ₴
              </span>
              <span className="text-[15px] font-bold text-bk">{money.format(it.lineTotal)} ₴</span>
            </div>
            {!!it.sku && <span className="text-xs text-cab-t3">Артикул {it.sku}</span>}
            {!!it.matchedProductName && (
              <p className="flex items-start gap-1.5 text-xs text-cab-t3">
                <Link2 size={13} className="mt-0.5 shrink-0" />
                Схоже на «{it.matchedProductName}» з довідника
              </p>
            )}
          </Card>
        ))}

        <Note>
          Розпізнане не змінює залишки й документи: це звіт для офісу. Помилку в рядку виправляють
          там, у «Звітах зі складу».
        </Note>
      </Page>
    </>
  );
}
