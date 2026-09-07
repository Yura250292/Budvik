/**
 * Відповіді керівника — ті, які код складає сам, без моделі.
 *
 * Те саме правило, що й у торгового: типове питання коштує секунду й нуль
 * токенів, модель лишається на «зважити й пояснити». Різниця лише в тому,
 * що тут кожна відповідь — про всю фірму, а не про один портфель.
 *
 * Оформлення береться з md.ts, тобто те саме, що в answers.ts: заголовок
 * зі знаком, таблиця там, де числа порівнюються, світлофор замість слів і
 * рядок кнопок унизу.
 *
 * ІМЕНА. Жодна з цих відповідей не вгадує, про кого мова: ім'я з питання
 * йде в resolveStaff, і якщо збігів кілька — показуються варіанти. Не
 * знайшовся співробітник — пробуємо картку клієнта: «борг у Кавецького» і
 * «борг у Кунанця» звучать однаково, а означають різне.
 */

import type { ToolContext } from "@/lib/assistant/types";
import type { PeriodSpec } from "@/lib/assistant/router";
import {
  MEDALS,
  arrow,
  bar,
  followUps,
  light,
  md,
  payerIcon,
  short,
  table,
  timed,
  type DirectAnswer,
} from "@/lib/assistant/md";
import { capitalize, periodChips, periodOf } from "@/lib/assistant/period";
import { clientLink, days as daysWord, money, percent, productLink } from "@/lib/assistant/text";
import { listStaff, resolveStaff, type StaffRole } from "@/lib/assistant/facts/staff";
import { answerClientCard } from "@/lib/assistant/answers";
import {
  driversReportTool,
  shiftsReportTool,
  siteOrdersTool,
  staffNowTool,
  stockHealthTool,
  syncHealthTool,
  teamOverviewTool,
  teamReceivablesTool,
} from "@/lib/assistant/tools/admin";
import { driversTodayTool } from "@/lib/assistant/tools/warehouse";
import { collectedByMethod, collectedByRepBrand, collectedMethodMap, collectedTotals } from "@/lib/analytics/money-facts";
import { returnedProducts, returnsByClient, revenueByRep } from "@/lib/analytics/facts";
import { monthForecast } from "@/lib/assistant/facts/forecast";
import { shiftDay } from "@/lib/analytics/period";

/* ── Дрібні помічники ─────────────────────────────────────────────────── */

/** Результат інструмента як обʼєкт із довільними полями. */
type Facts = Record<string, unknown>;

/** Виклик інструмента з тим самим слідом, що й у ходу через модель. */
async function callTool(
  tool: { name: string; label: string; run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown> },
  ctx: ToolContext,
  args: Record<string, unknown>,
  into: DirectAnswer["tools"]
): Promise<Facts> {
  return timed({ name: tool.name, label: tool.label }, () => tool.run(ctx, args) as Promise<Facts>, into);
}

/** Відповідь «уточніть, про кого мова» — та сама форма скрізь. */
function askWhich(
  candidates: Array<{ id: string; name: string; role: StaffRole }>,
  tools: DirectAnswer["tools"]
): DirectAnswer {
  return {
    markdown: md([
      "## 🙋 Уточніть, про кого мова",
      "",
      ...candidates.map((c) => `- **${c.name}**`),
      "",
      "Назвіть прізвище повністю.",
    ]),
    tools,
  };
}

/** Посилання на картку торгового в адмінці. Водіям картки немає — лишається імʼя. */
const repLink = (id: string, name: string) => `[${name}](/admin/sales-reps/${id})`;

/** Скільки хвилин без сигналу вважати нормою, а скільки тривогою. */
const SIGNAL_OK_MIN = 15;
const SIGNAL_WARN_MIN = 60;

const signalLight = (minutes: number | null | undefined) =>
  minutes == null ? "🔴" : minutes <= SIGNAL_OK_MIN ? "🟢" : minutes <= SIGNAL_WARN_MIN ? "🟡" : "🔴";

const minutesText = (minutes: number | null | undefined) =>
  minutes == null ? "немає" : minutes < 60 ? `${minutes} хв` : `${Math.round(minutes / 60)} год`;

/* ── 📍 Хто де зараз ──────────────────────────────────────────────────── */

