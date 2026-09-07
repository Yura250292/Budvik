"use client";

/**
 * Акаунт складовщика: хто він, підсумок за сьогодні, вихід.
 *
 * Вихід тут, а не в шапці, і це важливо саме в застосунку: він мусить пройти
 * через натив (`window.BudvikApp.logout()`), бо окрім кукі кабінету є ще
 * токен пристрою. Через signOut зникла б лише кукі, а планшет лишався б
 * залогіненим на рівні застосунку.
 */

import useSWR from "swr";
import { signOut } from "next-auth/react";
import { RefreshCw } from "lucide-react";
import { useProfile } from "@/lib/useProfile";
import { useAppUpdate, useIsNativeApp } from "@/lib/useIsNativeApp";
import { StaffBuildCard } from "@/components/app-install/StaffBuildCard";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Button, Card, CardTitle, Note, Page, Tile, TileRow } from "@/components/cabinet/ui";

type ShiftResponse = {
  shift: { openedAt: string; openAddress: string | null } | null;
  today: { total: number; done: number; failed: number; totalAmount: number; itemsCount: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

export default function WarehouseProfilePage() {
  // useProfile, а не useSession: у JWT лежить зліпок на момент входу, і нове
  // ім'я там протухає до наступного логіна.
  const user = useProfile();
  const isApp = useIsNativeApp();
  const update = useAppUpdate();
  const { data } = useSWR<ShiftResponse>("/api/warehouse/shift", fetcher);

  const today = data?.today;

  return (
    <>
      <CabinetHeader title={user?.name ?? "Складовщик"} subtitle="Склад" backTo="/warehouse" />

      <Page>
        <Card className="flex flex-col gap-2">
          <CardTitle>Сьогодні</CardTitle>
          <TileRow>
            <Tile label="Накладних" value={String(today?.total ?? 0)} />
            <Tile label="Прочитано" value={String(today?.done ?? 0)} tone={today?.failed ? "bad" : undefined} />
            <Tile label="Сума" value={money.format(today?.totalAmount ?? 0)} unit="₴" />
          </TileRow>
          {!!today?.failed && (
            <Note tone="warn">
              {today.failed} накладних не прочиталися. Відкрийте «Накладні» й натисніть «Спробувати
              ще раз» — фото вже на сервері, перезнімати не треба.
            </Note>
          )}
        </Card>

        <Card className="flex flex-col gap-2">
          <CardTitle>Як це працює</CardTitle>
          {[
            "Прийшли на склад — відкрийте зміну. Вона записує час і місце, більше нічого.",
            "Сформували накладну — сфотографуйте. AI прочитає номер, контрагента й усі рядки.",
            "Розпізнане потрапляє в офіс як звіт. Залишки й документи в 1С воно НЕ змінює.",
            "Не прочиталося — не перезнімайте: фото вже на сервері, є кнопка «Спробувати ще раз».",
          ].map((t) => (
            <p key={t} className="flex gap-2 text-[13px] leading-relaxed text-cab-t2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {t}
            </p>
          ))}
        </Card>

        <Card className="flex flex-col gap-2">
          <CardTitle>Застосунок</CardTitle>
          <Body>
            {isApp
              ? "Ви працюєте в застосунку — сканер відкриває камеру одразу."
              : "У браузері накладна надсилається файлом. У застосунку камера відкривається одразу, і фото стискається перед відправкою."}
          </Body>

          {isApp && update.available && update.viaBridge && (
            <Button tone="brand" small onClick={update.start} className="mt-1 w-full">
              <RefreshCw size={18} />
              Оновити застосунок
            </Button>
          )}
          {!isApp && <StaffBuildCard />}
        </Card>

        <button
          type="button"
          onClick={() => {
            if (isApp && window.BudvikApp) window.BudvikApp.logout();
            else void signOut({ callbackUrl: "/login" });
          }}
          className="min-h-12 w-full rounded-2xl border border-bad-line bg-white text-[15px] font-semibold text-bad"
        >
          Вийти з акаунту
        </button>

        <Note>{user?.email ? `Ви увійшли як ${user.email}.` : ""}</Note>
      </Page>
    </>
  );
}
