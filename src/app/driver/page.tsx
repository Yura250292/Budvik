"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ChevronRight, ListChecks, PackageOpen, Check } from "lucide-react";
import { formatPrice, formatDayDate } from "@/lib/utils";
import NotificationsBell from "@/components/admin/NotificationsBell";
import { UpgradeBanner } from "@/components/app-install/UpgradeBanner";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Button, Card, Eyebrow, Note, Page, Pill } from "@/components/cabinet/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STOP_STATUS_LABELS: Record<string, string> = {
  PENDING: "Очікує", LOADED: "Завантажено", DELIVERED: "Доставлено", FAILED: "Не доставлено",
};
/** Колір статусу — стан, а не бренд: зелене прийнято, синє в дорозі, червоне ні. */
const STOP_STATUS_CLASS: Record<string, string> = {
  PENDING: "text-cab-t2", LOADED: "text-info", DELIVERED: "text-ok-fg", FAILED: "text-bad-fg",
};

/** Текст помилки з відповіді сервера — або код, якщо тіла немає. */
async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Сервер відповів ${res.status}`;
}

export default function DriverPage() {
  const { data: session } = useSession();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const role = (session?.user as any)?.role;

  const fetchRoutes = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/erp/delivery-routes");
    const data = await res.json();
    setRoutes(Array.isArray(data) ? data : []);
    setLoading(false);
    // Активний маршрут розкриваємо самі: заради нього водій і зайшов.
    const active = (Array.isArray(data) ? data : []).find(
      (r: any) => r.status === "IN_PROGRESS" || r.status === "ASSIGNED"
    );
    if (active) setExpandedRoute(active.id);
  }, []);

  useEffect(() => {
    if (["ADMIN", "MANAGER", "DRIVER"].includes(role)) fetchRoutes();
  }, [role, fetchRoutes]);

  const handleDeliverStop = async (stopId: string, salesDocId: string) => {
    setActionLoading(stopId);
    setActionError(null);
    try {
      /**
       * Перевіряємо res.ok обидва рази.
       *
       * fetch кидає виняток лише на обриві мережі: відмова сервера (403, 500)
       * приходить звичайною відповіддю. Без цієї перевірки невдале відвантаження
       * мовчки рахувалося б успішним — сторінка перемальовувалась би, точка
       * лишалася невідміченою, і водій дізнався б про це аж від офісу.
       */
      const stopRes = await fetch(`/api/erp/delivery-routes/stop/${stopId}/deliver`, { method: "POST" });
      if (!stopRes.ok) throw new Error(await errorText(stopRes));

      const docRes = await fetch(`/api/erp/sales/${salesDocId}/deliver`, { method: "POST" });
      if (!docRes.ok) throw new Error(await errorText(docRes));

      await fetchRoutes();
    } catch (e) {
      // Замість alert(«Помилка») — текст на місці, який каже, що саме сталося.
      setActionError(e instanceof Error ? e.message : "Не вдалося відмітити доставку");
    } finally {
      setActionLoading(null);
    }
  };

  // Перевірку ролі робить DriverGate у layout секції — з урахуванням
  // стану "loading". Тут вона стояла без нього, і поки сесія їхала,
  // сторінка встигала показати «Доступ заборонено» самому водієві.

  const activeRoutes = routes.filter((r) => r.status === "ASSIGNED" || r.status === "IN_PROGRESS");
  const completedRoutes = routes.filter((r) => r.status === "COMPLETED");

  return (
    <>
      {/*
        Шапка чорна, а не зелена, як була. Зелений тут нічого не означав —
        просто «розділ водія», — а на екрані, де зелене вже значить
        «доставлено», другий зелений збиває.

        Дзвіночок лишається: без нього про переданий маршрут можна дізнатися,
        лише самому відкривши планшет.
      */}
      <CabinetHeader
        title="Мої маршрути"
        subtitle={`Водій · ${activeRoutes.length > 0 ? `${activeRoutes.length} активний` : "немає активних"}`}
        right={
          <div className="[&_button]:text-white/80 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
            <NotificationsBell />
          </div>
        }
      />

      <Page>
        {/* Перше, що бачить водій, поки він ще на старому трекері. */}
        <UpgradeBanner />

        {!!actionError && (
          <Card tone="bad">
            <p className="text-sm font-semibold text-bad-fg">{actionError}</p>
            <Note>Доставку не відмічено. Спробуйте ще раз або скажіть в офіс.</Note>
          </Card>
        )}

        {/* Головна дія дня — велика й перша. Список маршрутів нижче
            довідковий, а «Мій день» це те, з чим водій працює весь день:
            він показує точки, приймає відмітки і рахує касу. */}
        <Link
          href="/driver/tablet"
          className="flex items-center gap-3 rounded-2xl px-4 py-3.5 text-white active:opacity-90"
          style={{ background: "linear-gradient(135deg, #0A0A0A, #1F2937)" }}
        >
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            <ListChecks size={24} color="#FFD600" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-bold">Мій день</span>
            <span className="block text-xs text-white/60">Точки маршруту, відмітки візитів і каса</span>
          </span>
          <ChevronRight size={20} className="shrink-0 text-white/60" />
        </Link>

        <Eyebrow>Маршрути доставки</Eyebrow>

        {loading ? (
          <Card>
            <Body>Завантаження…</Body>
          </Card>
        ) : routes.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <PackageOpen size={32} className="text-cab-t3" />
              <p className="text-[15px] font-semibold text-bk">Маршрутів поки немає</p>
              <Note>Маршрут складає логіст в адмінці — він з’явиться тут сам.</Note>
            </div>
          </Card>
        ) : (
          <>
            {activeRoutes.map((route) => {
              const stops = route.stops ?? [];
              const done = stops.filter((s: any) => s.status === "DELIVERED").length;
              const open = expandedRoute === route.id;

              return (
                <div key={route.id} className="overflow-hidden rounded-2xl border border-cab-line bg-white">
                  <button
                    type="button"
                    onClick={() => setExpandedRoute(open ? null : route.id)}
                    className="w-full px-3.5 py-3 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-base font-bold text-bk">{route.number}</span>
                        <Pill tone="ok">Активний</Pill>
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-bk">
                        {formatDayDate(route.date)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[13px] text-cab-t2">
                        {route._count?.stops || stops.length} зупинок
                        {route.vehicleInfo ? ` · ${route.vehicleInfo}` : ""}
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold text-bk">
                        {done}/{stops.length} доставлено
                      </span>
                    </div>
                  </button>

                  {open &&
                    stops.map((stop: any, idx: number) => {
                      const delivered = stop.status === "DELIVERED";
                      return (
                        <div
                          key={stop.id}
                          className={`border-t border-[#F1F1EF] px-3.5 py-2.5 ${delivered ? "bg-ok-bg" : "bg-white"}`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                                delivered ? "bg-[#DCFCE7] text-ok" : "bg-info-bg text-info"
                              }`}
                            >
                              {delivered ? <Check size={16} /> : idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[15px] font-semibold text-bk">
                                {stop.counterparty?.name || "—"}
                              </p>
                              {!!stop.address && (
                                <p className="truncate text-xs text-cab-t3">{stop.address}</p>
                              )}
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-cab-t2">
                                  {stop.salesDocument?.number}
                                  {stop.salesDocument?.totalAmount != null
                                    ? ` · ${formatPrice(stop.salesDocument.totalAmount)}`
                                    : ""}
                                </span>
                                <span className={`font-semibold ${STOP_STATUS_CLASS[stop.status] ?? "text-cab-t2"}`}>
                                  {STOP_STATUS_LABELS[stop.status]}
                                </span>
                              </div>
                            </div>
                          </div>

                          {!delivered && (
                            <Button
                              tone="ok"
                              small
                              className="mt-2 w-full"
                              disabled={actionLoading === stop.id}
                              onClick={() => handleDeliverStop(stop.id, stop.salesDocument?.id)}
                            >
                              {actionLoading === stop.id ? "Відмічаю…" : "Доставлено"}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                </div>
              );
            })}

            {completedRoutes.length > 0 && (
              <>
                <Eyebrow>Завершені</Eyebrow>
                {completedRoutes.map((route) => (
                  <Card key={route.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[15px] font-semibold text-bk">{route.number}</span>
                    <span className="shrink-0 whitespace-nowrap text-[13px] text-cab-t2">
                      {formatDayDate(route.date)} · {route.stops?.length || 0} зупинок
                    </span>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </Page>
    </>
  );
}