export async function answerStaffNow(
  ctx: ToolContext,
  who: string | null,
  role: "SALES" | "DRIVER" | null
): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  /**
   * Ім'я розв'язуємо ДО інструмента.
   *
   * Не заради економії запиту, а заради відповіді: людина, яка сьогодні не
   * відкривала зміни, у живому списку відсутня, і без імені відповідь
   * виходила б «сьогодні не працює ніхто» — про всю фірму замість того,
   * про кого питали.
   */
  let asked: string | null = null;
  if (who) {
    const match = await resolveStaff(who, role ? [role] : ["SALES", "DRIVER"]);
    if (!match.ok && match.reason === "ambiguous") return askWhich(match.candidates, tools);
    if (!match.ok) {
      return {
        markdown: `## 📍 Хто де зараз\n\nСпівробітника «${who}» у базі немає.`,
        tools,
      };
    }
    asked = match.user.name;
  }

  const facts = await callTool(
    staffNowTool,
    ctx,
    { ...(who ? { who } : {}), ...(role ? { role } : {}) },
    tools
  );

  if (facts.помилка) {
    const variants = (facts.варіанти ?? []) as Array<{ id: string; ім_я: string; роль: string }>;
    if (variants.length > 0) {
      return askWhich(
        variants.map((v) => ({ id: v.id, name: v.ім_я, role: "SALES" as StaffRole })),
        tools
      );
    }
    return { markdown: `## 📍 Хто де зараз\n\n${String(facts.помилка)}.`, tools };
  }

  type Person = {
    ім_я: string | null;
    роль: string;
    зміна: { стан: string; тиша_від_початку_хв: number | null } | null;
    останній_сигнал_хв_тому: number | null;
    пройдено_км: number;
    замовлень_сьогодні: number;
    проблема: string | null;
  };
  const people = (facts.люди ?? []) as Person[];

  if (people.length === 0) {
    return {
      markdown: md([
        "## 📍 Хто де зараз",
        "",
        asked
          ? `**${asked}** сьогодні зміну не відкривав, і точок від нього немає.`
          : "Сьогодні зміну не відкривав ніхто, і треку теж немає.",
        "",
        followUps("Де зараз водії", "Зміни за тиждень"),
      ]),
      tools,
    };
  }

  const rows = people.map((p) => {
    const open = p.зміна?.стан === "відкрита";
    const state = !p.зміна
      ? "⚪ без зміни"
      : open
        ? `${p.проблема ? "🔴" : signalLight(p.останній_сигнал_хв_тому)} на зміні`
        : "✅ закрив";
    return [
      state,
      `${p.роль === "водій" ? "🚚" : "🧑‍💼"} ${short(p.ім_я ?? "—", 20)}`,
      minutesText(p.останній_сигнал_хв_тому),
      `${p.пройдено_км} км`,
      p.замовлень_сьогодні,
    ];
  });

  /**
   * «Подивитись» — лише про тих, хто ЗАРАЗ на зміні.
   *
   * Діагноз треку пишеться для живої карти вдень, і ввечері він однаково
   * каже «точок немає 370 хв» про людину, яка вже пів дня як закрилася.
   * Такий список читається як шість аварій замість жодної.
   */
  const problems = people.filter((p) => p.проблема && p.зміна?.стан === "відкрита");

  return {
    markdown: md([
      `## 📍 Хто де зараз · ${String(facts.зараз ?? "")}`,
      "",
      `На зміні **${String(facts.на_зміні ?? 0)}** із ${people.length}${
        Number(facts.мовчать ?? 0) > 0 ? `, мовчать **${String(facts.мовчать)}**` : ""
      }.`,
      "",
      ...table(["Стан", "Хто", "Сигнал", "Пробіг", "Замовл."], rows),
      "",
      problems.length > 0 ? "### ⚠️ Подивитись" : null,
      ...problems.map((p) => `- **${p.ім_я}** — ${p.проблема}`),
      problems.length > 0 ? "" : null,
      "_Тиша планшета не означає, що людина не працює: без звʼязку точки приїжджають пачкою пізніше._",
      "",
      followUps("Де зараз водії", "Зміни за тиждень", "Хто не закрив зміну"),
    ]),
    tools,
  };
}

/* ── 📈 Продажі по торгових ───────────────────────────────────────────── */

type TeamRep = {
  торговий_id: string;
  торговий: string;
  місце: number;
  оборот: number;
  реалізацій: number;
  клієнтів: number;
  середній_чек: number;
  зібрано: number;
  прострочено_відсотків: number | null;
  повернення_відсотків: number | null;
  нових_клієнтів: number | null;
  втрачених_клієнтів: number | null;
  динаміка_відсотків: number | null;
  приріст_боргу: number | null;
  план?: number;
  виконання_відсотків?: number | null;
  прогноз_місяця?: number;
  сильне?: string[];
  слабке?: string[];
};

