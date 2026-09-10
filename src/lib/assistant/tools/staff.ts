/**
 * Інструмент керівника: профіль співробітника.
 *
 * До нього «розкажи про Кулика» розсипалося на три-чотири виклики
 * (team_overview, team_receivables, shifts_report, staff_now), і модель
 * при ліміті раундів або не доходила до кінця, або переказувала половину.
 * Складовщиків не покривав ніхто: resolveStaff ніде не кликався з роллю
 * WAREHOUSE. Тепер одна людина — один виклик, гілка обирається за роллю,
 * а факти живуть у facts/staff-profile.ts і facts/warehouse-activity.ts.
 *
 * Правила ті самі, що в решти інструментів керівника:
 * • нічого не пишемо;
 * • ім'я розв'язує resolveStaff, а не модель — збігів кілька, повертаємо
 *   варіанти, і вибір робить людина;
 * • порівняння — лише людей однієї ролі, і тоді обидва профілі без
 *   списків, щоб два профілі влізли в один результат;
 * • «весь склад» без імені — таблиця складовщиків; «уся команда» торгових
 *   чи водіїв тут не дублюється, для цього є team_overview / drivers_report.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { enumOf, str } from "@/lib/assistant/validate";
import { periodFacts } from "@/lib/assistant/period";
import { PERIOD_PARAMS, checkedPeriod } from "@/lib/assistant/tools/admin";
import {
  ROLE_WORD,
  resolveStaff,
  staffProblem,
  type Staff,
  type StaffRole,
} from "@/lib/assistant/facts/staff";
import { staffProfile, teamReportFor } from "@/lib/assistant/facts/staff-profile";
import { warehouseActivity } from "@/lib/assistant/facts/warehouse-activity";

const STAFF_ROLES: readonly StaffRole[] = ["SALES", "DRIVER", "WAREHOUSE"];

/** Ім'я з аргументу: порожнє → null, інакше перевірене поле. */
function nameArg(raw: unknown, field: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return str(raw, field, { min: 2, max: 60 });
}

export const staffProfileTool: ToolDef = {
  name: "staff_profile",
  label: "Дивлюся профіль співробітника",
  kinds: ["ADMIN"],
  description:
    "Один співробітник цілком за період — гілка за роллю. Торговий: оборот і місце в команді, сильне/слабке, динаміка, прогноз місяця, дебіторка з боржниками, зібрані гроші, повернення, зміни й пальне, портфель клієнтів, топ брендів, де зараз. Водій: листи, км, точки, зарплата, каса (здано/підтверджено), сьогоднішній маршрут, зміни, де зараз. Складовщик: зібрані накладні, рядки, хвилини на накладну, фото накладних, зміни. Параметр compare_with — друга людина тієї самої ролі поруч. role=WAREHOUSE без who — таблиця всіх складовщиків. Викликай на «розкажи про», «проаналізуй», «як працює», «профіль», «порівняй X і Y», «складовщики», «скільки зібрав Юра».",
  parameters: {
    type: "object",
    properties: {
      who: { type: "string", description: "Прізвище або ім'я співробітника (торговий, водій або складовщик)." },
      role: {
        type: "string",
        enum: ["SALES", "DRIVER", "WAREHOUSE"],
        description: "Роль. Потрібна лише без who: WAREHOUSE — таблиця всіх складовщиків.",
      },
      compare_with: { type: "string", description: "Прізвище другої людини тієї самої ролі — для порівняння." },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
    const period = checkedPeriod(ctx.today, args);
    const role = args.role == null || args.role === "" ? null : enumOf(args.role, "role", STAFF_ROLES);
    const who = nameArg(args.who, "who");
    const compareWith = nameArg(args.compare_with, "compare_with");

    if (!who) {
      if (role === "WAREHOUSE") {
        const act = await warehouseActivity(period, null);
        return {
          період: periodFacts(period),
          склад: { складовщиків: act.працівники.length, працівники: act.працівники },
          медіани: act.медіани,
          примітка: act.примітка,
        };
      }
      return {
        помилка: "Не сказано, про кого питати: передайте who — прізвище або ім'я.",
        підказка: "для команди — team_overview / drivers_report",
      };
    }

    /**
     * Шукаємо серед усіх трьох ролей навіть коли role задано: модель могла
     * назвати роль навмання, і «такого торгового немає» про водія Пайду
     * було б неправдою. Роль людини візьмемо з бази.
     */
    const match = await resolveStaff(who, [...STAFF_ROLES]);
    if (!match.ok) return staffProblem(match, "співробітника");
    const person: Staff = match.user;

    let other: Staff | null = null;
    if (compareWith) {
      const second = await resolveStaff(compareWith, [...STAFF_ROLES]);
      if (!second.ok) return staffProblem(second, "співробітника");
      if (second.user.id === person.id) {
        return { помилка: `«${who}» і «${compareWith}» — це та сама людина: ${person.name}` };
      }
      if (second.user.role !== person.role) {
        return {
          помилка: "порівнювати можна людей однієї ролі",
          хто: { ім_я: person.name, роль: ROLE_WORD[person.role] },
          з_ким: { ім_я: second.user.name, роль: ROLE_WORD[second.user.role] },
        };
      }
      other = second.user;
    }

    if (!other) {
      const profile = await staffProfile(person, period, ctx.today);
      return {
        період: periodFacts(period),
        особа: profile.особа,
        медіани: profile.медіани ?? undefined,
        примітка: profile.примітка,
      };
    }

    // Командний зріз один на двох: бенчмарк — найдорожчий запит профілю.
    const team = await teamReportFor(person.role, period);
    const [mine, theirs] = await Promise.all([
      staffProfile(person, period, ctx.today, { lists: false, team }),
      staffProfile(other, period, ctx.today, { lists: false, team }),
    ]);

    return {
      період: periodFacts(period),
      особа: mine.особа,
      порівняння_з: theirs.особа,
      медіани: mine.медіани ?? undefined,
      примітка: `${mine.примітка} У порівнянні списки (боржники, бренди, листи, накладні) прибрано — спитайте про одну людину.`,
    };
  },
};
