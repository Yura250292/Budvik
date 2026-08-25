"use client";

/**
 * Акаунт водія: хто він у системі, скільки заробив, вихід.
 *
 * Замість кабінету покупця, куди водія кидало раніше: там були «Болти на
 * балансі», «Стати оптовиком» і підпис «Клієнт» — усе, що не має до
 * роботи водія жодного стосунку.
 *
 * Зарплата рахується тим самим API, що бачить керівник
 * (/api/admin/drivers/payroll — він сам скоупить DRIVER на себе), тож
 * розбіжності в цифрах між кабінетом і розрахунковим листком неможливі.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useProfile } from "@/lib/useProfile";
import { useAppUpdate, useIsNativeApp } from "@/lib/useIsNativeApp";

type PayrollRow = {
  driverId: string;
  driverName: string;
  sheetsCount: number;
  totalKm: number;
  sheetsTotal: number;
  bonusesTotal: number;
  total: number;
};

type PayrollResp = {
  period: { from: string; to: string; days: number };
  rows: PayrollRow[];
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

function monthRange() {
  const now = new Date();
  const kyiv = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(now);
  return { from: `${kyiv.slice(0, 7)}-01`, to: kyiv };
}

export default function DriverProfilePage() {
  // useProfile, а не useSession: у JWT лежить зліпок на момент входу, і
  // перейменування чи новий телефон там протухають до наступного логіна.
  const user = useProfile();
  const isApp = useIsNativeApp();
  const update = useAppUpdate();
  const [payroll, setPayroll] = useState<PayrollResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { from, to } = monthRange();
    let alive = true;
    fetch(`/api/admin/drivers/payroll?from=${from}&to=${to}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as PayrollResp;
      })
      .then((j) => alive && setPayroll(j))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не вдалося завантажити"));
    return () => {
      alive = false;
    };
  }, []);

  const mine = payroll?.rows?.[0] ?? null;

  return (
    <div style={{ background: "#F3F4F6", minHeight: "100vh" }}>
      <header
        className="px-4"
        style={{
          background: "#0A0A0A",
          color: "#fff",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 18px)",
          paddingBottom: "18px",
        }}
      >
        <h1 style={{ fontSize: "21px", fontWeight: 700 }}>{user?.name ?? "Водій"}</h1>
        <p style={{ fontSize: "13px", color: "#9CA3AF", marginTop: "2px" }}>
          Водій{user?.email ? ` · ${user.email}` : ""}
        </p>
      </header>

      <div className="space-y-3 px-4 py-4">
        {/* Заробіток за місяць */}
        <section
          className="rounded-2xl px-4 py-4"
          style={{ background: "#fff", border: "1px solid #E5E7EB" }}
        >
          <p style={{ fontSize: "12px", color: "#9CA3AF" }}>Нараховано цього місяця</p>
          {error ? (
            <p style={{ fontSize: "13px", color: "#B91C1C", marginTop: "6px" }}>{error}</p>
          ) : !payroll ? (
            <p style={{ fontSize: "14px", color: "#9CA3AF", marginTop: "6px" }}>Рахуємо…</p>
          ) : mine ? (
            <>
              <p style={{ fontSize: "28px", fontWeight: 700, color: "#0A0A0A", lineHeight: 1.15 }}>
                {money.format(mine.total)} ₴
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                <Stat label="Маршрутних листів" value={String(mine.sheetsCount)} />
                <Stat label="Пробіг" value={`${Math.round(mine.totalKm)} км`} />
                <Stat label="За листами" value={`${money.format(mine.sheetsTotal)} ₴`} />
                {mine.bonusesTotal !== 0 && (
                  <Stat label="Надбавки" value={`${money.format(mine.bonusesTotal)} ₴`} />
                )}
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A", marginTop: "4px" }}>
                Цього місяця нарахувань немає
              </p>
              <p style={{ fontSize: "12.5px", color: "#6B7280", marginTop: "4px", lineHeight: 1.5 }}>
                Зарплата рахується за маршрутними листами з 1С. Якщо листи є, а
                тут порожньо — ваш акаунт ще не звʼязали з водієм у 1С,
                скажіть про це керівнику.
              </p>
            </>
          )}
        </section>

        {/* Як усе працює — коротко, бо планшет новий для всіх */}
        <section
          className="rounded-2xl px-4 py-4"
          style={{ background: "#fff", border: "1px solid #E5E7EB" }}
        >
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#0A0A0A" }}>Як це працює</p>
          <ul style={{ margin: "8px 0 0", padding: "0 0 0 18px", listStyle: "disc" }}>
            {[
              isApp
                ? "Застосунок пише ваш маршрут у фоні — навіть коли ви поїхали за Google Maps."
                : "У браузері трек пишеться, лише поки відкритий «Мій день». Поставте застосунок — він пише у фоні.",
              "Відмітка «Приїхав» зберігає, де ви були і скільки грошей забрали.",
              "Наприкінці дня натисніть «Здаю касу» — офіс підтвердить прийом грошей.",
              "Якщо зник звʼязок, точки чекають у пристрої й доїжджають самі.",
            ].map((t) => (
              <li key={t} style={{ fontSize: "12.5px", color: "#4B5563", lineHeight: 1.6 }}>
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* Застосунок: у браузері кличемо поставити, всередині —
            пропонуємо оновитись, коли на сервері свіжіша збірка. */}
        <section
          className="rounded-2xl px-4 py-4"
          style={{ background: "#fff", border: "1px solid #E5E7EB" }}
        >
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#0A0A0A" }}>Застосунок</p>
          <p style={{ fontSize: "12.5px", color: "#6B7280", marginTop: "4px", lineHeight: 1.5 }}>
            {isApp
              ? "Ви працюєте в застосунку — трек пишеться у фоні."
              : "Android-застосунок пише маршрут у фоні, поки ви в системі."}
          </p>

          {isApp && update.available ? (
            update.viaBridge ? (
              <button
                type="button"
                onClick={update.start}
                className="w-full cursor-pointer rounded-xl transition-colors duration-200"
                style={{
                  marginTop: "12px",
                  minHeight: "46px",
                  background: "#FFD600",
                  border: "none",
                  color: "#0A0A0A",
                  fontSize: "14.5px",
                  fontWeight: 700,
                }}
              >
                Оновити застосунок
              </button>
            ) : (
              <Link
                href="/driver/app"
                style={{
                  display: "block",
                  marginTop: "12px",
                  padding: "13px",
                  borderRadius: "12px",
                  background: "#FFD600",
                  color: "#0A0A0A",
                  fontSize: "14.5px",
                  fontWeight: 700,
                  textAlign: "center",
                  textDecoration: "none",
                }}
              >
                Доступна нова версія — як оновити
              </Link>
            )
          ) : (
            !isApp && (
              <Link
                href="/driver/app"
                style={{
                  display: "block",
                  marginTop: "12px",
                  padding: "13px",
                  borderRadius: "12px",
                  background: "#FFD600",
                  color: "#0A0A0A",
                  fontSize: "14.5px",
                  fontWeight: 700,
                  textAlign: "center",
                  textDecoration: "none",
                }}
              >
                Встановити застосунок
              </Link>
            )
          )}
        </section>

        <button
          type="button"
          onClick={() => {
            // У застосунку вихід робить натив: зупиняє трек і стирає токен
            // пристрою. Через signOut пропала б лише кукі, а служба писала б
            // маршрут далі — під чужим уже акаунтом.
            if (isApp && window.BudvikApp) window.BudvikApp.logout();
            else void signOut({ callbackUrl: "/login" });
          }}
          className="w-full cursor-pointer rounded-2xl transition-colors duration-200"
          style={{
            minHeight: "48px",
            background: "#fff",
            border: "1px solid #FECACA",
            color: "#DC2626",
            fontSize: "15px",
            fontWeight: 600,
          }}
        >
          Вийти з акаунту
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ fontSize: "11px", color: "#9CA3AF" }}>{label} </span>
      <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#374151" }}>{value}</span>
    </span>
  );
}
