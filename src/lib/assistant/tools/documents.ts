/**
 * Інструмент «documents»: накладні для керівника.
 *
 * Два режими одного інструмента, бо питання одне — «покажи накладні»:
 * • список за період — по торговому, клієнту або водію, з підсумками, які
 *   збігаються з team_overview (той самий SOURCE_FILTER і та сама маржа);
 * • картка за номером — рядки, маржа, збірка на складі, доставка, заміна
 *   чернетки 1С і «є ще замовлення з тим самим номером».
 *
 * Ім'я людини розв'язує resolveStaff, клієнта — findClients; у сумніві
 * повертаємо варіанти, а не вгадуємо: керівник ухвалює за цією відповіддю
 * рішення про людину, і чужі числа тут гірші за жодних.
 *
 * Період без аргументів — 7 днів, а не місяць, як у решти керівницьких:
 * місяць накладних — це сотні рядків, які все одно не влізуть, а
 * «які накладні» майже завжди про останні дні.
 *
 * Нічого не пише; 1С не чіпає.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { bool, enumOf, int, str } from "@/lib/assistant/validate";
import { periodFacts, periodFromArgs } from "@/lib/assistant/period";
import { ymd } from "@/lib/assistant/format";
import { PERIOD_PARAMS, checkedPeriod, hasPeriodArgs } from "@/lib/assistant/tools/admin";
import { resolveStaff, staffProblem } from "@/lib/assistant/facts/staff";
import { findClients } from "@/lib/assistant/facts/client-search";
import {
  DOC_KIND_LABEL,
  DOC_KINDS,
  DOC_STATUSES,
  docKindLabel,
  documentByNumber,
  documentLines,
  listDocuments,
  statusLabel,
  type DocKind,
  type DocumentRow,
} from "@/lib/assistant/facts/documents";

/** Без періоду — останній тиждень. */
const DEFAULT_DAYS = 7;

/** Рядки товарів показуємо, лише коли документів небагато — інакше не влазить. */
const LINES_DOCS_MAX = 5;
const LINES_PER_DOC = 12;

/**
 * Межа розміру відповіді, під яку підрізаємо список самі.
 *
 * compact() ріже масиви навпіл наосліп; тут ми знаємо, що саме зайве —
 * найстаріші документи, — і ріжемо по одному, лишаючи підсумки цілими.
 */
const RESULT_SOFT_MAX = 8500;

const LINES_HINT = "Рядки показую, коли документів не більше п'яти — назвіть номер або звузьте період.";

