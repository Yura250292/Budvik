"use client";

/**
 * Мої накладні за день.
 *
 * Головне тут — не список, а відповідь на питання «чи все доїхало». Тому
 * невдалі стоять першими за кольором і мають кнопку «Спробувати ще раз»: до
 * появи цього екрана про непрочитану накладну складовщик дізнавався від офісу
 * наступного дня, коли перезняти її вже не було з чого.
 */

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { ChevronRight, RefreshCw } from "lucide-react";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Button, Card, Eyebrow, Note, Page, Pill } from "@/components/cabinet/ui";
import { ScanButton } from "@/components/warehouse/ScanButton";

type Report = {
  id: string;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  createdAt: string;
  docNumber: string | null;
  docType: string | null;
  counterpartyName: string | null;
  totalAmount: number | null;
  itemsCount: number;
  errorMessage: string | null;
};

type Resp = {
  day: string;
  reports: Report[];
  summary: { total: number; done: number; pending: number; failed: number; totalAmount: number; itemsCount: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Київська «сьогодні» — та сама межа доби, за якою рахує сервер. */
function kyivToday(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
}

const STATUS: Record<Report["status"], { label: string; tone: "ok" | "warn" | "bad" }> = {
  DONE: { label: "Прочитано", tone: "ok" },
  PENDING: { label: "Читається", tone: "warn" },
  PROCESSING: { label: "Читається", tone: "warn" },
  FAILED: { label: "Не вийшло", tone: "bad" },
};

export default function WarehouseInvoicesPage() {
  const [day, setDay] = useState(kyivToday());
  const { data, isLoading, mutate } = useSWR<Resp>(`/api/warehouse/reports?day=${day}`, fetcher, {
    refreshInterval: 30_000,
  });
  const [retrying, setRetrying] = useState<string | null>(null);

  const retry = async (id: string) => {
    setRetrying(id);
    await fetch(`/api/warehouse/reports/${id}/retry`, { method: "POST" }).catch(() => {});
    await mutate();
    setRetrying(null);
  };

  const reports = data?.reports ?? [];

  return (
    <>
      <CabinetHeader
        title="Накладні"
        subtitle={day === kyivToday() ? "Сьогодні" : day}
        backTo="/warehouse"
      />

      <Page>
        <div className="flex gap-2">
          {[0, -1, -2].map((off) => {
            const d = kyivToday(off);
            const label = off === 0 ? "Сьогодні" : off === -1 ? "Учора" : d.slice(8) + "." + d.slice(5, 7);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={`h-10 flex-1 rounded-xl text-[13px] font-semibold ${
                  day === d ? "bg-bk text-white" : "border border-cab-line bg-white text-cab-t2"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {!!data?.summary && (
          <Card className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] text-cab-t2">
              {data.summary.total} накладних · {data.summary.itemsCount} позицій
            </span>
            <span className="text-lg font-bold text-bk">
              {money.format(data.summary.totalAmount)} ₴
            </span>
          </Card>
        )}

        {isLoading && <Body>Завантажую…</Body>}

        {!isLoading && reports.length === 0 && (
          <Card className="flex flex-col gap-2">
            <p className="text-[15px] font-semibold text-bk">За цей день накладних немає</p>
            <Body>Сфотографована накладна з&apos;являється тут за кілька секунд.</Body>
            {day === kyivToday() && <ScanButton label="Зняти накладну" />}
          </Card>
        )}

        {reports.length > 0 && <Eyebrow>За день</Eyebrow>}

        {reports.map((r) => {
          const st = STATUS[r.status];
          return (
            <Card key={r.id} tone={r.status === "FAILED" ? "bad" : "plain"} className="flex flex-col gap-2">
              <Link href={`/warehouse/invoices/${r.id}`} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-bold text-bk">
                      {r.docNumber ? `№${r.docNumber}` : "Без номера"}
                    </span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </div>
                  <p className="truncate text-[13px] text-cab-t2">
                    {r.counterpartyName ?? "Контрагента не впізнано"}
                  </p>
                  <p className="text-xs text-cab-t3">
                    {new Date(r.createdAt).toLocaleTimeString("uk-UA", {
                      timeZone: "Europe/Kyiv",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {r.itemsCount} позицій
                    {r.totalAmount ? ` · ${money.format(r.totalAmount)} ₴` : ""}
                  </p>
                </div>
                <ChevronRight size={18} className="mt-1 shrink-0 text-cab-t3" />
              </Link>

              {r.status === "FAILED" && (
                <>
                  {!!r.errorMessage && <Note tone="bad">{r.errorMessage}</Note>}
                  <Button
                    tone="outline"
                    small
                    disabled={retrying === r.id}
                    onClick={() => retry(r.id)}
                    className="w-full"
                  >
                    <RefreshCw size={16} />
                    {retrying === r.id ? "Читаю…" : "Спробувати ще раз"}
                  </Button>
                </>
              )}
            </Card>
          );
        })}
      </Page>
    </>
  );
}
