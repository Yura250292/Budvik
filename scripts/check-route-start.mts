/**
 * Маршрут у чаті: звідки стартує й чи перепитує замість «не знайдено».
 *
 *   npx tsx --env-file=.env scripts/check-route-start.mts
 *
 * Навіщо. 23.09.2026 власник будував у чаті маршрут по Бібрці, Перемишлянах
 * і Золочеву, і помічник (а) виїхав зі складу, хоча власник був деінде й
 * просив «враховуй мою геолокацію», а замість того щоб взяти місце,
 * перепитав адресу; (б) сказав «Яцків не знайдено в базі», хоча клієнт є
 * — «Яцьків».
 *
 * Тут той самий виклик інструмента build_route — з підробленим контекстом,
 * але на живій базі й живому OSRM. Лише читання.
 */

import { buildRouteTool } from "../src/lib/assistant/tools/route";
import { hereFromBody, accuracyLabel } from "../src/lib/assistant/here";
import { detectIntent } from "../src/lib/assistant/router";
import { prisma } from "../src/lib/prisma";
import type { ToolContext, Here } from "../src/lib/assistant/types";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${typeof got === "string" ? got : JSON.stringify(got)}`);
  if (!ok) fails.push(name);
}

/* ── Чисті правила, без бази ─────────────────────────────────────── */

const now = Date.now();
check("координати з тіла приймаються", hereFromBody({ lat: 49.84, lng: 24.03, accuracy: 35.4, at: now }, now)?.accuracyM === 35, hereFromBody({ lat: 49.84, lng: 24.03, accuracy: 35.4, at: now }, now));
check("(0,0) — не місце", hereFromBody({ lat: 0, lng: 0, accuracy: 5 }, now) === null, "null");
check("переплутані широта й довгота — не місце", hereFromBody({ lat: 24.03, lng: 49.84 }, now) === null, "null");
check("фікс 20-хвилинної давнини — не «зараз»", hereFromBody({ lat: 49.84, lng: 24.03, at: now - 20 * 60_000 }, now) === null, "null");
check("рядок замість числа не проходить", hereFromBody({ lat: "49.84", lng: "24.03" }, now) === null, "null");
check("похибка людською мовою", accuracyLabel(40) === "±40 м" && accuracyLabel(5200) === "±5,2 км", `${accuracyLabel(40)} / ${accuracyLabel(5200)}`);

const intent = (t: string) => detectIntent(t, { hasHistory: false, kind: "ADMIN" }) as { kind: string; start?: string; names?: string[] } | null;
const i1 = intent("побудуй маршрут: Скалоцька Бібрка, Солтівська Золочів");
check("керівник без уточнення — від себе", i1?.kind === "ROUTE_TO" && i1.start === "me", i1);
const i2 = intent("побудуй маршрут від складу: Скалоцька Бібрка, Солтівська Золочів");
check("«від складу» — склад, і він не стає точкою", i2?.start === "depot" && i2.names?.[0] === "Скалоцька Бібрка", i2);

/* ── Інструмент на живій базі ────────────────────────────────────── */

const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, name: true } });
if (!admin) {
  console.log("FAIL у базі немає ADMIN");
  process.exit(1);
}

const ctx = (here?: Here): ToolContext => ({
  userId: admin.id,
  role: "ADMIN",
  kind: "ADMIN",
  scope: { repId: admin.id, repName: admin.name, company: true },
  today: "2026-09-23",
  ...(here ? { here } : {}),
});

// Власник на Личаківській, Львів — десь, що точно не склад у Дублянах.
const LYCH: Here = { lat: 49.8352, lng: 24.0567, accuracyM: 25, source: "пристрій" };
const STOPS = [
  "Скалоцька Мар'яна Любомирівна (м. Бібрка)",
  "ФОП Скалоцька Мар'яна Любомирівна (м. Перемишляни)",
  "Солтівська Надя (м. Золочів)",
  "Яцків Іван Теодорович (Перемишляни)",
];

type Out = Record<string, unknown> & {
  старт?: { назва: string; широта: number };
  порядок?: Array<{ назва: string }>;
  нерозпізнані?: string[];
  можливо_мали_на_увазі?: Array<{ ви_назвали: string; варіанти: string[] }>;
  примітка?: string;
  км?: number | null;
};

const a = (await buildRouteTool.run(ctx(LYCH), { stops: STOPS })) as Out;
check("з геолокацією старт — «Ваша геолокація»", a.старт?.назва === "Ваша геолокація", a.старт);
check("усі чотири точки в маршруті, Яцьків теж", a.порядок?.length === 4 && a.порядок.some((p) => /Яцьків/.test(p.назва)), a.порядок?.map((p) => p.назва));
check("нерозпізнаних немає", (a.нерозпізнані ?? []).length === 0, a.нерозпізнані);
check("примітка каже, звідки старт", /геолокація \(±25 м, з пристрою\)/.test(a.примітка ?? ""), a.примітка);
check("кілометри від OSRM є", typeof a.км === "number" && a.км > 0, a.км);

const b = (await buildRouteTool.run(ctx(), { stops: STOPS })) as Out;
check("без геолокації — склад", b.старт?.назва !== "Ваша геолокація" && b.старт !== undefined, b.старт);
check("без геолокації примітка каже чому", /Старт — склад: вашого місця не знаю/.test(b.примітка ?? ""), b.примітка);

const c = (await buildRouteTool.run(ctx({ ...LYCH, accuracyM: 6_500 }), { stops: STOPS })) as Out;
check("груба позиція (±6,5 км) — склад", c.старт?.назва !== "Ваша геолокація", c.старт);
check("груба позиція — примітка з похибкою", /надто груба \(±6,5 км/.test(c.примітка ?? ""), c.примітка);

const d = (await buildRouteTool.run(ctx(LYCH), { stops: STOPS, start: "склад" })) as Out;
check("start=«склад» перемагає геолокацію", d.старт?.назва !== "Ваша геолокація", d.старт);

const e = (await buildRouteTool.run(ctx(LYCH), { stops: STOPS, start: "моя геолокація" })) as Out;
check("start=«моя геолокація» — геолокація", e.старт?.назва === "Ваша геолокація", e.старт);

// Перекручене прізвище, якого повний пошук не знайде: має прийти варіант, а не «немає в базі».
const f = (await buildRouteTool.run(ctx(LYCH), { stops: ["Солтівська Надя (м. Золочів)", "Яцьків Петро Федорович"] })) as Out;
const sug = f.можливо_мали_на_увазі?.[0];
check("невпізнаного перепитує з варіантами", !!sug && sug.варіанти.some((v) => /Яцьків Іван Теодорович/.test(v)), f.можливо_мали_на_увазі);
check("і каже моделі перепитати, а не «немає»", /НЕ називай відсутніми/.test(f.примітка ?? ""), f.примітка);

await prisma.$disconnect();

if (fails.length) {
  console.log(`\n${fails.length} провалено: ${fails.join("; ")}`);
  process.exit(1);
}
console.log("\nусе гаразд");
