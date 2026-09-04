"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { Card, EmptyState } from "@/components/ui/Card";
import { Page } from "@/components/cabinet/ui";
import { Skeleton, StatCardSkeleton } from "@/components/ui/Skeleton";
import { PeriodPicker, type Period } from "@/components/ui/PeriodPicker";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { useIsNativeApp } from "@/lib/useIsNativeApp";
import { UpgradeBanner } from "@/components/app-install/UpgradeBanner";
import { HeroPlan } from "./analytics/components/HeroPlan";
import { OverdueAlert } from "./analytics/components/OverdueAlert";
import { MetricGrid } from "./analytics/components/MetricGrid";
import AssistantTile from "@/components/sales/assistant/AssistantTile";
import {
  monthLabel,
  useMySummary,
  usePeriodFromUrl,
  withPeriod,
} from "./analytics/components/useSalesAnalytics";

/**
 * Головна кабінету торгового — одразу показники.
 *
 * Раніше тут була плитка-меню з шести пунктів, три з яких дублювали
 * нижні вкладки, а власні числа торгового лежали на крок глибше, в
 * /sales/analytics. Тобто екран, який відкривається першим, не відповідав
 * на єдине питання, з яким торговий заходить: «як у мене справи».
 *
 * Дані — той самий запит, що живить зведену керівника
 * (/api/admin/sales-analytics/summary у режимі scope: "own"). Копія під
 * /api/sales/* дала б друге місце, де ті самі 11 показників можуть
 * розійтися.
 */

function HomeSkeleton() {
  return (
    <>
      <Skeleton className="h-[220px] w-full rounded-[var(--radius-card)]" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    </>
  );
}

/** Дзвіночок і «Вийти» — єдине, що лишилось від старої шапки. */
function HeaderActions() {
  const [notifications, setNotifications] = useState<{ id: string; title: string; body: string; isRead: boolean; createdAt: string; relatedId?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const isApp = useIsNativeApp();
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setNotifications(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  return (
    <>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (unreadCount > 0) markAllRead();
        }}
        aria-label={unreadCount > 0 ? `Сповіщення, ${unreadCount} непрочитаних` : "Сповіщення"}
        style={{
          position: "relative",
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "12px",
          padding: "10px",
          color: "white",
        }}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute", top: "-4px", right: "-4px",
              background: "#EF4444", color: "white", borderRadius: "9999px",
              fontSize: "11px", fontWeight: 700, minWidth: "18px", height: "18px",
              display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      <button
        // У застосунку виходить натив: signOut стер би кукі, але лишив
        // токен пристрою, і трек писався б далі.
        onClick={() => (isApp ? window.BudvikApp?.logout() : signOut({ callbackUrl: "/" }))}
        title="Вийти"
        aria-label="Вийти з акаунту"
        style={{
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: "12px",
          padding: "10px",
          color: "#F87171",
        }}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% - 4px)", right: "16px", zIndex: 50,
            background: "white", borderRadius: "16px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            width: "min(320px, calc(100vw - 32px))", maxHeight: "400px", overflowY: "auto",
          }}
        >
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #F0F0F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: "14px", color: "#0A0A0A" }}>Сповіщення</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{ fontSize: "12px", color: "#6B7280" }}>
                Прочитати всі
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "#9CA3AF", fontSize: "13px" }}>
              Немає сповіщень
            </div>
          ) : (
            notifications.map((n) => {
              const body = (
                <>
                  <p style={{ fontWeight: 600, fontSize: "13px", color: "#0A0A0A" }}>{n.title}</p>
                  <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "2px" }}>{n.body}</p>
                  <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "4px" }}>
                    {new Date(n.createdAt).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </>
              );
              return (
                <div
                  key={n.id}
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid #F7F7F7",
                    background: n.isRead ? "white" : "#FFF9E6",
                  }}
                >
                  {n.relatedId ? (
                    <Link href={`/sales/orders/${n.relatedId}`} onClick={() => setOpen(false)}>
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}

function Home() {
  const router = useRouter();
  const { data: session } = useSession();
  const period = usePeriodFromUrl();
  const { data, row, loading, error, reload } = useMySummary(period);

  const name = (session?.user as { name?: string } | undefined)?.name ?? "Торговий";

  // Період у query, а не в стані: перехід у дрілл і назад має повертати
  // той самий діапазон. replace, не push — інакше кожен клік по пресету
  // додавав би запис в історію і «Назад» гортало б власні кліки.
  const onPeriodChange = (p: Period) => {
    router.replace(`?from=${p.from}&to=${p.to}`, { scroll: false });
  };

  return (
    <>
      <SalesHeader title={name} subtitle="Мої показники" right={<HeaderActions />} />

      <Page>
        {/* Перше, що бачить людина в кабінеті, поки вона ще на старому трекері. */}
        <UpgradeBanner />

        <div className="-mx-4 overflow-x-auto px-4 pb-0.5 scrollbar-hide">
          <div className="w-max">
            <PeriodPicker value={period} onChange={onPeriodChange} />
          </div>
        </div>

        {/*
          Три різні часові рамки в одному екрані — без цього рядка числа
          виглядають суперечливо: оборот за 10 днів поруч із планом за
          весь місяць і боргом «станом на зараз» читається як помилка.
        */}
        <p className="-mt-1 text-[11px] leading-relaxed text-cab-t3">
          Оборот, паливо і зібране — за обраний період. План —
          {data?.month ? ` за весь ${monthLabel(data.month)}` : " за календарний місяць"}. Дебіторка —
          борг станом на зараз, від періоду не залежить.
        </p>

        {error && <ErrorBox message={error} onRetry={reload} />}

        {loading && !data && <HomeSkeleton />}

        {data && !row && (
          <Card>
            <EmptyState
              title="За цей період даних немає"
              hint="Зведена будується по користувачах із роллю «Торговий». Якщо ви бачите це повідомлення, зверніться до керівника — можливо, обліковий запис ще не позначено як торгового."
            />
          </Card>
        )}

        {/* Без метрик помічник потрібен не менше: клієнти, борги й склад
            він читає незалежно від того, чи зібралась зведена. */}
        {data && !row && <AssistantTile />}

        {data && row && (
          <>
            <HeroPlan
              plan={row.plan}
              month={data.month}
              planHref={row.plan.target > 0 ? withPeriod("/sales/analytics/plan", period) : null}
            />

            {/* Прострочка — одразу під планом: це не показник, а борг, який
                щодня дорожчає. Наприкінці екрана її просто не гортали. */}
            <OverdueAlert row={row} href={withPeriod("/sales/analytics/money", period)} />

            <AssistantTile />

            <MetricGrid row={row} moneyHref={withPeriod("/sales/analytics/money", period)} />

            <p className="px-1 text-[11px] leading-relaxed text-cab-t3">
              «Чистий результат» — прибуток по ваших продажах за період мінус пальне. «Заробіток»
              рахується зі зібраних коштів, а не з обороту: продаж без оплати не приносить нічого.
            </p>
          </>
        )}
      </Page>
    </>
  );
}

export default function SalesHomePage() {
  // Suspense обов'язковий: період читається з useSearchParams.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-4 pt-4">
          <HomeSkeleton />
        </div>
      }
    >
      <Home />
    </Suspense>
  );
}
