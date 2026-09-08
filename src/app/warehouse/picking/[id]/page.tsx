"use client";

/**
 * Збірка однієї накладної.
 *
 * Три речі, яких немає у звичайному чеклисті, і кожна з них — наслідок того,
 * що документ набирають ПОКИ його збирають:
 *
 * 1. Список сам оновлюється. Нова позиція, яку менеджер щойно вписав, має
 *    зʼявитися тут без перезаходу — інакше складовщик віднесе коробку й
 *    дізнається про недобір від водія.
 * 2. Кількість, а не галочка. У зібраному рядку кількість може вирости, і
 *    тоді це «донести 2», а не «зібрати 12 наново».
 * 3. Зайве видно окремо. Рядок, який менеджер прибрав після того, як його
 *    винесли, не мовчить: товар лежить біля воріт і його треба повернути.
 */

import { use, useState } from "react";
import useSWR from "swr";
import { Check, Minus, Plus, RefreshCw, Undo2 } from "lucide-react";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Card, Note, Page, Pill } from "@/components/cabinet/ui";

type Line = {
  productId: string;
  name: string;
  sku: string | null;
  need: number;
  picked: number;
  left: number;
  state: "чекає" | "зібрано" | "донести" | "зайве";
  packQty: number | null;
  removed: boolean;
};

type Resp = {
  документ: {
    номер: string;
    стан: string;
    клієнт: string;
    адреса: string | null;
    торговий: string | null;
    сума: number;
    коментар: string | null;
  };
  рядки: Line[];
  разом: { позицій: number; зібрано: number; лишилось: number; зайвого: number; готово: boolean };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const qty = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 3 });

export default function PickingDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, isValidating, mutate } = useSWR<Resp>(
    `/api/warehouse/picking/${id}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );
  const [busy, setBusy] = useState<string | null>(null);

  const mark = async (productId: string, quantity: number) => {
    setBusy(productId);
    try {
      const res = await fetch(`/api/warehouse/picking/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: Math.max(0, quantity) }),
      });
      if (res.ok) await mutate();
    } finally {
      setBusy(null);
    }
  };

  const doc = data?.документ;
  const lines = data?.рядки ?? [];
  const total = data?.разом;

  return (
    <>
      <CabinetHeader
        title={doc ? `№${doc.номер}` : "Накладна"}
        subtitle={doc ? `${doc.клієнт}` : "Збірка"}
        backTo="/warehouse/picking"
        right={
          isValidating ? <RefreshCw size={16} className="animate-spin text-white/50" /> : undefined
        }
      />

      <Page>
        {isLoading && <Body>Завантажую…</Body>}

        {!!doc && !!total && (
          <Card tone={total.готово ? "ok" : doc.стан === "набирається" ? "brand" : "plain"}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-bold text-bk">
                {total.зібрано} з {total.позицій} позицій
              </span>
              {doc.стан === "набирається" ? (
                <Pill tone="warn">ще набирається</Pill>
              ) : total.готово ? (
                <Pill tone="ok">зібрано</Pill>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] text-cab-t2">
              {money.format(doc.сума)} ₴{doc.торговий ? ` · ${doc.торговий}` : ""}
            </p>
            {!!doc.адреса && <p className="text-xs text-cab-t3">{doc.адреса}</p>}
            {!!doc.коментар && <Note tone="warn">{doc.коментар}</Note>}
            {doc.стан === "набирається" && (
              <Note>
                Менеджер ще дописує цю накладну. Нові позиції зʼявляться тут самі — зібране не
                зникне.
              </Note>
            )}
          </Card>
        )}

        {lines.map((l) => (
          <Card
            key={l.productId}
            tone={l.state === "зайве" ? "bad" : l.state === "зібрано" ? "ok" : "plain"}
            className="flex flex-col gap-2"
          >
            <div>
              <p className="text-[14px] font-semibold leading-snug text-bk">{l.name}</p>
              <p className="text-xs text-cab-t3">
                {l.sku ? `Артикул ${l.sku}` : "Без артикула"}
                {l.packQty && l.packQty > 1 ? ` · кратно ${l.packQty}` : ""}
              </p>
            </div>

            {l.removed ? (
              <>
                <Note tone="bad">
                  Цього рядка в накладній уже немає, а зібрано {qty.format(l.picked)}. Віднесіть
                  назад на місце.
                </Note>
                <button
                  type="button"
                  disabled={busy === l.productId}
                  onClick={() => mark(l.productId, 0)}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-cab-line bg-white text-[13px] font-semibold text-bk"
                >
                  <Undo2 size={16} />
                  Повернув на місце
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-bold leading-none text-bk">
                    {qty.format(l.need)}
                    <span className="ml-1 text-[13px] font-medium text-cab-t3">треба</span>
                  </p>
                  <p className="mt-1 text-[13px] text-cab-t2">
                    {l.state === "зібрано"
                      ? "зібрано"
                      : l.state === "донести"
                        ? `зібрано ${qty.format(l.picked)} — донести ${qty.format(l.left)}`
                        : l.state === "зайве"
                          ? `зібрано ${qty.format(l.picked)} — на ${qty.format(-l.left)} більше`
                          : "ще не зібрано"}
                  </p>
                </div>

                {/* Мінус і плюс — для дробів і часткової збірки; головна дія
                    лишається одним дотиком по «зібрано». */}
                <button
                  type="button"
                  aria-label="Менше"
                  disabled={busy === l.productId || l.picked <= 0}
                  onClick={() => mark(l.productId, l.picked - 1)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cab-line bg-white disabled:opacity-40"
                >
                  <Minus size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Більше"
                  disabled={busy === l.productId}
                  onClick={() => mark(l.productId, l.picked + 1)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cab-line bg-white"
                >
                  <Plus size={18} />
                </button>
                <button
                  type="button"
                  disabled={busy === l.productId}
                  onClick={() => mark(l.productId, l.state === "зібрано" ? 0 : l.need)}
                  className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-bold ${
                    l.state === "зібрано" ? "bg-ok text-white" : "bg-primary text-bk"
                  }`}
                >
                  <Check size={16} />
                  {l.state === "зібрано" ? "Є" : "Взяв"}
                </button>
              </div>
            )}
          </Card>
        ))}

        {!isLoading && lines.length === 0 && (
          <Card>
            <Body>У накладній ще немає жодної позиції — менеджер тільки почав її набирати.</Body>
          </Card>
        )}
      </Page>
    </>
  );
}
