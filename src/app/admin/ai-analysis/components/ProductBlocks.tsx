"use client";

/**
 * Секція «Товари»: рентабельність брендів, що просувати, що лежить мертвим.
 *
 * Як і в блоках торгових, назви й суми беруться з фактів за id — модель дає
 * лише порядок і коментар. Рядок, id якого не знайшовся у фактах, не
 * малюється взагалі.
 */

import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TableScroll } from "@/components/ui/TableScroll";
import { money, num } from "@/components/ui/Stat";
import { InsightSections } from "@/app/admin/sales-analytics/components/InsightCard";
import type { Insight } from "@/lib/ai/insights";

type Payload = {
  insights: Insight[];
  promote: Array<{ id: string; kind: "brand" | "product"; why: string }>;
  illiquid: Array<{ id: string; action: string; discountPct?: number; comment: string }>;
};

type BrandRow = {
  id: string;
  бренд: string;
  оборот: number | null;
  частка_обороту_відсотків: number | null;
  вал: number | null;
  рентабельність_відсотків: number | null;
  покриття_собівартістю_відсотків: number | null;
};

type StaleItem = {
  id: string;
  товар: string;
  бренд: string;
  залишок: number | null;
  сума: number | null;
  днів_без_продажу: number | null;
  повернемо_зі_знижкою?: Record<string, number | null>;
};

type TopProduct = {
  id: string;
  товар: string;
  бренд: string | null;
  оборот: number | null;
  рентабельність_відсотків: number | null;
};

type Facts = {
  рентабельність_брендів?: BrandRow[];
  топ_товарів?: TopProduct[];
  склад_станом_на_зараз?: {
    вартість_запасу: number | null;
    з_них_за_собівартістю: number | null;
    з_них_за_ціною_продажу: number | null;
    без_руху_позицій: number;
    без_руху_на_суму: number | null;
    частка_мертвих_грошей_відсотків: number | null;
    найгірші_позиції?: StaleItem[];
    найгірші_бренди?: Array<{ id: string; бренд: string; без_руху_на_суму: number | null }>;
    акційний_потенціал?: {
      заморожено_всього: number | null;
      повернемо_зі_знижкою_10: number | null;
      повернемо_зі_знижкою_25: number | null;
      повернемо_зі_знижкою_40: number | null;
    };
  };
  дефіцит_станом_на_зараз?:
    | { позицій_до_замовлення: number; пекучих_продається_і_скінчилось: number; сума_закупівлі: number | null }
    | string;
};

const ACTION_META: Record<string, { label: string; status: "bad" | "warn" | "info" | "neutral" }> = {
  DISCOUNT: { label: "Розпродати зі знижкою", status: "warn" },
  RETURN_TO_SUPPLIER: { label: "Повернути постачальнику", status: "bad" },
  STOP_REORDER: { label: "Не дозамовляти", status: "info" },
  WATCH: { label: "Спостерігати", status: "neutral" },
};

