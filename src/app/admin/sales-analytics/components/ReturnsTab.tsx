"use client";

/**
 * Повернення товару від покупців.
 *
 * Відповідає на чотири питання в порядку, у якому їх ставлять: скільки
 * всього, у кого саме, що саме і які документи. Останнє — список, решта —
 * згортки: у 2,5 тисячах документів закономірність видно лише зведеною.
 *
 * Суми тут ДОДАТНІ, хоча в базі лежать від'ємні: мінус потрібен, щоб
 * SUM() віднімав повернення з обороту сам, а в таблиці він лише заважає.
 * Розворот робить SQL у facts.ts.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { Badge } from "@/components/ui/Badge";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

type ReturnsResponse = {
  period: { from: string; to: string; days: number };
  totals: { amount: number; docs: number; gross: number; ratio: number; truncated: boolean };
  docs: Array<{
    id: string;
    number: string;
    date: string;
    clientId: string | null;
    clientName: string | null;
    repId: string | null;
    repName: string | null;
    amount: number;
    items: number;
  }>;
  byClient: Array<{ clientId: string | null; clientName: string | null; amount: number; docs: number }>;
  byProduct: Array<{
    productId: string;
    name: string;
    brandName: string | null;
    qty: number;
    amount: number;
    docs: number;
  }>;
  byRep: Array<{ repId: string; name: string; amount: number; revenue: number; ratio: number }>;
};

/**
 * Межа, за якою частка повернень перестає бути фоновим шумом.
 *
 * Три відсотки — не норматив із 1С, а орієнтир: за 2026 рік у команді
 * найгірший показник 4,7%, типовий — півтора. Тому 3% ділить «як у всіх»
 * і «варто спитати».
 */
const RATIO_WATCH = 3;

function ratioStatus(ratio: number) {
  return ratio >= RATIO_WATCH ? "warn" : "neutral";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function ReturnsTab({ period, rep }: { period: Period; rep: string | null }) {
  const router = useRouter();
  const repParam = rep ? `&rep=${rep}` : "";
  const { data, loading, error, reload } = useApi<ReturnsResponse>(
    `/api/admin/sales-analytics/returns?from=${period.from}&to=${period.to}${repParam}`
  );

  const totals = data?.totals;

  // Найбільший клієнт у частках від усієї суми повернень — саме він
  // відповідає на питання «це системно чи це один випадок».
  const topShare = useMemo(() => {
    const top = data?.byClient?.[0];
    if (!top || !totals || totals.amount <= 0) return 0;
    return (top.amount / totals.amount) * 100;
  }, [data, totals]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading) return <TableSkeleton rows={8} />;
  if (!data) return null;

  if (totals && totals.docs === 0) {
    return (
      <Card>
        <EmptyState
          title="Повернень немає"
          hint={`За період ${data.period.from} — ${data.period.to} жодного повернення від покупців не оформлено.`}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Сума повернень"
          value={money(totals?.amount ?? 0)}
          unit="₴"
          tone="bad"
          hint={`${num(totals?.docs ?? 0)} документів`}
        />
        <StatCard
          label="Частка від обороту"
          value={num(totals?.ratio ?? 0, 1)}
          unit="%"
          tone={ratioStatus(totals?.ratio ?? 0)}
          hint={`з ${money(totals?.gross ?? 0)} ₴ до вирахування`}
        />
        <StatCard
          label="Клієнтів із поверненнями"
          value={num(data.byClient.length)}
          hint={topShare > 0 ? `найбільший — ${num(topShare, 0)}% усієї суми` : undefined}
        />
        <StatCard
          label="Позицій у поверненнях"
          value={num(data.byProduct.length)}
          hint="різних товарів"
        />
      </div>

      {data.byRep.length > 1 && (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="За торговими"
              hint="Частка рахується від обороту до вирахування повернень. Клік по рядку відкриває профіль."
            />
          </div>
          <TableScroll minWidth={560}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Торговий</th>
                  <th className="px-4 py-2.5 text-right">Повернено, грн</th>
                  <th className="px-4 py-2.5 text-right">Оборот нетто, грн</th>
                  <th className="px-4 py-2.5 text-right">Частка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {data.byRep.map((r) => (
                  <tr
                    key={r.repId}
                    onClick={() =>
                      router.push(
                        `/admin/sales-analytics/${r.repId}?from=${period.from}&to=${period.to}`
                      )
                    }
                    className="cursor-pointer transition-colors hover:bg-g50"
                  >
                    <td className="px-4 py-3 font-medium text-bk">{r.name}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-600">
                      {money(r.amount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">
                      {money(r.revenue)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge status={ratioStatus(r.ratio)}>{num(r.ratio, 1)}%</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader title="Хто повертає" hint="Клієнти за сумою повернень" />
          </div>
          <TableScroll minWidth={420}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Клієнт</th>
                  <th className="px-4 py-2.5 text-right">Сума, грн</th>
                  <th className="px-4 py-2.5 text-right">Док.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {data.byClient.map((c) => (
                  <tr key={c.clientId ?? c.clientName ?? "—"}>
                    <td className="px-4 py-3 text-bk">{c.clientName ?? "— без клієнта —"}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-red-600">
                      {money(c.amount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(c.docs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>

        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader title="Що повертають" hint="Товари за сумою повернень" />
          </div>
          <TableScroll minWidth={460}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Товар</th>
                  <th className="px-4 py-2.5 text-right">К-сть</th>
                  <th className="px-4 py-2.5 text-right">Сума, грн</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {data.byProduct.map((p) => (
                  <tr key={p.productId}>
                    <td className="px-4 py-3">
                      <span className="text-bk">{p.name}</span>
                      {p.brandName && (
                        <span className="block text-[11px] text-g400">{p.brandName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(p.qty)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-red-600">
                      {money(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Документи повернення"
            hint={
              totals?.truncated
                ? `Показано перші ${num(data.docs.length)} документів за датою. Звузьте період, щоб побачити решту.`
                : "Найновіші зверху"
            }
          />
        </div>
        <TableScroll minWidth={720}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Номер</th>
                <th className="px-4 py-2.5">Дата</th>
                <th className="px-4 py-2.5">Клієнт</th>
                <th className="px-4 py-2.5">Торговий</th>
                <th className="px-4 py-2.5 text-right">Позицій</th>
                <th className="px-4 py-2.5 text-right">Сума, грн</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {data.docs.map((d) => (
                <tr key={d.id} className="transition-colors hover:bg-g50">
                  <td className="px-4 py-3 font-medium tabular-nums text-bk">{d.number}</td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-g600">
                    {formatDate(d.date)}
                  </td>
                  <td className="px-4 py-3 text-g600">{d.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-g600">
                    {d.repName ?? <span className="text-g400">не зіставлено</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">{num(d.items)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-600">
                    {money(d.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  );
}
