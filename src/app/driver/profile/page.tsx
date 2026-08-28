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
import { signOut } from "next-auth/react";
import { RefreshCw } from "lucide-react";
import { useProfile } from "@/lib/useProfile";
import { useAppUpdate, useIsNativeApp } from "@/lib/useIsNativeApp";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Button, Card, CardTitle, Note, Page } from "@/components/cabinet/ui";

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
    <>
      <CabinetHeader
        title={user?.name ?? "Водій"}
        subtitle="Водій"
        backTo="/driver"
      />

      <Page>
        {/* Заробіток за місяць — перше, заради чого сюди заходять. */}
        <Card className="flex flex-col gap-2">
          <p className="text-xs text-cab-t3">Нараховано цього місяця</p>
          {error ? (
            <p className="text-[13px] text-bad-fg">{error}</p>
          ) : !payroll ? (
            <Body>Рахуємо…</Body>
          ) : mine ? (
            <>
              <p className="text-[28px] font-bold leading-tight text-bk">
                {money.format(mine.total)} ₴
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <Stat label="Маршрутних листів" value={String(mine.sheetsCount)} />
                <Stat label="Пробіг" value={`${Math.round(mine.totalKm)} км`} />
                <Stat label="За листами" value={`${money.format(mine.sheetsTotal)} ₴`} />
                {mine.bonusesTotal !== 0 && (
                  <Stat label="Надбавки" value={`${money.format(mine.bonusesTotal)} ₴`} />
                )}
              </div>
              <Note>
                Ті самі цифри, що бачить керівник у зарплатній відомості: ставка за лист, 25/15 ₴ за
                адресу, 0,5 % від суми мінус борги.
              </Note>
            </>
          ) : (
            <>
              <p className="text-[15px] font-semibold text-bk">Цього місяця нарахувань немає</p>
              <Body>
                Зарплата рахується за маршрутними листами з 1С. Якщо листи є, а тут порожньо — ваш
                акаунт ще не звʼязали з водієм у 1С, скажіть про це керівнику.
              </Body>
            </>
          )}
        </Card>

        {/* Як усе працює — коротко, бо планшет новий для всіх */}
        <Card className="flex flex-col gap-2">
          <CardTitle>Як це працює</CardTitle>
          {[
            isApp
              ? "Застосунок пише ваш маршрут у фоні — навіть коли ви поїхали за Google Maps."
              : "У браузері трек пишеться, лише поки відкритий «Мій день». Поставте застосунок — він пише у фоні.",
            "Відмітка «Приїхав» зберігає, де ви були і скільки грошей забрали.",
            "Наприкінці дня натисніть «Здаю касу» — офіс підтвердить прийом грошей.",
            "Якщо зник звʼязок, точки чекають у пристрої й доїжджають самі.",
          ].map((t) => (
            <p key={t} className="flex gap-2 text-[13px] leading-relaxed text-[#4B5563]">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {t}
            </p>
          ))}
        </Card>

        {/* Застосунок: у браузері кличемо поставити, всередині —
            пропонуємо оновитись, коли на сервері свіжіша збірка. */}
        <Card className="flex flex-col gap-2">
          <CardTitle>Застосунок</CardTitle>
          <Body>
            {isApp
              ? "Ви працюєте в застосунку — трек пишеться у фоні."
              : "Android-застосунок пише маршрут у фоні, поки ви в системі."}
          </Body>

          {isApp && update.available ? (
            update.viaBridge ? (
              <Button tone="brand" small onClick={update.start} className="mt-1 w-full">
                <RefreshCw size={18} />
                Оновити застосунок
              </Button>
            ) : (
              <Button tone="brand" small href="/driver/app" className="mt-1 w-full">
                Доступна нова версія — як оновити
              </Button>
            )
          ) : (
            !isApp && (
              <Button tone="brand" small href="/driver/app" className="mt-1 w-full">
                Встановити застосунок
              </Button>
            )
          )}
        </Card>

        <button
          type="button"
          onClick={() => {
            // У застосунку вихід робить натив: зупиняє трек і стирає токен
            // пристрою. Через signOut пропала б лише кукі, а служба писала б
            // маршрут далі — під чужим уже акаунтом.
            if (isApp && window.BudvikApp) window.BudvikApp.logout();
            else void signOut({ callbackUrl: "/login" });
          }}
          className="min-h-12 w-full rounded-2xl border border-bad-line bg-white text-[15px] font-semibold text-bad"
        >
          Вийти з акаунту
        </button>

        <Note>
          {user?.email ? `Ви увійшли як ${user.email}. ` : ""}У застосунку вихід зупиняє трек і
          стирає токен пристрою — інакше маршрут писався б під чужим акаунтом.
        </Note>
      </Page>
    </>
  );
}

/** Підпис над числом: у ряд їх стає чотири, і пара «слово число» злипається. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[11px] text-cab-t3">{label}</span>
      <span className="text-[13px] font-semibold text-[#374151]">{value}</span>
    </span>
  );
}
