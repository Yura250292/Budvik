"use client";

/**
 * Сканер накладних — сторінка кабінету.
 *
 * У застосунку її не видно: адресу перехоплює натив і відкриває камеру
 * (mobile/src/lib/native-routes.ts). Тут — той самий шлях для браузера: фото з
 * галереї або з камери телефона через звичайне поле файлу. Заради цього
 * сторінка й лишається веб-сторінкою, а не кнопкою в застосунку: складовщик
 * без застосунку (новий планшет, чужий телефон) не має лишатися без сканера.
 *
 * Фото йдуть ПО ОДНОМУ, послідовно. Паралельно було б швидше, але кожен кадр —
 * це виклик до Gemini на кілька секунд і кілька мегабайт угору: з мережею
 * складу п'ять одночасних запитів кінчаються п'ятьма тайм-аутами замість
 * п'яти накладних.
 */

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Camera, Check, X, Loader2 } from "lucide-react";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Button, Card, CardTitle, Note, Page } from "@/components/cabinet/ui";

type Row = {
  key: string;
  fileName: string;
  state: "queued" | "sending" | "done" | "failed";
  title?: string;
  detail?: string;
  reportId?: string;
  error?: string;
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

export default function WarehouseScanPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const send = useCallback(async (files: File[]) => {
    setBusy(true);
    const fresh: Row[] = files.map((f, i) => ({
      key: `${Date.now()}-${i}`,
      fileName: f.name || `Фото ${i + 1}`,
      state: "queued",
    }));
    setRows((prev) => [...fresh, ...prev]);

    const patch = (key: string, next: Partial<Row>) =>
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

    for (let i = 0; i < files.length; i++) {
      const row = fresh[i];
      patch(row.key, { state: "sending" });
      try {
        const form = new FormData();
        form.append("photo", files[i]);
        const res = await fetch("/api/warehouse/scan", { method: "POST", body: form });
        const body = await res.json().catch(() => null);

        if (!res.ok) {
          patch(row.key, { state: "failed", error: body?.error ?? `Сервер відповів ${res.status}` });
          continue;
        }

        const rep = body.report;
        patch(row.key, {
          state: "done",
          reportId: rep.id,
          title: rep.docNumber ? `№${rep.docNumber}` : "Без номера",
          detail: [
            rep.counterpartyName,
            `${rep.itemsCount} позицій`,
            rep.totalAmount ? `${money.format(rep.totalAmount)} ₴` : null,
            body.duplicate ? "вже було" : null,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      } catch {
        patch(row.key, { state: "failed", error: "Немає зв'язку — спробуйте ще раз" });
      }
    }

    setBusy(false);
  }, []);

  return (
    <>
      <CabinetHeader title="Накладна" subtitle="Фото → офіс" backTo="/warehouse" />

      <Page>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void send(files);
          }}
        />

        <Button tone="brand" disabled={busy} onClick={() => inputRef.current?.click()} className="w-full">
          <Camera size={20} />
          {busy ? "Надсилаю…" : "Зняти накладну"}
        </Button>

        <Note>
          Аркуш повністю в кадрі, без заломів і бліків. Довгу накладну знімайте частинами — кожна
          частина поїде окремою.
        </Note>

        {rows.length === 0 ? (
          <Card className="flex flex-col gap-1.5">
            <CardTitle>Як це працює</CardTitle>
            <Body>
              Фото їде в офіс, і там його читає AI: номер, дата, контрагент і кожен рядок таблиці.
              Залишки й документи в 1С від цього НЕ змінюються — розпізнане лишається звітом для
              людини.
            </Body>
          </Card>
        ) : (
          rows.map((r) => (
            <Card
              key={r.key}
              tone={r.state === "failed" ? "bad" : r.state === "done" ? "ok" : "plain"}
              className="flex items-start gap-3"
            >
              <span className="mt-0.5 shrink-0">
                {r.state === "done" ? (
                  <Check size={18} className="text-ok-fg" />
                ) : r.state === "failed" ? (
                  <X size={18} className="text-bad-fg" />
                ) : (
                  <Loader2 size={18} className="animate-spin text-cab-t3" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-bk">
                  {r.state === "done" ? r.title : r.fileName}
                </p>
                <p className="text-[13px] leading-snug text-cab-t2">
                  {r.state === "done"
                    ? r.detail
                    : r.state === "failed"
                      ? r.error
                      : r.state === "sending"
                        ? "Читаю…"
                        : "У черзі"}
                </p>
                {r.state === "done" && !!r.reportId && (
                  <Link
                    href={`/warehouse/invoices/${r.reportId}`}
                    className="mt-1 inline-block text-[13px] font-semibold text-bk underline underline-offset-2"
                  >
                    Подивитися позиції
                  </Link>
                )}
              </div>
            </Card>
          ))
        )}
      </Page>
    </>
  );
}