export async function answerTeamSales(
  ctx: ToolContext,
  spec: PeriodSpec,
  who: string | null
): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  /**
   * Ім'я може виявитися клієнтом.
   *
   * «Скільки продав Химич» — це не торговий, а магазин, і правильна
   * відповідь на нього — картка клієнта, а не «такого торгового немає».
   */
  if (who) {
    const match = await resolveStaff(who, ["SALES"]);
    if (!match.ok && match.reason === "ambiguous") return askWhich(match.candidates, tools);
    if (!match.ok) return answerClientCard(ctx, who);
  }

  const facts = await callTool(
    teamOverviewTool,
    ctx,
    {
      ...(who ? { rep: who } : {}),
      ...(who ? { by_brand: true } : {}),
      period_from: period.fromDay,
      period_to: period.toDay,
    },
    tools
  );

  const reps = (facts.торгові ?? []) as TeamRep[];
  if (reps.length === 0) {
    return {
      markdown: `${capitalize(period.label)} реалізацій немає — порівнювати нема з чим.`,
      tools,
    };
  }

  const totals = facts.разом as { оборот: number; реалізацій: number; зібрано: number };
  const medians = facts.медіани as { оборот: number; середній_чек: number };

  /* ── Один торговий ──────────────────────────────────────────────────── */

  if (who && reps.length === 1) {
    const r = reps[0];
    const brands = (facts.бренди ?? []) as Array<{ бренд: string; оборот: number }>;
    const brandTotal = brands.reduce((s, b) => s + b.оборот, 0);

    return {
      markdown: md([
        `## 📈 ${r.торговий} · ${period.label}`,
        "",
        ...table(
          ["Оборот", "Місце", "Реалізацій", "Клієнтів", "Сер. чек"],
          [[money(r.оборот), `${r.місце}`, r.реалізацій, r.клієнтів, money(r.середній_чек)]]
        ),
        "",
        ...table(
          r.приріст_боргу == null
            ? ["Зібрано", "Прострочено", "Динаміка"]
            : ["Зібрано", "Прострочено", "Динаміка", "Δ боргу"],
          [
            [
              money(r.зібрано),
              `${light((r.прострочено_відсотків ?? 0) < 10 ? "good" : (r.прострочено_відсотків ?? 0) <= 25 ? "mid" : "bad")} ${percent(r.прострочено_відсотків ?? 0)}`,
              `${arrow(r.динаміка_відсотків)} ${r.динаміка_відсотків == null ? "—" : percent(r.динаміка_відсотків)}`,
              ...(r.приріст_боргу == null ? [] : [money(r.приріст_боргу)]),
            ],
          ]
        ),
        "",
        r.прогноз_місяця != null ? `🔮 Темп місяця веде до **${money(r.прогноз_місяця)}**.` : null,
        r.план != null ? `🎯 План ${money(r.план)} — ${bar(r.виконання_відсотків ?? 0)} ${percent(r.виконання_відсотків ?? 0)}.` : null,
        "",
        brands.length > 0 ? "### 🏷 Чим торгує" : null,
        ...table(
          ["Бренд", "Оборот", "Частка"],
          brands.slice(0, 8).map((b) => [
            short(b.бренд, 24),
            money(b.оборот),
            brandTotal > 0 ? `${Math.round((b.оборот / brandTotal) * 100)} %` : "—",
          ])
        ),
        "",
        r.сильне?.length ? `✅ **Сильне:** ${r.сильне.join(", ")}.` : null,
        r.слабке?.length ? `⚠️ **Провисає:** ${r.слабке.join(", ")}.` : null,
        "",
        `_Медіана команди за цей період: оборот ${money(medians.оборот)}, середній чек ${money(medians.середній_чек)}._`,
        "",
        followUps("Дебіторка по торгових", "Зміни торгових за тиждень", "Продажі по торгових"),
      ]),
      tools,
    };
  }

  /* ── Уся команда ────────────────────────────────────────────────────── */

  const board = [...reps].sort((a, b) => b.оборот - a.оборот);
  const rows = board.map((r, i) => [
    MEDALS[i] ?? `${i + 1}`,
    repLink(r.торговий_id, short(r.торговий, 22)),
    money(r.оборот),
    r.реалізацій,
    r.динаміка_відсотків == null ? "—" : `${arrow(r.динаміка_відсотків)} ${percent(r.динаміка_відсотків)}`,
  ]);

  const planned = board.filter((r) => r.план != null);
  const earlyMonth = period.fromDay.endsWith("-01") && Number(ctx.today.slice(8, 10)) <= 7;

  return {
    markdown: md([
      `## 📈 Продажі по торгових · ${period.label}`,
      "",
      `Разом **${money(totals.оборот)}** за ${totals.реалізацій} реалізацій, зібрано ${money(totals.зібрано)}.`,
      "",
      ...table(["#", "Торговий", "Оборот", "Реал.", "Динаміка"], rows),
      "",
      planned.length > 0 ? "### 🎯 План" : null,
      ...table(
        ["Торговий", "Факт", "План", "Виконання"],
        planned.map((r) => [
          short(r.торговий, 22),
          money(r.оборот),
          money(r.план ?? 0),
          `${bar(r.виконання_відсотків ?? 0)} ${percent(r.виконання_відсотків ?? 0)}`,
        ])
      ),
      planned.length === 0 && facts.плани_заведені === false
        ? "_Планів у базі не заведено, тому виконання рахувати нема від чого — орієнтир лише минулий місяць._"
        : null,
      earlyMonth ? "_⏳ Місяць щойно почався — числа ще випадкові._" : null,
      "",
      `_Медіана команди: оборот ${money(medians.оборот)}, середній чек ${money(medians.середній_чек)}. ${String(facts.примітка ?? "")}_`,
      "",
      periodChips("Продажі по торгових"),
    ]),
    tools,
  };
}

/* ── 💰 Дебіторка фірми ───────────────────────────────────────────────── */

