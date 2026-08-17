/**
 * Кандидати дій по клієнтах торгового: кому дзвонити і навіщо.
 *
 * Портфель (clients.ts), дебіторка (money-facts.ts) і платіжна дисципліна
 * (discipline.ts) кожен окремо відповідають на своє питання. Керівнику ж
 * потрібен один список на людину: цих відновити, цих утримати, з цих
 * забрати борг, цих розпрацювати, цим подякувати.
 *
 * Правила детерміновані навмисно — так само, як у clientOrder.ts. Модель у
 * розділі АІ-аналізу лише РАНЖУЄ й пояснює готових кандидатів; вигадати
 * клієнта вона не може, бо в схемі приймає тільки counterpartyId зі списку.
 *
 * Клієнт потрапляє рівно в один тип: інакше та сама назва стояла б у трьох
 * блоках із різними порадами, і чекліст суперечив би сам собі. Пріоритет
 * від «гроші вже наші, треба забрати» до «все добре, варто закріпити»:
 *   COLLECT_DEBT > CHURN_RISK > REACTIVATE > DEVELOP > OFFER_BONUS
 */

import { clientPortfolio, type PortfolioClient } from "@/lib/analytics/clients";
import {
  receivableRowsByRep,
  sumAging,
  type ReceivableRow,
} from "@/lib/analytics/money-facts";
import { buildDisciplineReport, type PayerVerdict } from "@/lib/analytics/discipline";
import type { Period } from "@/lib/analytics/period";

/**
 * З якої суми прострочки клієнт потрапляє у список на стягнення.
 *
 * Нижче цього борг не вартий окремого дзвінка: у будматеріалах така сума
 * закривається наступною ж накладною, а список має вміщати те, за що варто
 * братися сьогодні.
 */
const OVERDUE_MIN = 5_000;

/** Скільки кандидатів одного типу лишаємо. */
const PER_KIND = 6;
/** Стеля на торгового — щоб факти для 11 людей не рознесли контекст моделі. */
const PER_REP = 25;

export type ActionKind =
  | "COLLECT_DEBT"
  | "CHURN_RISK"
  | "REACTIVATE"
  | "DEVELOP"
  | "OFFER_BONUS";

export const ACTION_LABELS: Record<ActionKind, string> = {
  COLLECT_DEBT: "Забрати борг",
  CHURN_RISK: "Ризик втрати",
  REACTIVATE: "Відновити",
  DEVELOP: "Розпрацювати",
  OFFER_BONUS: "Запропонувати бонус",
};

export type ClientActionCandidate = {
  counterpartyId: string;
  name: string;
  kind: ActionKind;
  /** Оборот за обраний період */
  amountPeriod: number;
  daysSinceLast: number;
  /** Власний ритм клієнта — з чим порівнювати daysSinceLast */
  avgIntervalDays: number;
  debt: number;
  overdue: number;
  verdict: PayerVerdict | null;
  lastDocAt: string | null;
  skuCount: number;
  brandCount: number;
  /** Готове пояснення українською — саме воно показується в чеклісті */
  why: string;
};

const money = (n: number) => `${Math.round(n).toLocaleString("uk-UA")} ₴`;

/** «12 днів» / «1 день» / «22 дні» — без машинного «днів(я)». */
function days(n: number): string {
  const abs = Math.abs(Math.round(n));
  const last = abs % 10;
  const twoLast = abs % 100;
  if (twoLast >= 11 && twoLast <= 14) return `${abs} днів`;
  if (last === 1) return `${abs} день`;
  if (last >= 2 && last <= 4) return `${abs} дні`;
  return `${abs} днів`;
}

