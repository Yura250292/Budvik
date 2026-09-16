"use client";

/**
 * Кому написати або подзвонити сьогодні.
 *
 * Два списки, бо це два різні питання. Перший — той самий, що в пуші об
 * 11:00: борг, ризик утрати, кого відновити (rep-actions), тобто «що горить».
 * Другий — ті, хто давно не бере і кому місяць ніхто не писав: не горить,
 * але саме там лежать гроші (152 клієнти без покупок понад 90 днів дали
 * 5,4 млн обороту 2026 року).
 *
 * Кожен рядок веде на картку клієнта до пропозиції, одразу з потрібним видом.
 */

import { Users } from "lucide-react";
import { useApi } from "@/components/ui/useApi";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { ClientStatePill } from "@/components/sales/ClientOfferSection";
import { Card, Eyebrow, ListRow, Note, Page, Pill } from "@/components/cabinet/ui";
import { formatUah } from "@/lib/outreach/templates";
import { OUTREACH_CHANNELS, labelOf } from "@/lib/outreach/types";
import type { OutreachClientList } from "@/lib/outreach/client-facts";

type TodayItem = {
  counterpartyId: string;
  name: string;
  action: "COLLECT_DEBT" | "CHURN_RISK" | "REACTIVATE" | "DEVELOP" | "OFFER_BONUS";
  actionLabel: string;
  outreachKind: string;
  why: string;
  debt: number;
  overdue: number;
  daysSinceLast: number;
  phone: string | null;
  phoneE164: string | null;
  lastOutreach: { at: string; channel: string; outcome: string; daysAgo: number } | null;
};

const ACTION_TONE: Record<TodayItem["action"], "bad" | "warn" | "info" | "ok"> = {
  COLLECT_DEBT: "bad",
  CHURN_RISK: "warn",
  REACTIVATE: "warn",
  DEVELOP: "info",
  OFFER_BONUS: "ok",
};

/** Скільки «сплячих» показуємо: більше за день однаково ніхто не напише. */
const QUIET_TOP = 20;

function wroteAgo(daysAgo: number, channel: string): string {
  return `написали ${daysAgo === 0 ? "сьогодні" : `${daysAgo} дн. тому`} · ${labelOf(OUTREACH_CHANNELS, channel)}`;
}

function daysAgoOf(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

const lead = (name: string) => name.trim().charAt(0).toUpperCase();

export default function OutreachScreen() {
  const today = useApi<{ day: string; items: TodayItem[] }>("/api/sales/outreach/today");
  const quiet = useApi<OutreachClientList>("/api/sales/clients?scope=mine&filter=no_outreach");

  const todayItems = today.data?.items ?? [];
  const inToday = new Set(todayItems.map((i) => i.counterpartyId));
  // Сплячі й згасаючі з мобільним: кому немає куди написати, той у цьому
  // списку лише зайвий рядок — йому дзвонять зі списку вище або заїжджають.
  // Хто просив не писати, тут не з'являється — те саме правило, що в
  // тижневому списку воркера.
  const quietItems = (quiet.data?.items ?? [])
    .filter((c) => (c.state === "SLIPPING" || c.state === "DORMANT" || c.state === "LOST") && c.phoneE164)
    .filter((c) => !inToday.has(c.id) && !c.refusesMessages)
    .slice(0, QUIET_TOP);

  return (
    <>
      <SalesHeader title="Кому написати" subtitle="Список на сьогодні" backTo="/sales/clients" sticky />
      <Page>
        <Note>
          Текст пропозиції готує сайт, відправляєте ви зі свого телефона — клієнт бачить повідомлення від вас. Ціни
          в тексті оптові, знижок сайт не обіцяє.
        </Note>

        <Eyebrow>Сьогодні — що горить</Eyebrow>
        {today.error && !today.data ? (
          <Card tone="bad">
            <Note tone="bad">{today.error}</Note>
          </Card>
        ) : today.loading && !today.data ? (
          <Card>
            <Note>Рахую список…</Note>
          </Card>
        ) : todayItems.length === 0 ? (
          <Card>
            <Note>Сьогодні нікого: боргів, ризику втрати й сплячих у вашому портфелі за 30 днів немає.</Note>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {todayItems.map((c) => (
              <ListRow
                key={c.counterpartyId}
                href={`/sales/clients/${c.counterpartyId}#offer-${c.outreachKind}`}
                lead={lead(c.name)}
                title={c.name}
                subtitle={[
                  c.why,
                  c.lastOutreach ? wroteAgo(c.lastOutreach.daysAgo, c.lastOutreach.channel) : null,
                  c.phoneE164 ? null : "мобільного немає",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={
                  c.overdue > 0 ? <span className="tabular-nums text-bad-fg">{formatUah(c.overdue)}</span> : undefined
                }
                badge={
                  <Pill tone={ACTION_TONE[c.action]} dot>
                    {c.actionLabel}
                  </Pill>
                }
              />
            ))}
          </div>
        )}

        <Eyebrow>Сплять, без пропозиції 30 днів</Eyebrow>
        {quiet.error && !quiet.data ? (
          <Card tone="bad">
            <Note tone="bad">{quiet.error}</Note>
          </Card>
        ) : quiet.loading && !quiet.data ? (
          <Card>
            <Note>Завантаження…</Note>
          </Card>
        ) : quietItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Users size={28} className="text-cab-t3" />
            <Note>Усім сплячим із мобільним уже писали протягом місяця.</Note>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {quietItems.map((c) => (
              <ListRow
                key={c.id}
                href={`/sales/clients/${c.id}#offer-WIN_BACK`}
                lead={lead(c.name)}
                title={c.name}
                subtitle={[
                  c.avgIntervalDays >= 1 ? `звичний ритм — раз на ${c.avgIntervalDays} дн.` : null,
                  c.lastOutreach ? wroteAgo(daysAgoOf(c.lastOutreach.at), c.lastOutreach.channel) : "ще не писали",
                  c.overdue > 0 ? `прострочено ${formatUah(c.overdue)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={c.daysSinceLast != null ? <span className="tabular-nums">{c.daysSinceLast} дн.</span> : undefined}
                badge={<ClientStatePill state={c.state} />}
              />
            ))}
          </div>
        )}
      </Page>
    </>
  );
}