export async function answerTeamDebts(ctx: ToolContext, who: string | null): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  if (who) {
    const match = await resolveStaff(who, ["SALES"]);
    if (!match.ok && match.reason === "ambiguous") return askWhich(match.candidates, tools);
    // Не торговий — значить, питали про клієнта.
    if (!match.ok) return answerClientCard(ctx, who);
  }

  const facts = await callTool(teamReceivablesTool, ctx, who ? { rep: who } : {}, tools);

  const total = facts.разом as {
    борг: number;
    прострочено: number;
    прострочено_відсотків: number;
    боржників: number;
    без_торгового: number;
  };
  const byRep = (facts.по_торгових ?? []) as Array<{
    торговий_id: string;
    торговий: string;
    борг: number;
    прострочено: number;
    прострочено_відсотків: number;
    зібрано_за_період: number;
    приріст_боргу: number | null;
  }>;
  const debtors = (facts.найбільші_боржники ?? []) as Array<{
    клієнт_id: string;
    клієнт: string;
    торговий: string | null;
    борг: number;
    прострочено: number;
    найстаріше_днів: number | null;
    платник: string | null;
  }>;

  if (total.борг <= 0) {
    return { markdown: "## 💰 Дебіторка фірми\n\nБоргів немає — усе закрито.", tools };
  }

  const ratioLight = light(
    total.прострочено_відсотків < 10 ? "good" : total.прострочено_відсотків <= 25 ? "mid" : "bad"
  );
  const hasDelta = byRep.some((r) => r.приріст_боргу != null);

  return {
    markdown: md([
      who ? `## 💰 Дебіторка · ${byRep[0]?.торговий ?? who}` : "## 💰 Дебіторка фірми",
      "",
      ...table(
        ["💼 Усього", "🔴 Прострочено", "👥 Боржників", "❔ Без торгового"],
        [[
          money(total.борг),
          `${ratioLight} ${money(total.прострочено)} (${percent(total.прострочено_відсотків)})`,
          total.боржників,
          money(total.без_торгового),
        ]]
      ),
      "",
      !who && byRep.length > 1 ? "### По торгових" : null,
      /*
       * Колонка «Δ боргу» зʼявляється лише тоді, коли є з чим порівнювати.
       * Знімків сальдо на початок періоду може не бути взагалі, і стовпчик
       * із самих прочерків лише забирає ширину на телефоні.
       */
      ...(!who && byRep.length > 1
        ? table(
            hasDelta
              ? ["Торговий", "Борг", "Простр.", "Зібрано", "Δ боргу"]
              : ["Торговий", "Борг", "Простр.", "Зібрано"],
            byRep.map((r) => {
              const row = [
                short(r.торговий, 20),
                money(r.борг),
                `${light(r.прострочено_відсотків < 10 ? "good" : r.прострочено_відсотків <= 25 ? "mid" : "bad")} ${percent(r.прострочено_відсотків)}`,
                money(r.зібрано_за_період),
              ];
              return hasDelta ? [...row, r.приріст_боргу == null ? "—" : money(r.приріст_боргу)] : row;
            })
          )
        : []),
      "",
      "### Найбільші боржники",
      ...debtors.slice(0, 10).map((d) => {
        const age = d.найстаріше_днів != null ? ` · ${daysWord(d.найстаріше_днів)}` : "";
        const rep = d.торговий ? ` · ${d.торговий}` : "";
        const verdict = d.платник ? ` · ${payerIcon(d.платник)} ${d.платник}` : "";
        return `- ${d.прострочено > 0 ? "🔴" : "🟡"} ${clientLink(d.клієнт_id, d.клієнт)} — ${
          d.прострочено > 0
            ? `прострочено **${money(d.прострочено)}** із ${money(d.борг)}`
            : `борг ${money(d.борг)} робочий`
        }${age}${rep}${verdict}`;
      }),
      "",
      `_${String(facts.примітка ?? "")} Платник: 🟢 надійний · 🟡 помірний · 🟠 ризиковий · 🔴 лише передоплата._`,
      "",
      followUps("Хто скільки зібрав за тиждень", "Продажі по торгових", "Хто де зараз"),
    ]),
    tools,
  };
}

/* ── 💵 Скільки зібрали ───────────────────────────────────────────────── */

export async function answerTeamCollected(ctx: ToolContext, spec: PeriodSpec): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  const [rows, byMethod, staff] = await timed(
    { name: "team_collected", label: "Рахую зібрані гроші" },
    async () =>
      Promise.all([
        collectedByRepBrand(period.from, period.to),
        collectedByMethod(period.from, period.to),
        listStaff(["SALES"]),
      ]),
    tools
  );

  const totals = collectedTotals(rows);
  const methods = collectedMethodMap(byMethod);
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));

  const list = [...totals.entries()]
    .map(([repId, v]) => ({ repId, name: nameOf.get(repId) ?? "—", amount: v.amount, methods: methods.get(repId) ?? {} }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);

  if (list.length === 0) {
    return { markdown: `${capitalize(period.label)} грошей не надходило.`, tools };
  }

  const sum = list.reduce((s, r) => s + r.amount, 0);
  /** У базі спосіб лежить у нижньому регістрі — звіряємо без огляду на нього. */
  const methodName = (key: string) => {
    const k = key.toUpperCase();
    return k === "CASH" ? "готівка" : k === "BANK" ? "банк" : key;
  };

  return {
    markdown: md([
      `## 💵 Зібрано · ${period.label}`,
      "",
      `Разом **${money(sum)}**.`,
      "",
      ...table(
        ["Торговий", "Зібрано", "Чим"],
        list.map((r) => [
          short(r.name, 22),
          money(r.amount),
          Object.entries(r.methods)
            .filter(([, v]) => v !== 0)
            .map(([k, v]) => `${methodName(k)} ${money(v)}`)
            .join(", ") || "—",
        ])
      ),
      "",
      "_Дата грошей — день оплати в 1С, а не день обміну._",
      "",
      periodChips("Скільки зібрали"),
    ]),
    tools,
  };
}

/* ── 🚗 Зміни ─────────────────────────────────────────────────────────── */