export function ProductBlocks({ payload, facts }: { payload: unknown; facts: unknown }) {
  const p = (payload ?? {}) as Payload;
  const f = (facts ?? {}) as Facts;
  const stock = f.склад_станом_на_зараз;

  const promo = stock?.акційний_потенціал;
  const brandById = new Map((f.рентабельність_брендів ?? []).map((b) => [b.id, b]));
  const productById = new Map((f.топ_товарів ?? []).map((t) => [t.id, t]));
  const staleById = new Map((stock?.найгірші_позиції ?? []).map((i) => [i.id, i]));
  const staleBrandById = new Map((stock?.найгірші_бренди ?? []).map((b) => [b.id, b]));

  return (
    <div className="flex flex-col gap-3">
      {stock && (
        <Card>
          <CardHeader
            title="Склад станом на зараз"
            hint="Оцінка змішана: собівартість там, де відома, інакше ціна продажу"
          />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Вартість запасу" value={`${money(stock.вартість_запасу ?? 0)} ₴`} />
            <Metric
              label="Без руху"
              value={`${money(stock.без_руху_на_суму ?? 0)} ₴`}
              hint={`${num(stock.без_руху_позицій)} позицій · ${num(
                stock.частка_мертвих_грошей_відсотків ?? 0,
                1
              )}% запасу`}
              alarm
            />
            <Metric
              label="За собівартістю"
              value={`${money(stock.з_них_за_собівартістю ?? 0)} ₴`}
              hint="реальна оцінка"
            />
            <Metric
              label="За ціною продажу"
              value={`${money(stock.з_них_за_ціною_продажу ?? 0)} ₴`}
              hint="завищено на маржу"
            />
          </dl>

          {typeof f.дефіцит_станом_на_зараз === "object" && (
            <p className="mt-3 text-xs text-g500">
              Дефіцит: {num(f.дефіцит_станом_на_зараз.позицій_до_замовлення)} позицій до замовлення,
              з них {num(f.дефіцит_станом_на_зараз.пекучих_продається_і_скінчилось)} пекучих
              (продається і скінчилось) на {money(f.дефіцит_станом_на_зараз.сума_закупівлі ?? 0)} ₴.
            </p>
          )}
        </Card>
      )}

      {p.insights?.length > 0 && (
        <Card>
          <CardHeader title="Висновки по товарах" />
          <InsightSections insights={p.insights} />
        </Card>
      )}

      {f.рентабельність_брендів?.length ? (
        <Card>
          <CardHeader
            title="Рентабельність брендів"
            hint="Оборот і вал за обраний період; вал рахується з рядків, тому знижка з шапки в нього не входить"
          />
          <TableScroll minWidth={560}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-g200 text-left text-xs text-g500">
                  <th className="pb-2 font-medium">Бренд</th>
                  <th className="pb-2 text-right font-medium">Оборот</th>
                  <th className="pb-2 text-right font-medium">Частка</th>
                  <th className="pb-2 text-right font-medium">Вал</th>
                  <th className="pb-2 text-right font-medium">Маржа</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {f.рентабельність_брендів.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2 pr-2 font-medium text-bk">{b.бренд}</td>
                    <td className="py-2 text-right text-g700">{money(b.оборот ?? 0)} ₴</td>
                    <td className="py-2 text-right text-g500">
                      {num(b.частка_обороту_відсотків ?? 0, 1)}%
                    </td>
                    <td className="py-2 text-right text-g700">{money(b.вал ?? 0)} ₴</td>
                    <td className="py-2 text-right">
                      {b.рентабельність_відсотків != null ? (
                        <Badge
                          status={
                            b.рентабельність_відсотків >= 15
                              ? "good"
                              : b.рентабельність_відсотків >= 8
                                ? "warn"
                                : "bad"
                          }
                        >
                          {num(b.рентабельність_відсотків, 1)}%
                        </Badge>
                      ) : (
                        <span className="text-g400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Що просувати" hint="Вибір моделі з ваших брендів і товарів" />
        {p.promote?.length ? (
          <ul className="flex flex-col gap-2">
            {p.promote.map((item) => {
              const brand = brandById.get(item.id);
              const product = productById.get(item.id);
              const name = brand?.бренд ?? product?.товар;
              if (!name) return null;
              const margin = brand?.рентабельність_відсотків ?? product?.рентабельність_відсотків;
              const amount = brand?.оборот ?? product?.оборот;

              return (
                <li
                  key={item.id}
                  className="rounded-[var(--radius-card)] border border-g200 p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-bk">{name}</span>
                    <span className="flex items-center gap-1.5 text-xs text-g500">
                      <Badge status="neutral">{item.kind === "brand" ? "бренд" : "товар"}</Badge>
                      {amount != null && <span>{money(amount)} ₴</span>}
                      {margin != null && <span>маржа {num(margin, 1)}%</span>}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-g700">{item.why}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Модель не виділила товарів для просування" />
        )}
      </Card>

      {promo && (
        <Card>
          <CardHeader
            title="Акційний потенціал"
            hint="Скільки живих грошей лежить мертвим вантажем і скільки повернеться при розпродажі"
          />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="Заморожено"
              value={`${money(promo.заморожено_всього ?? 0)} ₴`}
              hint="без руху 90+ днів"
              alarm
            />
            <Metric label="Зі знижкою 10%" value={`${money(promo.повернемо_зі_знижкою_10 ?? 0)} ₴`} />
            <Metric label="Зі знижкою 25%" value={`${money(promo.повернемо_зі_знижкою_25 ?? 0)} ₴`} />
            <Metric label="Зі знижкою 40%" value={`${money(promo.повернемо_зі_знижкою_40 ?? 0)} ₴`} />
          </dl>
          <p className="mt-3 text-xs text-g500">
            Оцінка запасу змішана (собівартість там, де відома, інакше ціна продажу), тож це
            орієнтир глибини акції, а не точний виторг.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Мертвий товар: які акції запустити"
          hint="Позиції з найгіршою оборотністю, глибина знижки і скільки грошей вона поверне"
        />
        {p.illiquid?.length ? (
          <ul className="flex flex-col gap-2">
            {p.illiquid.map((item) => {
              const stale = staleById.get(item.id);
              const brand = staleBrandById.get(item.id) ?? brandById.get(item.id);
              const name = stale?.товар ?? brand?.бренд;
              if (!name) return null;
              const meta = ACTION_META[item.action] ?? ACTION_META.WATCH;

              // Суму повернення беремо з фактів за глибиною, яку назвала
              // модель: так у картці стоїть порахована цифра, а не переказ.
              const back =
                item.action === "DISCOUNT" && item.discountPct != null
                  ? stale?.повернемо_зі_знижкою?.[`${item.discountPct}%`]
                  : null;

              return (
                <li key={item.id} className="rounded-[var(--radius-card)] border border-g200 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-bk">{name}</span>
                    <span className="flex items-center gap-1.5">
                      {item.action === "DISCOUNT" && item.discountPct != null && (
                        <Badge status="warn">знижка {num(item.discountPct)}%</Badge>
                      )}
                      <Badge status={meta.status}>{meta.label}</Badge>
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-g700">{item.comment}</p>
                  {stale && (
                    <p className="mt-1 text-xs text-g500">
                      Залишок {num(stale.залишок ?? 0, 1)} шт на {money(stale.сума ?? 0)} ₴
                      {stale.днів_без_продажу != null
                        ? ` · без продажу ${num(stale.днів_без_продажу)} дн.`
                        : " · не продавався жодного разу"}
                      {back != null && (
                        <>
                          {" "}
                          · <span className="font-medium text-emerald-700">
                            повернемо ≈ {money(back)} ₴
                          </span>
                        </>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Модель не виділила позицій неліквіду" />
        )}
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  alarm,
}: {
  label: string;
  value: string;
  hint?: string;
  alarm?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-g500">{label}</dt>
      <dd className={`text-base font-semibold ${alarm ? "text-red-700" : "text-bk"}`}>{value}</dd>
      {hint && <p className="text-xs text-g400">{hint}</p>}
    </div>
  );
}