function median(values: number[]): number {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (list.length === 0) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 === 1 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/** Прострочка конкретного клієнта — тим самим FIFO, що й у зведенні по торгових. */
function overdueOf(row: ReceivableRow | undefined): number {
  if (!row) return 0;
  return sumAging([row]).overdue;
}

type Enrichment = {
  receivables: Map<string, ReceivableRow>;
  verdicts: Map<string, PayerVerdict>;
};

/**
 * Один торговий → його список дій.
 *
 * Збагачення (дебіторка й вердикти) передається ззовні: для команди воно
 * рахується один раз на всіх, а не 11 разів поспіль.
 */
function buildCandidates(
  portfolioClients: PortfolioClient[],
  enrich: Enrichment
): ClientActionCandidate[] {
  const taken = new Set<string>();
  const out: ClientActionCandidate[] = [];

  const base = (c: PortfolioClient, kind: ActionKind, why: string): ClientActionCandidate => {
    const row = enrich.receivables.get(c.counterpartyId);
    return {
      counterpartyId: c.counterpartyId,
      name: c.name,
      kind,
      amountPeriod: Math.round(c.amount),
      daysSinceLast: c.daysSinceLast,
      avgIntervalDays: Math.round(c.avgIntervalDays),
      debt: Math.round(row?.debt ?? c.receivable),
      overdue: Math.round(overdueOf(row)),
      verdict: enrich.verdicts.get(c.counterpartyId) ?? null,
      lastDocAt: c.lastDocAt,
      skuCount: c.skuCount,
      brandCount: c.brandCount,
      why,
    };
  };

  const push = (list: ClientActionCandidate[]) => {
    for (const item of list.slice(0, PER_KIND)) {
      if (taken.has(item.counterpartyId)) continue;
      taken.add(item.counterpartyId);
      out.push(item);
    }
  };

  // 1. Борг: гроші, які вже наші. Сортування за прострочкою, не за сальдо —
  // великий, але свіжий борг це нормальна робота, а не проблема.
  const debtRows = portfolioClients
    .map((c) => ({ c, overdue: overdueOf(enrich.receivables.get(c.counterpartyId)) }))
    .filter((x) => x.overdue >= OVERDUE_MIN)
    .sort((a, b) => b.overdue - a.overdue)
    .map(({ c, overdue }) => {
      const verdict = enrich.verdicts.get(c.counterpartyId);
      const tail =
        verdict === "CRITICAL"
          ? "; платіжна дисципліна — лише передоплата"
          : verdict === "RISKY"
            ? "; платник ризиковий"
            : "";
      return base(
        c,
        "COLLECT_DEBT",
        `Прострочено ${money(overdue)} із загального боргу ${money(
          enrich.receivables.get(c.counterpartyId)?.debt ?? c.receivable
        )}; востаннє брав ${days(c.daysSinceLast)} тому${tail}`
      );
    });
  push(debtRows);

  // 2. Ризик втрати: відстає від ВЛАСНОГО ритму. Такий клієнт ще в топі за
  // оборотом, і без цього списку його зникнення помітять лише за квартал.
  const churn = portfolioClients
    .filter((c) => c.state === "SLIPPING")
    .sort((a, b) => b.amount - a.amount)
    .map((c) =>
      base(
        c,
        "CHURN_RISK",
        `Бере раз на ${days(c.avgIntervalDays)}, а мовчить уже ${days(
          c.daysSinceLast
        )}; за період дав ${money(c.amount)}`
      )
    );
  push(churn);

  // 3. Відновити: сплячі й втрачені, найцінніші першими.
  const reactivate = portfolioClients
    .filter((c) => c.state === "DORMANT" || c.state === "LOST")
    .sort((a, b) => b.amount - a.amount)
    .map((c) =>
      base(
        c,
        "REACTIVATE",
        c.state === "LOST"
          ? `Не брав ${days(c.daysSinceLast)} — уже втрачений; раніше ритм був раз на ${days(
              c.avgIntervalDays
            )}`
          : `Спить ${days(c.daysSinceLast)} при звичному ритмі раз на ${days(c.avgIntervalDays)}`
      )
    );
  push(reactivate);

  // 4. Розпрацювати: бере багато грошей, але вузьким асортиментом. Медіани
  // рахуються по портфелю САМЕ ЦЬОГО торгового: у кожного своя специфіка,
  // і спільний поріг зробив би половину команди «відсталою» автоматично.
  const active = portfolioClients.filter((c) => c.state === "ACTIVE" || c.state === "NEW");
  const medAmount = median(active.map((c) => c.amount));
  const medBrands = median(active.map((c) => c.brandCount));
  const develop = active
    .filter((c) => c.amount >= medAmount && c.brandCount <= medBrands && c.brandCount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((c) =>
      base(
        c,
        "DEVELOP",
        `Бере на ${money(c.amount)}, але лише ${c.brandCount} бренд(и) і ${
          c.skuCount
        } позицій — асортимент вужчий за середній у портфелі`
      )
    );
  push(develop);

  // 5. Бонус: тримає ритм, платить, дає оборот. Це не подяка заради подяки —
  // саме таких переманюють конкуренти першими.
  const loyal = portfolioClients
    .filter(
      (c) =>
        c.state === "ACTIVE" &&
        c.daysSinceLast <= Math.max(c.avgIntervalDays, 7) &&
        overdueOf(enrich.receivables.get(c.counterpartyId)) === 0
    )
    .sort((a, b) => b.amount - a.amount)
    .map((c) =>
      base(
        c,
        "OFFER_BONUS",
        `Стабільний: ритм раз на ${days(c.avgIntervalDays)}, ${money(
          c.amount
        )} за період, прострочки немає`
      )
    );
  push(loyal);

  return out.slice(0, PER_REP);
}

/** Збагачення, спільне для всієї команди: один прохід по дебіторці й дисципліні. */
async function loadEnrichment(): Promise<Enrichment> {
  const [rows, discipline] = await Promise.all([
    receivableRowsByRep(null),
    buildDisciplineReport(),
  ]);

  return {
    receivables: new Map(rows.map((r) => [r.counterpartyId, r])),
    verdicts: new Map(discipline.rows.map((r) => [r.counterpartyId, r.verdict])),
  };
}

/** Кандидати дій одного торгового. */
export async function repActionCandidates(
  repId: string,
  period: Period
): Promise<ClientActionCandidate[]> {
  const [portfolio, enrich] = await Promise.all([
    clientPortfolio(repId, period),
    loadEnrichment(),
  ]);
  return buildCandidates(portfolio.clients, enrich);
}

/**
 * Кандидати по всій команді.
 *
 * Дебіторка й дисципліна тягнуться один раз на всіх — це два найдорожчі
 * запити модуля, і множити їх на кількість торгових немає сенсу.
 */
export async function actionCandidatesByRep(
  repIds: string[],
  period: Period
): Promise<Map<string, ClientActionCandidate[]>> {
  if (repIds.length === 0) return new Map();

  const enrich = await loadEnrichment();
  const portfolios = await Promise.all(repIds.map((id) => clientPortfolio(id, period)));

  return new Map(
    portfolios.map((p) => [p.repId, buildCandidates(p.clients, enrich)] as const)
  );
}