export async function answerShifts(
  ctx: ToolContext,
  spec: PeriodSpec,
  who: string | null
): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  if (who) {
    const match = await resolveStaff(who, ["SALES", "DRIVER"]);
    if (!match.ok && match.reason === "ambiguous") return askWhich(match.candidates, tools);
    if (!match.ok) {
      return {
        markdown: `## 🚗 Зміни\n\nСпівробітника «${who}» у базі немає.`,
        tools,
      };
    }
  }

  const facts = await callTool(
    shiftsReportTool,
    ctx,
    { ...(who ? { rep: who } : {}), period_from: period.fromDay, period_to: period.toDay },
    tools
  );

  const rows = (facts.по_людях ?? []) as Array<{
    ім_я: string;
    змін: number;
    робочих_км: number;
    gps_км: number;
    підозрілих: number;
    відкритих: number;
    пальне_грн: number;
  }>;
  if (rows.length === 0) {
    return { markdown: `${capitalize(period.label)} закритих змін немає.`, tools };
  }

  const watch = (facts.подивитись ?? []) as Array<{ ім_я: string; день: string; що: string; км: number | null }>;
  const openNow = (facts.зараз_відкриті ?? []) as Array<{ ім_я: string; рішення: string; чому: string }>;
  const totals = facts.разом as { змін: number; робочих_км: number; пальне_грн: number };

  return {
    markdown: md([
      `## 🚗 Зміни · ${period.label}`,
      "",
      `Разом **${totals.змін}** змін, ${totals.робочих_км} км, пального на ${money(totals.пальне_грн)}.`,
      "",
      ...table(
        ["Хто", "Змін", "Роб. км", "GPS км", "Пальне", "Одометр"],
        rows.map((r) => [
          short(r.ім_я, 20),
          r.змін,
          r.робочих_км,
          r.gps_км,
          money(r.пальне_грн),
          r.підозрілих === 0 ? "🟢" : r.підозрілих === 1 ? "🟡" : "🔴",
        ])
      ),
      "",
      watch.length > 0 ? "### ⚠️ Подивитись" : null,
      ...watch.map((w) => `- **${w.ім_я}** · ${w.день} — ${w.що}${w.км == null ? "" : `, ${w.км} км`}`),
      watch.length > 0 ? "" : null,
      openNow.length > 0 ? "### ⏳ Зараз відкриті" : null,
      ...openNow.map((o) => `- **${o.ім_я}** — ${o.рішення}: ${o.чому}`),
      "",
      `_${String(facts.примітка ?? "")}_`,
      "",
      followUps("Хто де зараз", "Зміни за минулий місяць", "Зарплата водіїв"),
    ]),
    tools,
  };
}

/* ── 🚚 Водії на день ─────────────────────────────────────────────────── */

export async function answerDriversDay(ctx: ToolContext, dayIso: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const facts = await callTool(driversTodayTool, ctx, { dayIso }, tools);

  type Driver = {
    водій: string | null;
    маршрут: { джерело: string; номер: string | null };
    разом: { точок: number; відмічено: number; лишилось: number; товару_на: number; забрати_грошей: number };
    зараз: { наступна_точка: { назва: string; адреса: string | null } | null; хвилин_тому: number | null };
  };
  const drivers = (facts.водії ?? []) as Driver[];
  const working = drivers.filter((d) => d.разом.точок > 0);

  if (working.length === 0) {
    return {
      markdown: md([
        `## 🚚 Водії · ${dayIso}`,
        "",
        "Маршрутів на цей день немає — ні з планувальника сайту, ні з 1С.",
        "",
        followUps("Зарплата водіїв за місяць", "Хто де зараз"),
      ]),
      tools,
    };
  }

  return {
    markdown: md([
      `## 🚚 Водії · ${dayIso}`,
      "",
      ...table(
        ["Водій", "Точок", "✅", "⬜", "Забрати", "Сигнал"],
        working.map((d) => [
          short(d.водій ?? "—", 20),
          d.разом.точок,
          d.разом.відмічено,
          d.разом.лишилось,
          money(d.разом.забрати_грошей),
          `${signalLight(d.зараз.хвилин_тому)} ${minutesText(d.зараз.хвилин_тому)}`,
        ])
      ),
      "",
      ...working
        .filter((d) => d.зараз.наступна_точка)
        .map((d) => `- **${d.водій}** → ${d.зараз.наступна_точка!.назва}${d.зараз.наступна_точка!.адреса ? `, ${d.зараз.наступна_точка!.адреса}` : ""}`),
      "",
      "_Номера накладної для листів із 1С немає в системі взагалі — там возять лише шапку._",
      "",
      followUps("Зарплата водіїв за місяць", "Хто де зараз"),
    ]),
    tools,
  };
}

/* ── 💸 Зарплата водіїв ───────────────────────────────────────────────── */

