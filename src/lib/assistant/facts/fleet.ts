/**
 * Автопарк для помічника керівника і MCP (shifts_report mode=fleet).
 *
 * Обгортка над fleetOverview — тим самим, що малює «Логістика → Автопарк»,
 * щоб «скільки лишилось до заміни масла» в чаті й на сторінці збігалося.
 *
 * Окремим інструментом не став свідомо: у керівника вже 24 інструменти,
 * далі — лише режими (див. шапку tools/index.ts). Сирий журнал для зрізів,
 * яких тут немає, — види vehicles і vehicle_services у query_db.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { uah } from "@/lib/assistant/format";
import { DUE_LABEL } from "@/lib/fleet/due";
import { KIND_LABEL } from "@/lib/fleet/kinds";
import { normalizePlate } from "@/lib/fleet/input";
import { fleetOverview, type FleetVehicle } from "@/lib/fleet/overview";

const SOURCE = { manual: "внесено руками", service: "журнал обслуговування", shift: "зміна в застосунку" } as const;

function matches(v: FleetVehicle, q: string): boolean {
  const plate = normalizePlate(q);
  const text = q.toLowerCase();
  return (
    (plate.length >= 3 && v.plate.includes(plate)) ||
    `${v.make} ${v.model}`.toLowerCase().includes(text) ||
    (v.holder?.name.toLowerCase().includes(text) ?? false)
  );
}

function vehicleFacts(v: FleetVehicle) {
  const d = v.depreciation;
  return {
    номер: v.plate,
    машина: `${v.make} ${v.model}${v.year ? `, ${v.year}` : ""}`,
    в_обліку: v.active,
    хто_їздить: v.holder ? `${v.holder.name} (з ${v.holder.since})` : null,
    пробіг_км: v.odometer?.km ?? null,
    пробіг_станом_на: v.odometer?.day ?? null,
    джерело_пробігу: v.odometer ? `${SOURCE[v.odometer.source]}${v.odometer.by ? ` — ${v.odometer.by}` : ""}` : null,
    то: v.due.map((x) => ({
      що: x.title,
      стан: DUE_LABEL[x.state],
      інтервал: [x.everyKm ? `${x.everyKm} км` : null, x.everyMonths ? `${x.everyMonths} міс.` : null]
        .filter(Boolean)
        .join(" або "),
      востаннє: x.lastDay,
      на_пробігу_км: x.lastOdometerKm,
      міняти_на_км: x.dueAtKm,
      лишилось_км: x.kmLeft,
      міняти_до: x.dueDay,
      лишилось_днів: x.daysLeft,
    })),
    правил_то_немає: v.due.length === 0 ? true : undefined,
    останнє_обслуговування: v.lastService
      ? `${v.lastService.day}: ${v.lastService.kindLabel} — ${v.lastService.title}`
      : null,
    обслуговування_за_період: uah(v.periodCost),
    записів_за_період: v.periodServices,
    обслуговування_за_весь_час: uah(v.totalCost),
    амортизація: d
      ? {
          ціна_купівлі: uah(v.purchase.price),
          куплено: v.purchase.day,
          на_місяць: d.fullyDepreciated ? 0 : uah(d.monthly),
          нараховано: uah(d.accrued),
          місяців_минуло: d.monthsElapsed,
          місяців_лишилось: d.monthsLeft,
          залишкова_вартість: uah(d.bookValue),
          на_1_км: d.perKm == null ? null : Math.round(d.perKm * 100) / 100,
        }
      : "не рахується: у картці немає ціни, дати купівлі чи строку служби",
    посилання: `/admin/logistics/fleet?v=${v.id}`,
  };
}

export async function fleetReportFacts(input: {
  today: string;
  from: Date;
  to: Date;
  vehicle: string | null;
}) {
  const overview = await fleetOverview({ today: input.today, from: input.from, to: input.to, includeInactive: !!input.vehicle });
  let list = overview.vehicles;
  if (input.vehicle) {
    list = list.filter((v) => matches(v, input.vehicle!));
    if (list.length === 0) {
      return {
        помилка: `Машину «${input.vehicle}» не знайдено`,
        варіанти: overview.vehicles.map((v) => `${v.plate} — ${v.make} ${v.model}${v.holder ? `, ${v.holder.name}` : ""}`),
      };
    }
  }

  // Журнал — коли йдеться про одну машину: на весь парк він задовгий.
  let журнал: unknown = undefined;
  if (list.length === 1) {
    const rows = await prisma.vehicleService.findMany({
      where: { vehicleId: list[0].id },
      orderBy: { date: "desc" },
      take: 30,
    });
    журнал = rows.map((s) => ({
      дата: kyivDate(s.date),
      вид: KIND_LABEL[s.kind],
      що_зроблено: s.title,
      пробіг_км: s.odometerKm,
      запчастини: uah(s.partsCost),
      робота: uah(s.laborCost),
      разом: uah(s.partsCost + s.laborCost),
      сто: s.vendor,
    }));
  }

  return {
    сьогодні: overview.today,
    витрати_за_період: overview.period,
    машини: list.map(vehicleFacts),
    журнал,
    разом: input.vehicle
      ? undefined
      : {
          машин_в_обліку: overview.totals.vehicles,
          то_прострочено: overview.totals.overdue,
          то_скоро: overview.totals.soon,
          обслуговування_за_період: uah(overview.totals.periodCost),
          амортизація_на_місяць: uah(overview.totals.monthlyDepreciation),
        },
    увага:
      "Обслуговування автопарку — окремий облік, його НЕ додавати до витрат 1С чи P&L (money_flows): ремонт міг уже потрапити у витрати 1С. «немає відліку» означає, що в журналі ще немає запису цього виду.",
    ...(overview.vehicles.length === 0
      ? { порожньо: "Машин в обліку ще немає — їх заводять у «Логістика → Автопарк»." }
      : {}),
  };
}