export const documentsTool: ToolDef = {
  name: "documents",
  label: "Дивлюся накладні",
  kinds: ["ADMIN"],
  description:
    "Накладні з 1С: список за період по торговому (rep), клієнту (client) або водію (driver — що він віз, за датою маршруту) з підсумками (оборот, повернення, клієнти, середній чек, маржа) і кожним документом (номер, клієнт, торговий, сума, знижка, маржа, позиції, стан); або одна накладна за номером (number) — рядки товарів, маржа, збірка на складі, доставка. doc_type: sales — проведені реалізації з поверненнями (за замовчуванням), orders — замовлення, returns — повернення, all — усе. Викликай на «накладні», «документи», «реалізації», «що відвантажили», «що повіз», «накладна №…», «хто збирав накладну», «які накладні мали знижку».",
  parameters: {
    type: "object",
    properties: {
      rep: { type: "string", description: "Прізвище торгового, який виписав документи." },
      client: { type: "string", description: "Назва клієнта або її частина." },
      driver: { type: "string", description: "Прізвище водія — документи з його маршрутів; період тоді за датою маршруту." },
      number: {
        type: "string",
        description: "Номер накладної — повна картка з рядками, маржею, збіркою й доставкою. Досить цифр: «6466», для повернення «412/2026».",
      },
      doc_type: {
        type: "string",
        enum: [...DOC_KINDS],
        description: "sales — проведені реалізації з поверненнями (за замовчуванням), orders — замовлення, returns — лише повернення, all — усе, крім скасованих.",
      },
      status: {
        type: "string",
        enum: [...DOC_STATUSES],
        description: "Лише документи в цьому стані: DRAFT (набирається), CONFIRMED (проведено), PACKING, IN_TRANSIT, DELIVERED, CANCELLED.",
      },
      with_lines: { type: "boolean", description: "true — додати рядки товарів по кожному документу (лише коли документів не більше п'яти)." },
      limit: { type: "integer", description: "Скільки документів показати, до 50. За замовчуванням 25." },
      ...PERIOD_PARAMS,
      days: { type: "integer", description: `Скільки останніх днів. Без цього й без дат — ${DEFAULT_DAYS} днів.` },
    },
  },
  async run(ctx, args) {
    const kindArg = enumOf(args.doc_type, "doc_type", DOC_KINDS);
    const status = enumOf(args.status, "status", DOC_STATUSES);

    /* ── Одна накладна за номером ─────────────────────────────────────── */
    if (typeof args.number === "string" && args.number.trim()) {
      const number = str(args.number, "number", { min: 1, max: 40 });
      // Без явного doc_type шукаємо серед усіх: номер замовлення, якого
      // немає серед реалізацій, інакше давав би «не знайшли».
      const card = await documentByNumber(number, kindArg);
      if (!card) {
        return {
          помилка: `Документа № ${number} у базі немає${kindArg ? ` серед «${DOC_KIND_LABEL[kindArg]}»` : ""}`,
          підказка: "Номер 1С — це цифри (6466); повернення мають рік через дріб (412/2026). Якщо це номер із сайту — назвіть його повністю.",
        };
      }
      return card;
    }

    /* ── Список за період ─────────────────────────────────────────────── */
    const kind: DocKind = kindArg ?? "sales";
    const limit = int(args.limit, "limit", { min: 1, max: 50, fallback: 25 });
    const withLines = bool(args.with_lines, false);
    const period = hasPeriodArgs(args)
      ? checkedPeriod(ctx.today, args)
      : periodFromArgs(ctx.today, { days: DEFAULT_DAYS });

    const фільтр: Record<string, unknown> = { тип: docKindLabel(kind, status) };
    if (status) фільтр.статус = `${statusLabel(status)} (${status})`;

    let repId: string | null = null;
    if (typeof args.rep === "string" && args.rep.trim()) {
      const match = await resolveStaff(str(args.rep, "rep", { min: 2, max: 60 }), ["SALES"]);
      if (!match.ok) return staffProblem(match, "торгового");
      repId = match.user.id;
      фільтр.торговий_id = match.user.id;
      фільтр.торговий = match.user.name;
    }

    let driverId: string | null = null;
    if (typeof args.driver === "string" && args.driver.trim()) {
      const match = await resolveStaff(str(args.driver, "driver", { min: 2, max: 60 }), ["DRIVER"]);
      if (!match.ok) return staffProblem(match, "водія");
      driverId = match.user.id;
      фільтр.водій_id = match.user.id;
      фільтр.водій = match.user.name;
    }

    let counterpartyId: string | null = null;
    if (typeof args.client === "string" && args.client.trim()) {
      const query = str(args.client, "client", { min: 2, max: 80 });
      const hits = await findClients(query, ctx.scope.repId, { limit: 5 });
      if (hits.length === 0) {
        return { помилка: `Клієнта «${query}» у базі немає`, варіанти: [] };
      }
      /**
       * Кілька збігів — беремо єдиного, в кого взагалі є документи; коли
       * таких теж кілька, вибір робить людина. Клієнт без жодного
       * документа тут не кандидат: список по ньому був би порожній.
       */
      const withDocs = hits.filter((h) => h.lastDocAt);
      const chosen = hits.length === 1 ? hits[0] : withDocs.length === 1 ? withDocs[0] : null;
      if (!chosen) {
        return {
          помилка: "Під цю назву підходить кілька клієнтів — покажіть варіанти й попросіть уточнити",
          варіанти: hits.map((h) => ({
            клієнт_id: h.id,
            клієнт: h.name,
            адреса: h.address,
            останній_документ: ymd(h.lastDocAt),
          })),
        };
      }
      counterpartyId = chosen.id;
      фільтр.клієнт_id = chosen.id;
      фільтр.клієнт = chosen.name;
    }

    const list = await listDocuments({
      from: period.from,
      to: period.to,
      repId,
      counterpartyId,
      driverId,
      docType: kind,
      status,
      limit,
    });

    const who = фільтр.торговий ?? фільтр.клієнт ?? (фільтр.водій ? `повіз ${фільтр.водій}` : null);
    if (list.усього === 0) {
      return {
        період: periodFacts(period),
        фільтр,
        разом: list.разом,
        показано: 0,
        усього: 0,
        документи: [],
        підказка: `${who ? `${who}: ` : ""}документів за цей період немає${driverId ? " (для водія період — за датою маршруту)" : ""}`,
      };
    }

    const notes = [
      "Торговий — хто виписав документ у 1С; оборот нетто, повернення входять із мінусом.",
      list.разом.без_торгового > 0 ? `${list.разом.без_торгового} документів без торгового — офісні, виписані без відповідального.` : null,
      driverId ? "Для водія період — за датою маршруту, а не документа." : null,
      list.разом.маржа == null ? "Маржі немає: 1С не привезла собівартості по цих документах." : null,
    ].filter(Boolean);

    const result: {
      період: ReturnType<typeof periodFacts>;
      фільтр: Record<string, unknown>;
      разом: typeof list.разом;
      показано: number;
      усього: number;
      документи: DocumentRow[];
      рядки?: unknown[];
      підказка?: string;
      обрізано?: boolean;
      примітка: string;
    } = {
      період: periodFacts(period),
      фільтр,
      разом: list.разом,
      показано: list.показано,
      усього: list.усього,
      документи: list.документи,
      примітка: notes.join(" "),
    };

    if (withLines) {
      // Рахуємо показані, а не всі: з limit ≤ 5 модель може попросити рядки
      // по найсвіжіших, не називаючи номера; усього/показано кажуть, що є ще.
      if (list.документи.length > LINES_DOCS_MAX) {
        result.підказка = LINES_HINT;
      } else {
        const lines = await Promise.all(list.документи.map((d) => documentLines(d.документ_id, LINES_PER_DOC)));
        result.рядки = list.документи.map((d, i) => ({
          документ_id: d.документ_id,
          номер: d.номер,
          клієнт: d.клієнт ?? фільтр.клієнт ?? null,
          сума: d.сума,
          рядки: lines[i].рядки,
          рядків_усього: lines[i].рядків_усього,
        }));
      }
    }

    // Не влазить — прибираємо найстаріші документи по одному; підсумки
    // при цьому лишаються за весь період.
    while (JSON.stringify(result).length > RESULT_SOFT_MAX && result.документи.length > LINES_DOCS_MAX) {
      result.документи = result.документи.slice(0, -1);
      result.обрізано = true;
    }
    if (result.обрізано) {
      result.показано = result.документи.length;
      result.підказка = `Показано ${result.показано} із ${result.усього} — звузьте період або зменшіть limit.`;
    }

    return result;
  },
};