export async function answerDriverPayroll(
  ctx: ToolContext,
  spec: PeriodSpec,
  who: string | null
): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  if (who) {
    const match = await resolveStaff(who, ["DRIVER"]);
    if (!match.ok && match.reason === "ambiguous") return askWhich(match.candidates, tools);
    if (!match.ok) return { markdown: `## 💸 Водії\n\nВодія «${who}» у базі немає.`, tools };
  }

  const facts = await callTool(
    driversReportTool,
    ctx,
    { ...(who ? { driver: who } : {}), period_from: period.fromDay, period_to: period.toDay },
    tools
  );

  type Driver = {
    водій: string;
    листів: number;
    км: number;
    точок_місто: number;
    точок_область: number;
    зарплата: number;
    привезено_обороту: number;
    грн_на_точку: number | null;
  };
  const drivers = ((facts.водії ?? []) as Driver[]).filter((d) => d.листів > 0);
  const medians = facts.медіани as { грн_на_точку: number | null };

  if (drivers.length === 0) {
    return { markdown: `${capitalize(period.label)} маршрутних листів немає.`, tools };
  }

  const perPointLight = (value: number | null) => {
    if (value == null || medians.грн_на_точку == null || medians.грн_на_точку === 0) return "";
    return value <= medians.грн_на_точку ? "🟢" : value <= medians.грн_на_точку * 1.3 ? "🟡" : "🔴";
  };

  const details = facts.деталі as
    | { листи: Array<{ день: string; номер: string; км: number; точок: number; заробіток: number }>; разом: { за_листи: number; бонуси: number; разом: number } }
    | undefined;

  return {
    markdown: md([
      `## 💸 Водії · ${period.label}`,
      "",
      ...table(
        ["Водій", "Листів", "Км", "Точок", "Зарплата", "₴/точку"],
        drivers.map((d) => [
          short(d.водій, 18),
          d.листів,
          d.км,
          d.точок_місто + d.точок_область,
          money(d.зарплата),
          d.грн_на_точку == null ? "—" : `${perPointLight(d.грн_на_точку)} ${money(d.грн_на_точку)}`,
        ])
      ),
      "",
      medians.грн_на_точку != null ? `_Медіана команди: ${money(medians.грн_на_точку)} за точку._` : null,
      Number(facts.листів_без_водія ?? 0) > 0
        ? `_Листів без водія: ${String(facts.листів_без_водія)} — зарплати вони не творять._`
        : null,
      "",
      details ? "### 📋 Листи" : null,
      ...(details
        ? table(
            ["День", "№", "Км", "Точок", "Заробіток"],
            details.листи.map((s) => [s.день, s.номер, s.км, s.точок, money(s.заробіток)])
          )
        : []),
      details
        ? `**Разом:** за листи ${money(details.разом.за_листи)} + бонуси ${money(details.разом.бонуси)} = **${money(details.разом.разом)}**.`
        : null,
      "",
      `_${String(facts.примітка ?? "")}_`,
      "",
      periodChips("Зарплата водіїв"),
    ]),
    tools,
  };
}

/* ── 🛒 Замовлення з сайту ────────────────────────────────────────────── */

export async function answerSiteOrders(ctx: ToolContext, spec: PeriodSpec): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);
  const facts = await callTool(siteOrdersTool, ctx, { days: period.days }, tools);

  const byStatus = (facts.по_статусах ?? []) as Array<{ статус: string; кількість: number; сума: number }>;
  const pending = (facts.чекають_обробки ?? []) as Array<{
    номер: number;
    годин_чекає: number;
    клієнт: string;
    місто: string | null;
    сума: number;
    доставка: string;
  }>;
  const drafts = (facts.чернетки_торгових ?? []) as Array<{ торговий: string; чернеток: number; сума: number }>;

  if (byStatus.length === 0 && pending.length === 0) {
    return {
      markdown: md([
        `## 🛒 Замовлення з сайту · ${period.label}`,
        "",
        "Замовлень немає.",
        "",
        followUps("Замовлення за 30 днів", "Що з обміном 1С"),
      ]),
      tools,
    };
  }

  const ageLight = (hours: number) => (hours < 2 ? "🟢" : hours < 12 ? "🟡" : "🔴");

  return {
    markdown: md([
      `## 🛒 Замовлення з сайту · ${period.label}`,
      "",
      // Порожня таблиця нічого не каже, а речення каже: за період тихо,
      // але старе замовлення внизу все одно висить.
      byStatus.length === 0 ? "За цей період замовлень із сайту не було." : null,
      ...table(
        ["Статус", "К-сть", "Сума"],
        byStatus.map((s) => [s.статус, s.кількість, money(s.сума)])
      ),
      "",
      pending.length > 0 ? "### ⏳ Чекають обробки" : null,
      ...pending.slice(0, 10).map(
        (o) =>
          `- ${ageLight(o.годин_чекає)} **№${o.номер}** · ${o.годин_чекає} год · ${o.клієнт}${
            o.місто ? `, ${o.місто}` : ""
          } · ${money(o.сума)} · ${o.доставка}`
      ),
      "",
      drafts.length > 0 ? "### 📝 Чернетки торгових" : null,
      ...(drafts.length > 0
        ? table(
            ["Торговий", "Чернеток", "Сума"],
            drafts.slice(0, 10).map((d) => [short(d.торговий, 22), d.чернеток, money(d.сума)])
          )
        : []),
      "",
      `_${String(facts.примітка ?? "")}_`,
      "",
      followUps("Замовлення за 30 днів", "Що з обміном 1С"),
    ]),
    tools,
  };
}

/* ── 📦 Склад ─────────────────────────────────────────────────────────── */

