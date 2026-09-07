"use client";

/**
 * Головна складу: зміна, сканер, підсумок дня.
 *
 * Порядок карток — це порядок дня людини: прийшов і відкрив зміну, потім
 * увесь день фотографує накладні, увечері закрив. Тому сканер стоїть одразу
 * під зміною й на всю ширину: у нього цілять пальцем, тримаючи коробку, і
 * дрібна кнопка в кутку тут не працює.
 *
 * Це те саме, що складовщик робив у Telegram-боті. Різниця в тому, що
 * геолокацію тут дає сам пристрій, а не кнопка «поділитися розташуванням», і
 * зміну не можна випадково закрити повторним дотиком по «відкрити».
 */

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { MapPin, LogIn, LogOut } from "lucide-react";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Button, Card, CardHead, Note, Page, StatCard, Tile, TileRow } from "@/components/cabinet/ui";
import { useProfile } from "@/lib/useProfile";
import { ScanButton } from "@/components/warehouse/ScanButton";

type Shift = {
  id: string;
  status: string;
  openedAt: string;
  openAddress: string | null;
  closedAt: string | null;
  closeAddress: string | null;
  durationMinutes: number | null;
};

type ShiftResponse = {
  shift: Shift | null;
  summary: { reportsCount: number; doneCount: number; pendingCount: number; totalAmount: number } | null;
  today: { total: number; done: number; pending: number; failed: number; totalAmount: number; itemsCount: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hoursSince(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return `${Math.floor(mins / 60)} год ${String(mins % 60).padStart(2, "0")} хв`;
}

/**
 * Координати — необов'язкові й із межею часу.
 *
 * На складі всередині ангара GPS може шукати супутники хвилинами, а зміна має
 * відкритися зараз. Тому через 8 секунд ідемо без координат: сервер їх приймає
 * порожніми, і офіс побачить час без адреси — це незрівнянно краще, ніж
 * людина, яка стоїть біля терміналу й чекає на супутник.
 */
async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;

  /**
   * Відмову питаємо наперед, а не чекаємо на тайм-аут.
   *
   * У застосунку складовщика дозволу на місце може не бути взагалі — він
   * маршрут не пише, і ніхто його не просив. Без цієї перевірки кожне
   * відкриття зміни коштувало б восьми секунд очікування на відповідь, якої
   * не буде.
   */
  const perm = await navigator.permissions?.query({ name: "geolocation" as PermissionName }).catch(() => null);
  if (perm?.state === "denied") return null;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    );
  });
}

export default function WarehouseHomePage() {
  const me = useProfile();
  const { data, mutate, isLoading } = useSWR<ShiftResponse>("/api/warehouse/shift", fetcher, {
    refreshInterval: 60_000,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const shift = data?.shift ?? null;
  const today = data?.today;

  useEffect(() => {
    if (!shift) setConfirmClose(false);
  }, [shift]);

  const act = useCallback(
    async (action: "open" | "close", force = false) => {
      setBusy(true);
      setError(null);
      try {
        const pos = await currentPosition();
        const res = await fetch("/api/warehouse/shift", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, force, ...(pos ?? {}) }),
        });
        const body = await res.json().catch(() => null);

        // 409 з needsConfirm — не помилка, а питання: є накладні, які ще
        // розпізнаються. Питаємо один раз і закриваємо зміну з force.
        if (res.status === 409 && body?.needsConfirm) {
          setConfirmClose(true);
          return;
        }
        if (!res.ok) throw new Error(body?.error ?? `Сервер відповів ${res.status}`);
        setConfirmClose(false);
        await mutate();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося. Спробуйте ще раз");
      } finally {
        setBusy(false);
      }
    },
    [mutate]
  );

  return (
    <>
      <CabinetHeader
        title={me?.name ?? "Склад"}
        subtitle={shift ? `Зміна з ${timeOf(shift.openedAt)}` : "Зміну не відкрито"}
      />

      <Page>
        {/* Сканер — перше і найбільше: заради нього застосунок і ставили. */}
        <ScanButton />

        <Card tone={shift ? "brand" : "plain"} className="flex flex-col gap-3">
          <CardHead
            title={shift ? "Зміна відкрита" : "Зміну не відкрито"}
            dot={shift ? "#16A34A" : "#9CA3AF"}
            right={shift ? <span className="text-[13px] text-cab-t2">{hoursSince(shift.openedAt)}</span> : undefined}
          />

          {shift ? (
            <>
              <p className="flex items-center gap-1.5 text-[13px] text-cab-t2">
                <MapPin size={14} className="shrink-0 text-cab-t3" />
                {shift.openAddress ?? "Місце не визначилося"}
              </p>

              {confirmClose ? (
                <>
                  <Note tone="warn">
                    Кілька накладних ще розпізнаються. Закриємо зміну — вони доїдуть в офіс самі, але
                    вже без прив&apos;язки до неї.
                  </Note>
                  <div className="flex gap-2">
                    <Button tone="outline" small onClick={() => setConfirmClose(false)} className="flex-1">
                      Зачекати
                    </Button>
                    <Button tone="brand" small disabled={busy} onClick={() => act("close", true)} className="flex-1">
                      Все одно закрити
                    </Button>
                  </div>
                </>
              ) : (
                <Button tone="outline" disabled={busy} onClick={() => act("close")} className="w-full">
                  <LogOut size={18} />
                  {busy ? "Хвилинку…" : "Закрити зміну"}
                </Button>
              )}
            </>
          ) : (
            <>
              <Body>
                Відкрийте зміну, коли прийшли на склад. Накладні приймаються й без неї — просто в
                звіті вони лишаться без годин.
              </Body>
              <Button tone="brand" disabled={busy} onClick={() => act("open")} className="w-full">
                <LogIn size={18} />
                {busy ? "Визначаю місце…" : "Відкрити зміну"}
              </Button>
            </>
          )}

          {!!error && <Note tone="bad">{error}</Note>}
        </Card>

        <div className="grid grid-cols-2 gap-2.5">
          <StatCard
            label="Накладних сьогодні"
            value={isLoading ? "…" : (today?.total ?? 0)}
            hint={
              today && today.failed > 0
                ? `${today.failed} не прочиталося`
                : today && today.pending > 0
                  ? `${today.pending} ще читаються`
                  : "усі прочитані"
            }
            href="/warehouse/invoices"
          />
          <StatCard
            label="Сума за день"
            value={money.format(today?.totalAmount ?? 0)}
            unit="₴"
            hint={`${today?.itemsCount ?? 0} позицій`}
          />
        </div>

        {!!data?.summary && (
          <Card className="flex flex-col gap-2">
            <CardHead title="За цю зміну" />
            <TileRow>
              <Tile label="Накладних" value={String(data.summary.reportsCount)} />
              <Tile label="Прочитано" value={String(data.summary.doneCount)} />
              <Tile label="Сума" value={money.format(data.summary.totalAmount)} unit="₴" />
            </TileRow>
          </Card>
        )}

        <Note>
          Розпізнане потрапляє в офіс як звіт і НЕ змінює залишки й документи в 1С — це матеріал для
          людини, а не проведення.
        </Note>
      </Page>
    </>
  );
}