export async function answerLowStock(
  ctx: ToolContext,
  brand: string | null,
  mode: "low" | "turnover" | "dead"
): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const facts = await callTool(stockHealthTool, ctx, { ...(brand ? { brand } : {}), mode }, tools);

  if (facts.помилка) {
    return { markdown: `## 📦 Склад\n\n${String(facts.помилка)}.`, tools };
  }

  const brandName = String(facts.бренд ?? "усі бренди");
  const low = facts.дефіцит as
    | {
        позицій: number;
        до_замовлення: number;
        нуль_на_складі: number;
        пекучих: number;
        сума_закупівлі: number;
        по_брендах: Array<{ бренд: string; до_замовлення: number; нуль: number; сума: number }>;
        пекучі?: Array<{ товар_id: string; назва: string; артикул: string | null; залишок: number; продано_за_вікно: number; замовити: number }>;
      }
    | undefined;
  const turnover = facts.оборотність as
    | {
        запас_грн: number;
        без_руху_позицій: number;
        без_руху_грн: number;
        частка_мертвих_відсотків: number;
        обертів_на_рік: number | null;
        найгірші: Array<{ назва: string; артикул: string | null; залишок: number; вартість: number; днів_без_продажу: number | null }>;
      }
    | undefined;
  const dead = facts.мертві as
    | Array<{ назва: string; артикул: string | null; залишок: number; собівартість: number }>
    | undefined;

  const state = low ? (low.пекучих > 0 ? "🔴" : low.до_замовлення > 0 ? "🟡" : "🟢") : "";

  return {
    markdown: md([
      `## 📦 Склад · ${brandName}`,
      "",
      low ? `${state} До замовлення **${low.до_замовлення}** позицій на ${money(low.сума_закупівлі)}; пекучих ${low.пекучих}, з нулем ${low.нуль_на_складі}.` : null,
      "",
      low && low.по_брендах.length > 1 ? "### По брендах" : null,
      ...(low && low.по_брендах.length > 1
        ? table(
            ["Бренд", "Замовити", "Нуль", "Сума"],
            low.по_брендах.slice(0, 10).map((b) => [short(b.бренд, 22), b.до_замовлення, b.нуль, money(b.сума)])
          )
        : []),
      "",
      low?.пекучі?.length ? "### 🔥 Продається і скінчилось" : null,
      ...(low?.пекучі ?? [])
        .slice(0, 10)
        .map(
          (i) =>
            `- ${productLink(short(i.назва, 44), i.артикул)} — залишок ${i.залишок}, продано ${i.продано_за_вікно}, замовити ~${i.замовити}`
        ),
      "",
      turnover ? "### 🧊 Запас без руху" : null,
      turnover
        ? `Склад на ${money(turnover.запас_грн)}, без руху ${turnover.без_руху_позицій} позицій на **${money(turnover.без_руху_грн)}** (${percent(turnover.частка_мертвих_відсотків)})${
            turnover.обертів_на_рік != null ? `, обертів на рік ${turnover.обертів_на_рік}` : ""
          }.`
        : null,
      ...(turnover?.найгірші ?? []).slice(0, 5).map(
        (w) =>
          `- ${productLink(short(w.назва, 44), w.артикул)} — ${w.залишок} шт на ${money(w.вартість)}${
            w.днів_без_продажу == null ? ", не продавався ніколи" : `, ${daysWord(w.днів_без_продажу)} без продажу`
          }`
      ),
      "",
      dead?.length ? "### 💤 Мертві залишки" : null,
      ...(dead ?? []).slice(0, 8).map(
        (d) => `- ${productLink(short(d.назва, 44), d.артикул)} — ${d.залишок} шт, собівартість ${money(d.собівартість)}`
      ),
      "",
      `_${String(facts.примітка ?? "")}_`,
      "",
      followUps(
        low?.по_брендах?.[0] ? `Дефіцит по бренду ${low.по_брендах[0].бренд}` : null,
        "Оборотність складу",
        "Мертві залишки"
      ),
    ]),
    tools,
  };
}

/* ── 🔄 Обмін із 1С ───────────────────────────────────────────────────── */

export async function answerSyncHealth(ctx: ToolContext): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const facts = await callTool(syncHealthTool, ctx, {}, tools);

  const agent = facts.агент as { останній_звязок: string | null; хвилин_тому: number | null; стан: string };
  const lastRun = facts.останній_прогін as { коли: string; тип: string; стан: string } | null;
  const perDay = facts.за_добу as { прогонів: number; невдалих: number };
  const channels = (facts.свіжість_каналів ?? []) as Array<{
    канал: string;
    годин_тому: number;
    свіжий: boolean;
  }>;
  const diffs = (facts.розбіжності ?? []) as Array<{ вид: string; поле: string; кількість: number }>;
  const errors = (facts.помилки ?? []) as string[];

  const stale = channels.filter((c) => !c.свіжий);

  const agentLight =
    agent.хвилин_тому == null ? "🔴" : agent.хвилин_тому < 30 ? "🟢" : agent.хвилин_тому < 120 ? "🟡" : "🔴";

  return {
    markdown: md([
      "## 🔄 Обмін з 1С",
      "",
      ...table(
        ["Агент", "Останній прогін", "За добу"],
        [[
          `${agentLight} ${agent.стан}, ${minutesText(agent.хвилин_тому)} тому`,
          lastRun ? `${lastRun.тип} — ${lastRun.стан}` : "не було",
          `${perDay.прогонів}, збоїв ${perDay.невдалих}`,
        ]]
      ),
      "",
      "### Свіжість каналів",
      /*
       * Свіжі канали в одному рядку, несвіжі — таблицею.
       * Коли все гаразд (а це звичайний стан), чотирнадцять рядків із
       * зеленими кружечками витісняють з екрана те, заради чого питали.
       */
      stale.length === 0
        ? `🟢 Усі ${channels.length} каналів свіжі — найстаріший ${Math.max(...channels.map((c) => c.годин_тому))} год тому.`
        : null,
      ...(stale.length > 0
        ? table(
            ["Канал", "Годин тому", ""],
            stale.map((c) => [c.канал, c.годин_тому, "🔴"])
          )
        : []),
      "",
      diffs.length > 0 ? "### Нерозібрані розбіжності" : null,
      ...(diffs.length > 0
        ? table(
            ["Вид", "Поле", "К-сть"],
            diffs.slice(0, 8).map((d) => [d.вид, d.поле, d.кількість])
          )
        : []),
      "",
      errors.length > 0 ? "### ⚠️ Помилки прогонів" : null,
      ...errors.slice(0, 3).map((e) => `- ${e}`),
      "",
      `_${String(facts.примітка ?? "")} Борги оновлено ${String(facts.борги_оновлено ?? "—")}._`,
      "",
      followUps("Що закінчується на складі", "Дебіторка фірми"),
    ]),
    tools,
  };
}

/* ── 🔮 План фірми ────────────────────────────────────────────────────── */

export async function answerTeamForecast(ctx: ToolContext): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const reps = await timed(
    { name: "team_forecast", label: "Рахую прогноз по команді" },
    async () => {
      const staff = await listStaff(["SALES"]);
      const rows = await Promise.all(
        staff.map(async (s) => ({ name: s.name, forecast: await monthForecast(s.id, ctx.today) }))
      );
      return rows
        .map((r) => ({ name: r.name, metric: r.forecast.показники.find((m) => m.ключ === "revenue")!, f: r.forecast }))
        .filter((r) => r.metric && (r.metric.факт > 0 || r.metric.план > 0))
        .sort((a, b) => b.metric.прогноз - a.metric.прогноз);
    },
    tools
  );

  if (reps.length === 0) {
    return { markdown: "## 🔮 План фірми\n\nЦього місяця продажів ще немає.", tools };
  }

  const first = reps[0].f;
  const hasPlans = reps.some((r) => r.metric.план > 0);

  return {
    markdown: md([
      `## 🔮 Прогноз місяця`,
      "",
      `Минуло ${first.днів_минуло} днів із ${first.днів_усього}, лишилось ${first.днів_лишилось}.`,
      "",
      ...table(
        hasPlans ? ["Торговий", "Факт", "Темп/день", "Прогноз", "План"] : ["Торговий", "Факт", "Темп/день", "Прогноз"],
        reps.map((r) =>
          hasPlans
            ? [
                short(r.name, 20),
                money(r.metric.факт),
                money(r.metric.темп_на_день),
                money(r.metric.прогноз),
                r.metric.план > 0
                  ? `${bar(r.metric.прогнозоване_виконання_відсотків ?? 0)} ${percent(r.metric.прогнозоване_виконання_відсотків ?? 0)}`
                  : "—",
              ]
            : [short(r.name, 20), money(r.metric.факт), money(r.metric.темп_на_день), money(r.metric.прогноз)]
        )
      ),
      "",
      `**Разом прогноз:** ${money(reps.reduce((s, r) => s + r.metric.прогноз, 0))}.`,
      "",
      hasPlans
        ? null
        : "_Планів у базі не заведено жодному торговому, тому єдиний орієнтир — темп цього місяця й минулий місяць._",
      "",
      followUps("Продажі по торгових", "Дебіторка фірми"),
    ]),
    tools,
  };
}

/* ── ↩️ Повернення по фірмі ───────────────────────────────────────────── */

export async function answerTeamReturns(ctx: ToolContext, spec: PeriodSpec): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  const [revenue, byClient, byProduct, staff] = await timed(
    { name: "team_returns", label: "Дивлюся повернення" },
    async () =>
      Promise.all([
        revenueByRep(period.from, period.to),
        returnsByClient(period.from, period.to, null, 10),
        returnedProducts(period.from, period.to, null, 8),
        listStaff(["SALES"]),
      ]),
    tools
  );
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));

  const totalReturns = revenue.reduce((s, r) => s + Math.abs(r.returns), 0);
  if (totalReturns === 0) {
    return { markdown: `${capitalize(period.label)} повернень немає.`, tools };
  }

  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const share = totalRevenue > 0 ? (totalReturns / (totalRevenue + totalReturns)) * 100 : 0;

  const rows = revenue
    .filter((r) => Math.abs(r.returns) > 0)
    .map((r) => {
      const gross = r.amount + Math.abs(r.returns);
      const pctValue = gross > 0 ? (Math.abs(r.returns) / gross) * 100 : 0;
      return { name: nameOf.get(r.repId) ?? "—", returns: Math.abs(r.returns), pct: pctValue };
    })
    .sort((a, b) => b.returns - a.returns);

  return {
    markdown: md([
      `## ↩️ Повернення · ${period.label}`,
      "",
      `Разом **${money(totalReturns)}** — ${percent(share)} від відвантаженого.`,
      "",
      ...table(
        ["Торговий", "Повернень", "Частка"],
        rows.map((r) => [
          short(r.name, 22),
          money(r.returns),
          `${light(r.pct < 1 ? "good" : r.pct <= 3 ? "mid" : "bad")} ${percent(r.pct)}`,
        ])
      ),
      "",
      byClient.length > 0 ? "### Хто найбільше повертає" : null,
      ...byClient
        .slice(0, 8)
        .map((c) =>
          c.clientId
            ? `- ${clientLink(c.clientId, c.clientName ?? "—")} — ${money(Math.abs(c.amount))} за ${c.docs} док.`
            : `- ${c.clientName ?? "без клієнта"} — ${money(Math.abs(c.amount))} за ${c.docs} док.`
        ),
      "",
      byProduct.length > 0 ? "### Що повертають" : null,
      ...byProduct.slice(0, 8).map((p) => `- ${short(p.name, 44)} — ${money(Math.abs(p.amount))}`),
      "",
      periodChips("Повернення по фірмі"),
    ]),
    tools,
  };
}

/** Наступний день у київських добах — для «завтра» у водіях. */
export const nextDay = (today: string, delta: number) => shiftDay(today, delta);
